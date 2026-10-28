import os
import sys
import types
import zlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from backend import fast_vocals
from backend.runtime import local_fast_vocals


class FastVocalsTests(unittest.TestCase):
    def test_analysis_synthesis_preserves_samples_and_timing(self):
        rng = np.random.default_rng(7)
        for length in (1, 137, 4096, 44103):
            with self.subTest(length=length):
                audio = rng.normal(size=(2, length)).astype(np.float32)
                restored = fast_vocals.synthesis(fast_vocals.analysis(audio), length)
                self.assertEqual(restored.shape, audio.shape)
                np.testing.assert_allclose(restored, audio, atol=1e-6)

    def test_chunk_context_trimming_has_no_gaps_or_repeated_audio(self):
        audio = np.arange(2 * 450, dtype=np.float32).reshape(2, 450)
        updates = []
        with patch.object(fast_vocals, 'CORE_SAMPLES', 200), \
                patch.object(fast_vocals, 'CONTEXT_SAMPLES', 40), \
                patch.object(fast_vocals, 'separate_chunk', side_effect=lambda chunk, _: chunk.copy()) as infer:
            result = fast_vocals.separate_audio(audio, None, lambda end, total: updates.append((end, total)))
        np.testing.assert_array_equal(result, audio)
        self.assertEqual(updates, [(200, 450), (400, 450), (450, 450)])
        self.assertEqual([call.args[0].shape[1] for call in infer.call_args_list], [240, 280, 90])

    def test_silent_input_stays_finite_and_silent(self):
        class Session:
            def get_inputs(self):
                return [type('Input', (), {'name': 'x'})()]

            def run(self, _, feed):
                return [np.zeros_like(feed['x'])]

        audio = np.zeros((2, 8821), dtype=np.float32)
        result = fast_vocals.separate_chunk(audio, [Session(), Session()])
        self.assertEqual(result.shape, audio.shape)
        self.assertTrue(np.isfinite(result).all())
        self.assertEqual(float(np.max(np.abs(result))), 0)

    def test_cpu_threads_leave_room_for_the_interface(self):
        with patch.dict(os.environ, {}, clear=True), patch('os.cpu_count', return_value=4):
            self.assertEqual(fast_vocals.cpu_threads(), 2)
        with patch.dict(os.environ, {'PUJIAN_VOCAL_THREADS': '8'}), patch('os.cpu_count', return_value=4):
            self.assertEqual(fast_vocals.cpu_threads(), 4)

    def test_missing_fast_models_keep_legacy_installations_working(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {}, clear=True):
            with patch('backend.runtime.whisper_cache', return_value=Path(folder)):
                self.assertIsNone(local_fast_vocals())

    def test_partial_fast_model_install_is_an_error(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {'PUJIAN_FAST_VOCALS_MODEL': folder}):
            (Path(folder) / fast_vocals.MODEL_FILES[0]).write_bytes(b'incomplete')
            with self.assertRaisesRegex(RuntimeError, '不完整'):
                local_fast_vocals()

    def test_corrupt_models_are_rejected_before_inference(self):
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / fast_vocals.MODEL_FILES[0]).write_bytes(b'corrupt')
            with self.assertRaisesRegex(RuntimeError, '校验失败'):
                fast_vocals.validate_models(Path(folder))

    def test_embedded_assets_install_atomically_and_reuse_verified_files(self):
        payload = {'vocals.fp16.onnx': b'vocals', 'accompaniment.fp16.onnx': b'accompaniment'}
        import hashlib
        checksums = {name: hashlib.sha256(value).hexdigest() for name, value in payload.items()}
        assets = types.ModuleType('backend._fast_model_assets')
        assets.PAYLOADS = {name: zlib.compress(value) for name, value in payload.items()}
        with tempfile.TemporaryDirectory() as folder, patch.dict(sys.modules, {'backend._fast_model_assets': assets}), \
                patch('backend.fast_vocals.importlib.util.find_spec', return_value=True), \
                patch.dict(fast_vocals.MODEL_SHA256, checksums, clear=True):
            destination = Path(folder) / 'versioned-models'
            self.assertEqual(fast_vocals.embedded_models(destination), destination)
            self.assertEqual({path.name for path in destination.iterdir()}, set(payload))
            with patch('backend.fast_vocals.zlib.decompress', side_effect=AssertionError('Should reuse cache')):
                self.assertEqual(fast_vocals.embedded_models(destination), destination)

    def test_embedded_assets_reject_unsupported_paths(self):
        assets = types.ModuleType('backend._fast_model_assets')
        assets.PAYLOADS = {'../outside': zlib.compress(b'bad')}
        with tempfile.TemporaryDirectory() as folder, patch.dict(sys.modules, {'backend._fast_model_assets': assets}), \
                patch('backend.fast_vocals.importlib.util.find_spec', return_value=True):
            with self.assertRaisesRegex(RuntimeError, '不支持'):
                fast_vocals.embedded_models(Path(folder) / 'models')
            self.assertFalse((Path(folder) / 'outside').exists())


if __name__ == '__main__':
    unittest.main()
