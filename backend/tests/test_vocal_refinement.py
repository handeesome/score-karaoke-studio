import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from backend import main, vocal_waveform


class VocalRefinementTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.audio = Path(folder.name) / 'song.mp3'
        self.audio.write_bytes(b'audio')
        self.cache = Path(folder.name) / 'cache'
        self.work = self.cache / vocal_waveform.cache_key(self.audio)
        self.work.mkdir(parents=True)
        self.fast = dict(duration=1, levels=[.1], peaks=[.2], kind='vocal-rms', model='spleeter-2stems-fp16')
        self.refined = {**self.fast, 'levels': [.5], 'peaks': [.7], 'model': 'htdemucs'}
        self.cached = self.work / 'waveform.json'
        self.cached.write_text(json.dumps(self.fast), encoding='utf-8')
        self.job_id = 'refinement-test'
        main.vocal_jobs[self.job_id] = dict(status='queued')
        self.addCleanup(main.vocal_jobs.pop, self.job_id, None)

    def test_fast_result_is_completed_before_background_task_is_submitted(self):
        def submit(task, job_id, path):
            snapshot = main.vocal_waveform_status(job_id)
            self.assertEqual(snapshot['status'], 'completed')
            self.assertEqual(snapshot['waveform'], self.fast)
            self.assertTrue(snapshot['refining'])
            self.assertEqual(task, main._refine_vocal_waveform)
        with patch.object(main, 'VOCAL_CACHE', self.cache), \
                patch.object(main, 'vocal_waveform_for_audio', return_value=self.fast), \
                patch.object(main.vocal_refinement_executor, 'submit', side_effect=submit) as executor:
            main._run_vocal_waveform(self.job_id, self.audio)
        executor.assert_called_once()

    def test_success_updates_the_completed_job_without_changing_visible_status(self):
        main.vocal_jobs[self.job_id].update(status='completed', waveform=self.fast, refining=True, progress=100)
        with patch.object(main, 'vocal_waveform_for_audio', return_value=self.refined) as generate:
            main._refine_vocal_waveform(self.job_id, self.audio)
        self.assertEqual(generate.call_args.kwargs, {'engine': 'htdemucs'})
        job = main.vocal_waveform_status(self.job_id)
        self.assertEqual(job['waveform'], self.refined)
        self.assertEqual(job['status'], 'completed')
        self.assertFalse(job['refining'])
        self.assertNotIn('error', job)

    def test_failure_keeps_fast_result_completed_and_does_not_publish_an_error(self):
        main.vocal_jobs[self.job_id].update(status='completed', waveform=self.fast, refining=True)
        with patch.object(main, 'vocal_waveform_for_audio', side_effect=RuntimeError('model unavailable')), \
                self.assertLogs(level='ERROR'):
            main._refine_vocal_waveform(self.job_id, self.audio)
        job = main.vocal_waveform_status(self.job_id)
        self.assertEqual(job['waveform'], self.fast)
        self.assertEqual(job['status'], 'completed')
        self.assertFalse(job['refining'])
        self.assertNotIn('error', job)

    def test_refined_cache_is_reused_without_another_background_task(self):
        with patch.object(main, 'vocal_waveform_for_audio', return_value=self.refined), \
                patch.object(main.vocal_refinement_executor, 'submit') as executor:
            main._run_vocal_waveform(self.job_id, self.audio)
        executor.assert_not_called()

    def stem(self, model):
        stem = self.work / model / 'renamed' / 'vocals.mp3'
        stem.parent.mkdir(parents=True)
        stem.write_bytes(b'saved stem')
        return stem

    def test_legacy_fast_cache_is_upgraded_using_only_the_original_stem(self):
        legacy = {k: v for k, v in self.fast.items() if k != 'model'}
        self.cached.write_text(json.dumps(legacy), encoding='utf-8')
        self.stem('spleeter-2stems')
        original = self.stem('htdemucs')
        with patch.object(vocal_waveform, 'waveform_for_audio', return_value=self.refined) as waveform, \
                patch.object(vocal_waveform.subprocess, 'Popen') as worker:
            result = vocal_waveform.vocal_waveform_for_audio(self.audio, self.cache, lambda *_: None, engine='htdemucs')
        self.assertEqual(waveform.call_args.args[0], str(original))
        self.assertEqual(result, self.refined)
        self.assertEqual(json.loads(self.cached.read_text(encoding='utf-8')), self.refined)
        worker.assert_not_called()

    def test_failed_waveform_generation_does_not_replace_the_fast_cache(self):
        self.stem('htdemucs')
        with patch.object(vocal_waveform, 'waveform_for_audio', side_effect=RuntimeError('bad stem')):
            with self.assertRaises(RuntimeError):
                vocal_waveform.vocal_waveform_for_audio(self.audio, self.cache, lambda *_: None, engine='htdemucs')
        self.assertEqual(json.loads(self.cached.read_text(encoding='utf-8')), self.fast)

    def test_background_worker_forces_original_model_even_with_fast_models_installed(self):
        self.stem('spleeter-2stems')
        def launch(command, **kwargs):
            self.assertEqual(command[command.index('--engine') + 1], 'htdemucs')
            self.stem('htdemucs')
            return Mock(poll=Mock(return_value=0), wait=Mock(return_value=0))
        with patch('backend.runtime.local_fast_vocals', side_effect=AssertionError('Must bypass fast model')), \
                patch('backend.runtime.local_demucs', return_value=Path('original-model')), \
                patch.object(vocal_waveform, 'separator_available', return_value=True), \
                patch.object(vocal_waveform, 'get_ffmpeg_exe', return_value=str(self.audio)), \
                patch.object(vocal_waveform.subprocess, 'Popen', side_effect=launch), \
                patch.object(vocal_waveform, 'waveform_for_audio', return_value=self.refined):
            result = vocal_waveform.vocal_waveform_for_audio(self.audio, self.cache, lambda *_: None, engine='htdemucs')
        self.assertEqual(result, self.refined)


if __name__ == '__main__':
    unittest.main()
