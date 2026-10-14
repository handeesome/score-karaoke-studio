import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from backend.runtime import data_root, local_demucs, local_whisper, whisper_source


class DesktopModelTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.environment = patch.dict(os.environ, {
            "PUJIAN_BUNDLE_DIR": str(self.root), "PUJIAN_MODEL_CACHE": str(self.root / "cache"),
            "PUJIAN_OFFLINE": "1",
        })
        self.environment.start()
        self.addCleanup(self.environment.stop)
        for name in ("PUJIAN_WHISPER_MODEL", "PUJIAN_DEMUCS_REPO"):
            os.environ.pop(name, None)

    def model(self, folder):
        folder.mkdir(parents=True)
        for name in ("config.json", "model.bin", "tokenizer.json"):
            (folder / name).write_bytes(b"test")
        return folder

    def test_bundled_whisper_used_without_cache_or_network(self):
        model = self.model(self.root / "models" / "whisper-base")
        with patch("faster_whisper.utils.download_model", side_effect=AssertionError("Network/cache should not be used")):
            self.assertEqual(whisper_source(self.root / "cache"), str(model))

    def test_existing_cached_whisper_reused_offline(self):
        model = self.model(self.root / "snapshot")
        with patch("faster_whisper.utils.download_model", return_value=str(model)) as lookup:
            self.assertEqual(local_whisper(self.root / "cache"), model)
            self.assertTrue(lookup.call_args.kwargs["local_files_only"])

    def test_missing_offline_whisper_does_not_fall_back_to_download(self):
        with patch("faster_whisper.utils.download_model", side_effect=OSError("No cache")):
            with self.assertRaisesRegex(RuntimeError, "离线包"):
                whisper_source(self.root / "cache")

    def test_incomplete_explicit_model_rejected(self):
        with patch.dict(os.environ, {"PUJIAN_WHISPER_MODEL": str(self.root / "missing")}):
            with self.assertRaisesRegex(RuntimeError, "不完整"):
                local_whisper(self.root / "cache")

    def test_demucs_requires_weights_referenced_by_yaml(self):
        folder = self.root / "models" / "demucs"
        folder.mkdir(parents=True)
        (folder / "htdemucs.yaml").write_text("models: ['955717e8']\n", encoding="utf-8")
        (folder / "6b9c2ca1-other.th").write_bytes(b"wrong model")
        with self.assertRaisesRegex(RuntimeError, "不完整"):
            local_demucs()
        (folder / "955717e8-test.th").write_bytes(b"expected model")
        self.assertEqual(local_demucs(), folder.resolve())

    def test_desktop_data_is_separate_from_source_and_bundle(self):
        with patch.dict(os.environ, {"PUJIAN_DATA_DIR": str(self.root / "data")}):
            self.assertEqual(data_root(), self.root / "data")


if __name__ == "__main__":
    unittest.main()
