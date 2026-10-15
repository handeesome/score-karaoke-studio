import json
from pathlib import Path
import tempfile
import unittest
import threading
import time
from unittest.mock import patch

from backend.separation_worker import ProgressReporter
from backend import vocal_waveform


class SeparationProgressTests(unittest.TestCase):
    def test_completed_waveform_is_reused_after_audio_is_renamed(self):
        first = Path(self.folder.name) / 'old.mp3'
        renamed = Path(self.folder.name) / 'new.mp3'
        first.write_bytes(b'identical audio')
        renamed.write_bytes(first.read_bytes())
        cache = Path(self.folder.name) / 'vocals'
        directory = cache / vocal_waveform.cache_key(first)
        directory.mkdir(parents=True)
        expected = {'levels': [.1], 'peaks': [.2], 'kind': 'vocal-rms'}
        (directory / 'waveform.json').write_text(json.dumps(expected), encoding='utf-8')
        with patch.object(vocal_waveform.subprocess, 'Popen') as worker:
            self.assertEqual(vocal_waveform.vocal_waveform_for_audio(renamed, cache, lambda *_: None), expected)
        worker.assert_not_called()

    def test_old_saved_stem_is_reused_when_waveform_is_missing(self):
        audio = Path(self.folder.name) / 'audio.mp3'
        audio.write_bytes(b'audio')
        cache = Path(self.folder.name) / 'vocals'
        stem = cache / vocal_waveform.cache_key(audio) / 'htdemucs' / 'audio' / 'vocals.mp3'
        stem.parent.mkdir(parents=True)
        stem.write_bytes(b'completed saved stem')
        expected = {'levels': [.1], 'peaks': [.2]}
        with patch.object(vocal_waveform.subprocess, 'Popen') as worker, \
                patch.object(vocal_waveform, 'waveform_for_audio', return_value=expected):
            result = vocal_waveform.vocal_waveform_for_audio(audio, cache, lambda *_: None)
        worker.assert_not_called()
        self.assertEqual(result['kind'], 'vocal-rms')

    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.path = Path(self.folder.name) / 'progress.json'
        self.reporter = ProgressReporter(self.path)
        self.reporter.samplerate = 10
        self.reporter.stride = 63

    def event(self, offset, state='end', model=0, models=1):
        return dict(state=state, segment_offset=offset, audio_length=150,
                    model_idx_in_bag=model, models=models, shift_idx=0)

    def read(self):
        return json.loads(self.path.read_text(encoding='utf-8'))

    def test_progress_only_advances_after_completed_segments(self):
        self.reporter.write('loading', 'Loading', None)
        self.reporter.callback(self.event(0, state='start'))
        self.assertIsNone(self.read()['progress'])
        self.reporter.callback(self.event(0))
        first = self.read()
        self.reporter.callback(self.event(0))
        self.assertEqual(self.read()['completedSegments'], 1)
        self.assertEqual(self.read()['progress'], first['progress'])
        self.reporter.callback(self.event(63))
        self.assertGreater(self.read()['progress'], first['progress'])
        self.reporter.callback(self.event(126))
        self.assertEqual(self.read()['processedSeconds'], 15)
        self.assertEqual(self.read()['progress'], 95)  # Saving and waveform work remain.
        self.assertEqual(len(self.path.with_suffix('.jsonl').read_text(encoding='utf-8').splitlines()), 4)

    def test_multiple_models_do_not_report_completion_after_first_model(self):
        for offset in (0, 63, 126):
            self.reporter.callback(self.event(offset, models=2))
        self.assertEqual(self.read()['progress'], 50)
        for offset in (0, 63, 126):
            self.reporter.callback(self.event(offset, model=1, models=2))
        self.assertEqual(self.read()['progress'], 95)

    def test_shift_padding_tail_does_not_exceed_completion(self):
        for offset in (0, 63, 126, 189):
            self.reporter.callback(self.event(offset))
        self.assertEqual(self.read()['progress'], 95)

    def test_two_requests_for_same_audio_share_one_generation(self):
        audio = Path(self.folder.name) / 'audio.wav'
        audio.write_bytes(b'audio test')
        result_file = Path(self.folder.name) / 'cached.json'
        generations = []
        results = []
        def generate(*_args):
            if not result_file.exists():
                generations.append(True)
                time.sleep(.1)
                result_file.write_text('{"kind":"vocal-rms"}', encoding='utf-8')
            return json.loads(result_file.read_text(encoding='utf-8'))
        with patch.object(vocal_waveform, '_generate_vocal_waveform', side_effect=generate):
            threads = [threading.Thread(target=lambda: results.append(vocal_waveform.vocal_waveform_for_audio(
                audio, Path(self.folder.name) / 'cache', lambda *_: None))) for _ in range(2)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(timeout=3)
        self.assertEqual(len(generations), 1)
        self.assertEqual(results, [{'kind': 'vocal-rms'}, {'kind': 'vocal-rms'}])


if __name__ == '__main__':
    unittest.main()
