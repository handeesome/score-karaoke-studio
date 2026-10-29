"""Opt-in cumulative updates from this application's GitHub releases."""
from __future__ import annotations

import hashlib
import json
import logging
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tempfile
import threading
import urllib.error
import urllib.request
import zipfile

from desktop.version import VERSION

API = 'https://api.github.com/repos/handeesome/score-karaoke-studio/releases?per_page=100'
DOWNLOAD_PREFIX = 'https://github.com/handeesome/score-karaoke-studio/releases/download/'


def version_key(value):
    match = re.fullmatch(r'v?(\d+)\.(\d+)\.(\d+)', value)
    return tuple(map(int, match.groups())) if match else (0, 0, 0)


def choose_update(releases, current=VERSION):
    candidates = []
    for release in releases:
        tag = release.get('tag_name', '')
        if release.get('draft') or release.get('prerelease') or version_key(tag) <= version_key(current):
            continue
        name = f'Pujian-{tag}-Windows-x64-update.zip'
        for asset in release.get('assets', []):
            digest = asset.get('digest', '') or ''
            url = asset.get('browser_download_url', '')
            if (asset.get('name') == name and re.fullmatch(r'sha256:[0-9a-f]{64}', digest)
                    and url == DOWNLOAD_PREFIX + tag + '/' + name and 0 < asset.get('size', 0) < 400 * 1024**2):
                candidates.append({'version': tag.removeprefix('v'), 'url': url,
                                   'sha256': digest[7:], 'size': asset['size']})
    return max(candidates, key=lambda item: version_key(item['version']), default=None)


def extract_patch(archive, destination, version, base_version):
    """Validate the entire ZIP before writing any member; models/data are forbidden."""
    with zipfile.ZipFile(archive) as source:
        info = json.loads(source.read('update-info.json'))
        if info.get('version') != version or info.get('baseVersion') != base_version or info.get('format') != 1:
            raise ValueError('更新包与当前安装不兼容，请下载完整发行包。')
        names = set()
        selected = []
        expanded = 0
        for entry in source.infolist():
            name = entry.filename
            parts = PurePosixPath(name).parts
            if ('\\' in name or ':' in name or name.startswith('/') or '..' in parts
                    or name.rstrip('/') != PurePosixPath(name).as_posix()
                    or any(part.endswith((' ', '.')) for part in parts)
                    or (entry.external_attr >> 16) & 0o170000 == 0o120000
                    or name.casefold() in names):
                raise ValueError('更新包包含不安全的文件路径。')
            names.add(name.casefold())
            expanded += entry.file_size
            if expanded > 400 * 1024**2 or len(names) > 500:
                raise ValueError('更新包过大。')
            if entry.is_dir():
                continue
            if name in ('update-info.json', 'Repair-Startup.cmd', '更新说明.txt'):
                continue
            if not (name in ('Pujian.exe', '_internal/update-install.ps1') or
                    (name.startswith('_internal/dist/') and PurePosixPath(name).suffix.lower()
                     in ('.html', '.js', '.css', '.svg', '.png', '.ico', '.woff2'))):
                raise ValueError('更新包包含不支持的文件。')
            selected.append(name)
        if 'Pujian.exe' not in selected or '_internal/dist/index.html' not in selected:
            raise ValueError('更新包不完整。')
        for name in selected:
            target = destination.joinpath(*PurePosixPath(name).parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            with source.open(name) as stream, target.open('wb') as output:
                while block := stream.read(1024 * 1024):
                    output.write(block)
    return selected


class DesktopUpdater:
    def __init__(self, bundle, assets, data):
        # pywebview recursively exposes every public attribute. Paths and the native
        # window must stay private: traversing the window can block API initialization.
        self._bundle, self._assets, self._data = map(Path, (bundle, assets, data))
        self._window = None
        self._lock = threading.Lock()
        self._state = {'status': 'idle'}
        self._candidate = None
        self._export_folders = {(self._data / 'exports').resolve()}

    def choose_export_directory(self):
        import webview
        folder = Path.home() / 'Downloads'
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders') as key:
                folder = Path(os.path.expandvars(winreg.QueryValueEx(key, '{374DE290-123F-4565-9164-39C4925E467B}')[0]))
        except (OSError, ImportError):
            pass
        selected = self._window.create_file_dialog(webview.FileDialog.FOLDER, directory=str(folder))
        if not selected:
            return None
        target = Path(selected[0]).resolve()
        if not target.is_dir():
            raise ValueError('请选择一个现有文件夹')
        self._export_folders.add(target)
        return str(target)

    def open_export(self, path, folder=False):
        target = Path(path).resolve()
        if target.parent not in self._export_folders or target.suffix.lower() != '.mp4' or not target.is_file():
            raise ValueError('找不到已导出的视频，请检查保存位置')
        os.startfile(str(target.parent if folder else target))
        return True

    def update_status(self):
        with self._lock:
            return dict(self._state)

    def _set(self, **state):
        with self._lock:
            self._state = state

    def check_update(self, manual=False):
        if not getattr(sys, 'frozen', False):
            return {'status': 'idle'}
        with self._lock:
            if self._state['status'] in ('checking', 'connecting', 'downloading', 'installing'):
                return dict(self._state)
            self._state = {'status': 'checking'}
        threading.Thread(target=self._check, kwargs={'manual': manual}, daemon=True).start()
        return self.update_status()

    def _check(self, manual=False):
        try:
            request = urllib.request.Request(API, headers={'Accept': 'application/vnd.github+json', 'User-Agent': 'Pujian/' + VERSION})
            # urlopen caches its first ProxyHandler for the lifetime of the process.
            # A fresh opener reads current Windows/environment proxy settings.
            with urllib.request.build_opener().open(request, timeout=15) as response:
                releases = json.loads(response.read(2 * 1024**2))
            self._candidate = choose_update(releases)
            self._set(status='available', version=self._candidate['version']) if self._candidate else self._set(status='current' if manual else 'idle')
        except Exception as error:
            logging.exception('Update check failed (offline use is unaffected)')
            self._set(status='check-error', error=str(error)) if manual else self._set(status='idle')

    def install_update(self):
        with self._lock:
            if self._state['status'] not in ('available', 'error') or not self._candidate:
                return dict(self._state)
            self._state = {'status': 'connecting', 'version': self._candidate['version']}
        threading.Thread(target=self._install, daemon=True).start()
        return self.update_status()

    def _install(self):
        try:
            network = urllib.request.build_opener()
            # Local readiness checks must not pass through a newly enabled proxy.
            local = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with local.open('http://127.0.0.1:18765/api/desktop/update-ready', timeout=5) as response:
                if not json.load(response)['ready']:
                    raise RuntimeError('请等待当前处理完成后再更新。')
            # Probe write access before downloading; no elevation or silent privilege changes.
            with tempfile.TemporaryFile(dir=self._bundle):
                pass
            stage = Path(tempfile.mkdtemp(prefix='update-', dir=self._data))
            candidate = dict(self._candidate)
            archive = stage / 'update.zip'
            digest, received = hashlib.sha256(), 0
            request = urllib.request.Request(candidate['url'], headers={'User-Agent': 'Pujian/' + VERSION})
            try:
                response = network.open(request, timeout=30)
            except urllib.error.HTTPError:
                raise  # Keep server errors distinct from an unavailable connection.
            except (urllib.error.URLError, TimeoutError) as error:
                raise RuntimeError('无法连接更新服务器。请检查网络或开启代理，再点击“重试更新”，无需重启软件。') from error
            with response, archive.open('wb') as output:
                self._set(status='downloading', version=candidate['version'], progress=0)
                while block := response.read(1024 * 1024):
                    received += len(block)
                    if received > candidate['size']:
                        raise ValueError('更新包大小不符。')
                    output.write(block)
                    digest.update(block)
                    self._set(status='downloading', version=candidate['version'], progress=round(received / candidate['size'] * 100))
            if received != candidate['size'] or digest.hexdigest() != candidate['sha256']:
                raise ValueError('更新包校验失败，请重试。')
            base = json.loads((self._bundle / 'build-info.json').read_text(encoding='utf-8'))['version']
            files = extract_patch(archive, stage / 'files', candidate['version'], base)
            with local.open('http://127.0.0.1:18765/api/desktop/update-ready', timeout=5) as response:
                if not json.load(response)['ready']:
                    raise RuntimeError('请等待当前处理完成后再更新。')
            # Use this version's trusted installer, never execute a downloaded script directly.
            import shutil
            shutil.copy2(self._assets / 'update-install.ps1', stage / 'install.ps1')
            plan = stage / 'plan.json'
            plan.write_text(json.dumps({'pid': os.getpid(), 'bundle': str(self._bundle), 'stage': str(stage),
                                       'data': str(self._data), 'files': files}), encoding='utf-8')
            powershell = Path(os.environ['SystemRoot']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
            subprocess.Popen([str(powershell), '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
                              '-File', str(stage / 'install.ps1'), '-Plan', str(plan)],
                             creationflags=subprocess.CREATE_NO_WINDOW, cwd=self._data)
            self._set(status='installing')
            self._window.destroy()
        except Exception as error:
            logging.exception('Update installation failed')
            if 'stage' in locals():
                import shutil
                shutil.rmtree(stage, ignore_errors=True)
            self._set(status='error', version=self._candidate['version'], error=str(error))
