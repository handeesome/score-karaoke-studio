import io
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
import urllib.error
import urllib.request
import zipfile

from desktop.updater import DesktopUpdater, choose_update, extract_patch


class UpdateTests(unittest.TestCase):
    def test_native_bridge_exposes_only_update_methods_not_paths_or_window(self):
        updater = DesktopUpdater('.', '.', '.')
        updater._window = Mock()
        exposed = {name for name in dir(updater) if not name.startswith('_')}
        self.assertEqual(exposed, {'check_update', 'update_status', 'install_update', 'choose_export_directory', 'open_export'})

    def test_export_directory_cancel_and_open_are_limited_to_chosen_folder(self):
        with tempfile.TemporaryDirectory() as folder:
            updater = DesktopUpdater('.', '.', folder)
            updater._window = Mock()
            updater._window.create_file_dialog.return_value = None
            self.assertIsNone(updater.choose_export_directory())
            destination = Path(folder) / 'chosen'
            destination.mkdir()
            updater._window.create_file_dialog.return_value = [str(destination)]
            self.assertEqual(updater.choose_export_directory(), str(destination.resolve()))
            video = destination / 'result.mp4'
            video.write_bytes(b'video')
            with patch('desktop.updater.os.startfile', create=True) as launch:
                self.assertTrue(updater.open_export(str(video)))
                launch.assert_called_with(str(video.resolve()))
                self.assertTrue(updater.open_export(str(video), True))
                launch.assert_called_with(str(destination.resolve()))
            other = Path(folder) / 'other.mp4'
            other.write_bytes(b'video')
            with self.assertRaises(ValueError): updater.open_export(str(other))

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
        with patch('desktop.updater.urllib.request.build_opener') as connect, patch('desktop.updater.logging.exception'):
            connect.return_value.open.side_effect = OSError('offline')
            updater._check()
        self.assertEqual(updater.update_status(), {'status': 'idle'})

    def test_corrupt_download_keeps_app_open_and_removes_stage(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            updater = DesktopUpdater(directory, directory, directory)
            updater._window = Mock()
            updater._candidate = {'version': '0.1.2', 'url': 'https://example.com/fixture', 'size': 3, 'sha256': 'a' * 64}
            network, local = Mock(), Mock()
            network.open.return_value = io.BytesIO(b'bad')
            local.open.return_value = io.BytesIO(b'{"ready":true}')
            with patch('desktop.updater.urllib.request.build_opener', side_effect=[network, local]), \
                    patch('desktop.updater.subprocess.Popen') as launch, patch('desktop.updater.logging.exception'):
                updater._install()
            self.assertEqual(updater.update_status()['status'], 'error')
            launch.assert_not_called()
            updater._window.destroy.assert_not_called()
            self.assertEqual(list(directory.iterdir()), [])

    def test_verified_download_hands_off_then_closes_window(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            (directory / 'build-info.json').write_text('{"version":"0.1.0"}', encoding='utf-8')
            (directory / 'update-install.ps1').write_text('trusted installer', encoding='utf-8')
            updater = DesktopUpdater(directory, directory, directory)
            updater._window = Mock()
            content = self.archive().getvalue()
            updater._candidate = {'version': '0.1.2', 'url': 'https://example.com/fixture', 'size': len(content),
                                  'sha256': hashlib.sha256(content).hexdigest()}
            network, local = Mock(), Mock()
            network.open.return_value = io.BytesIO(content)
            local.open.side_effect = [io.BytesIO(b'{"ready":true}'), io.BytesIO(b'{"ready":true}')]
            with patch('desktop.updater.urllib.request.build_opener', side_effect=[network, local]), \
                    patch('desktop.updater.subprocess.Popen') as launch:
                updater._install()
            self.assertEqual(updater.update_status()['status'], 'installing')
            launch.assert_called_once()
            updater._window.destroy.assert_called_once()
            plan = json.loads(next(directory.glob('update-*/plan.json')).read_text(encoding='utf-8'))
            self.assertEqual(plan['files'], ['Pujian.exe', '_internal/dist/index.html'])

    def test_check_rereads_proxy_settings_without_changing_global_opener(self):
        updater = DesktopUpdater('.', '.', '.')
        original = urllib.request._opener
        releases = json.dumps([self.release('9.9.9')]).encode()
        with patch('desktop.updater.urllib.request.getproxies', side_effect=[{}, {'https': 'http://127.0.0.1:10809'}]) as proxies, \
                patch('urllib.request.OpenerDirector.open', side_effect=[urllib.error.URLError('offline'), io.BytesIO(releases)]), \
                patch('desktop.updater.logging.exception'):
            updater._check()
            self.assertEqual(updater.update_status()['status'], 'idle')
            updater._check()
            self.assertEqual(updater.update_status()['status'], 'available')
            self.assertEqual(proxies.call_count, 2)
        self.assertIs(urllib.request._opener, original)

    def test_retry_after_enabling_proxy_connects_and_installs_without_restart(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            (directory / 'build-info.json').write_text('{"version":"0.1.0"}', encoding='utf-8')
            (directory / 'update-install.ps1').write_text('trusted installer', encoding='utf-8')
            updater = DesktopUpdater(directory, directory, directory)
            updater._window = Mock()
            content = self.archive().getvalue()
            updater._candidate = {'version': '0.1.2', 'url': 'https://example.com/fixture', 'size': len(content),
                                  'sha256': hashlib.sha256(content).hexdigest()}
            updater._set(status='available', version='0.1.2')
            build = urllib.request.build_opener
            networks = []
            locals_ = []

            def connection(*handlers):
                opener = build(*handlers)
                if handlers:
                    self.assertEqual(handlers[0].proxies, {})
                    opener.open = Mock(side_effect=[io.BytesIO(b'{"ready":true}'), io.BytesIO(b'{"ready":true}')])
                    locals_.append(opener)
                else:
                    proxy_handlers = [handler for handler in opener.handlers if isinstance(handler, urllib.request.ProxyHandler)]
                    networks.append(proxy_handlers[0].proxies if proxy_handlers else {})
                    opener.open = Mock(side_effect=urllib.error.URLError('offline')) if len(networks) == 1 else Mock(return_value=io.BytesIO(content))
                return opener

            with patch('desktop.updater.urllib.request.getproxies', side_effect=[{}, {'https': 'http://127.0.0.1:10809'}]), \
                    patch('desktop.updater.urllib.request.build_opener', side_effect=connection), \
                    patch('desktop.updater.threading.Thread'), patch('desktop.updater.subprocess.Popen') as launch, \
                    patch('desktop.updater.logging.exception'):
                self.assertEqual(updater.install_update()['status'], 'connecting')
                updater._install()
                self.assertEqual(updater.update_status()['status'], 'error')
                self.assertIn('无需重启软件', updater.update_status()['error'])
                updater._window.destroy.assert_not_called()
                launch.assert_not_called()
                self.assertFalse([path for path in directory.glob('update-*') if path.is_dir()])
                self.assertEqual(updater.install_update()['status'], 'connecting')
                updater._install()
                self.assertEqual(updater.update_status()['status'], 'installing')
                updater._window.destroy.assert_called_once()
                launch.assert_called_once()
            self.assertEqual(networks, [{}, {'https': 'http://127.0.0.1:10809'}])
            self.assertEqual([local.open.call_count for local in locals_], [1, 2])

    def test_connecting_cannot_start_a_second_update_or_background_check(self):
        updater = DesktopUpdater('.', '.', '.')
        updater._candidate = {'version': '0.1.10'}
        updater._set(status='connecting', version='0.1.10')
        with patch('desktop.updater.sys.frozen', True, create=True), patch('desktop.updater.threading.Thread') as worker:
            self.assertEqual(updater.install_update()['status'], 'connecting')
            self.assertEqual(updater.check_update()['status'], 'connecting')
            worker.assert_not_called()

    def test_manual_check_reports_current_or_connection_error(self):
        updater = DesktopUpdater('.', '.', '.')
        with patch('desktop.updater.urllib.request.build_opener') as connect, patch('desktop.updater.logging.exception'):
            connect.return_value.open.return_value = io.BytesIO(b'[]')
            updater._check(manual=True)
            self.assertEqual(updater.update_status(), {'status': 'current'})
            connect.return_value.open.side_effect = urllib.error.URLError('offline')
            updater._check(manual=True)
            self.assertEqual(updater.update_status()['status'], 'check-error')
            self.assertIn('offline', updater.update_status()['error'])


if __name__ == '__main__':
    unittest.main()
