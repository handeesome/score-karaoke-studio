import io
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
import zipfile

from desktop.updater import DesktopUpdater, choose_update, extract_patch


class UpdateTests(unittest.TestCase):
    def release(self, version='0.1.2', **overrides):
        tag = 'v' + version
        name = f'Pujian-{tag}-Windows-x64-update.zip'
        return {'tag_name': tag, 'assets': [{'name': name, 'digest': 'sha256:' + 'a' * 64,
                'browser_download_url': f'https://github.com/handeesome/score-karaoke-studio/releases/download/{tag}/{name}',
                'size': 123}], **overrides}

    def test_select_newest_stable_even_if_latest_is_old_full_installer(self):
        releases = [self.release('0.1.0'), self.release('0.1.2'), self.release('0.1.3', prerelease=True),
                    self.release('0.1.4', draft=True)]
        self.assertEqual(choose_update(releases, '0.1.1')['version'], '0.1.2')
        self.assertIsNone(choose_update(releases, '0.1.2'))

    def test_unverified_or_foreign_asset_is_not_offered(self):
        item = self.release()
        item['assets'][0]['digest'] = None
        self.assertIsNone(choose_update([item], '0.1.1'))
        item = self.release()
        item['assets'][0]['browser_download_url'] = 'https://example.com/update.zip'
        self.assertIsNone(choose_update([item], '0.1.1'))

    def archive(self, extra=None, base='0.1.0'):
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as archive:
            archive.writestr('update-info.json', json.dumps({'format': 1, 'version': '0.1.2', 'baseVersion': base}))
            archive.writestr('Pujian.exe', b'new exe')
            archive.writestr('_internal/dist/index.html', b'new UI')
            if extra:
                member = zipfile.ZipInfo('placeholder')
                member.filename = extra  # Bypass Windows ZipInfo's separator normalization.
                archive.writestr(member, b'forbidden')
        output.seek(0)
        return output

    def test_valid_archive_extracts_only_program_and_ui(self):
        with tempfile.TemporaryDirectory() as root:
            files = extract_patch(self.archive(), Path(root), '0.1.2', '0.1.0')
            self.assertEqual(len(files), 2)
            self.assertEqual((Path(root) / 'Pujian.exe').read_bytes(), b'new exe')

    def test_unsafe_paths_and_model_overwrites_rejected_before_any_write(self):
        for name in ('../outside', '/absolute', 'C:/outside', '_internal/dist/../../outside',
                     'models/model.bin', '_internal/dist/file.js:stream', '_internal\\dist\\..\\..\\bad.js', 'pujian.exe'):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as root:
                with self.assertRaises(ValueError):
                    extract_patch(self.archive(name), Path(root), '0.1.2', '0.1.0')
                self.assertEqual(list(Path(root).iterdir()), [])

    def test_incompatible_base_preserves_installation(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(ValueError):
                extract_patch(self.archive(base='0.2.0'), Path(root), '0.1.2', '0.1.0')
            self.assertEqual(list(Path(root).iterdir()), [])

    def test_network_failure_is_quiet(self):
        updater = DesktopUpdater('.', '.', '.')
        with patch('desktop.updater.urllib.request.urlopen', side_effect=OSError('offline')), patch('desktop.updater.logging.exception'):
            updater._check()
        self.assertEqual(updater.update_status(), {'status': 'idle'})

    def test_corrupt_download_keeps_app_open_and_removes_stage(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            updater = DesktopUpdater(directory, directory, directory)
            updater.window = Mock()
            updater._candidate = {'version': '0.1.2', 'url': 'https://example.com/fixture', 'size': 3, 'sha256': 'a' * 64}
            with patch('desktop.updater.urllib.request.urlopen', side_effect=[io.BytesIO(b'{"ready":true}'), io.BytesIO(b'bad')]), \
                    patch('desktop.updater.subprocess.Popen') as launch, patch('desktop.updater.logging.exception'):
                updater._install()
            self.assertEqual(updater.update_status()['status'], 'error')
            launch.assert_not_called()
            updater.window.destroy.assert_not_called()
            self.assertEqual(list(directory.iterdir()), [])

    def test_verified_download_hands_off_then_closes_window(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            (directory / 'build-info.json').write_text('{"version":"0.1.0"}', encoding='utf-8')
            (directory / 'update-install.ps1').write_text('trusted installer', encoding='utf-8')
            updater = DesktopUpdater(directory, directory, directory)
            updater.window = Mock()
            content = self.archive().getvalue()
            updater._candidate = {'version': '0.1.2', 'url': 'https://example.com/fixture', 'size': len(content),
                                  'sha256': hashlib.sha256(content).hexdigest()}
            with patch('desktop.updater.urllib.request.urlopen', side_effect=[io.BytesIO(b'{"ready":true}'), io.BytesIO(content), io.BytesIO(b'{"ready":true}')]), \
                    patch('desktop.updater.subprocess.Popen') as launch:
                updater._install()
            self.assertEqual(updater.update_status()['status'], 'installing')
            launch.assert_called_once()
            updater.window.destroy.assert_called_once()
            plan = json.loads(next(directory.glob('update-*/plan.json')).read_text(encoding='utf-8'))
            self.assertEqual(plan['files'], ['Pujian.exe', '_internal/dist/index.html'])


if __name__ == '__main__':
    unittest.main()
