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
