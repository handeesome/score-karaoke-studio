from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from backend import main
from fastapi import HTTPException


class ExportDestinationTests(unittest.TestCase):
    def test_export_and_download_use_the_chosen_directory(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder)
            project = {'projectName': '示例歌曲'}
            report = {'valid': True, 'warnings': [], 'audioPath': target / 'audio.mp3'}
            executor = Mock()
            with patch.object(main, 'read_project', return_value=project), patch.object(main, 'validate_project', return_value=report), patch.object(main, 'executor', executor):
                result = main.start_export('project', main.ExportOptions(width=320, height=320, scoreZoom=1, outputDirectory=str(target)))
            job_id = result['jobId']
            try:
                _, _, _, output, options = executor.submit.call_args.args[1:]
                self.assertEqual(output.parent, target.resolve())
                def encode(*args, **kwargs):
                    args[2].write_bytes(b'video')
                    return 1.0
                with patch.object(main, 'encode_video', side_effect=encode):
                    main._run_export(job_id, project, report['audioPath'], output, options)
                status = main.export_status(job_id)
                self.assertEqual(status['status'], 'completed')
                self.assertEqual(Path(status['outputPath']), output)
                self.assertEqual(Path(main.download_export(job_id).path), output)
            finally:
                main.jobs.pop(job_id, None)

    def test_missing_destination_does_not_start_encoding(self):
        with tempfile.TemporaryDirectory() as folder:
            with patch.object(main, 'read_project', return_value={}), patch.object(main, 'validate_project', return_value={'valid': True}), patch.object(main, 'executor') as executor:
                with self.assertRaises(HTTPException):
                    main.start_export('project', main.ExportOptions(width=320, height=320, scoreZoom=1, outputDirectory=str(Path(folder) / 'missing')))
                executor.submit.assert_not_called()

    def test_encoding_without_a_nonempty_output_is_not_success(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'video.mp4'
            for empty_file in (False, True):
                def encode(*args, **kwargs):
                    if empty_file: args[2].touch()
                    return 1.0
                job_id = 'missing-output-test'
                main.jobs[job_id] = {'status': 'queued', 'progress': 0, 'file': None}
                try:
                    with patch.object(main, 'encode_video', side_effect=encode):
                        main._run_export(job_id, {}, target.parent / 'audio.mp3', target,
                                         main.ExportOptions(width=320, height=320, scoreZoom=1))
                    status = main.export_status(job_id)
                    self.assertEqual(status['status'], 'failed')
                    self.assertIn('未找到完整视频', status['error'])
                    self.assertIsNone(status['downloadUrl'])
                finally:
                    main.jobs.pop(job_id, None)

    def test_named_output_preserves_previous_video_if_regeneration_fails(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / '自定义 视频.mp4'
            target.write_bytes(b'previous video')
            project = {'projectName': 'Song'}
            report = {'valid': True, 'warnings': [], 'audioPath': target.parent / 'audio.mp3'}
            options = main.ExportOptions(width=320, height=320, scoreZoom=1, outputPath=str(target))
            with patch.object(main, 'read_project', return_value=project), patch.object(main, 'validate_project', return_value=report), patch.object(main, 'executor') as executor:
                started = main.start_export('project', options)
                self.assertEqual(executor.submit.call_args.args[4], target.resolve())
                self.assertEqual(started['outputPath'], str(target.resolve()))
            job_id = started['jobId']
            def failed(*args, **kwargs):
                args[2].write_bytes(b'partial')
                raise RuntimeError('编码中断')
            try:
                with patch.object(main, 'encode_video', side_effect=failed):
                    main._run_export(job_id, project, report['audioPath'], target, options)
                self.assertEqual(main.export_status(job_id)['status'], 'failed')
                self.assertEqual(target.read_bytes(), b'previous video')
                self.assertEqual(list(target.parent.glob('*.tmp.mp4')), [])
                def success(*args, **kwargs):
                    args[2].write_bytes(b'new video')
                    return 1.0
                with patch.object(main, 'encode_video', side_effect=success):
                    main._run_export(job_id, project, report['audioPath'], target, options)
                self.assertEqual(main.export_status(job_id)['status'], 'completed')
                self.assertEqual(target.read_bytes(), b'new video')
                self.assertEqual(Path(main.download_export(job_id).path), target.resolve())
            finally:
                main.jobs.pop(job_id, None)
