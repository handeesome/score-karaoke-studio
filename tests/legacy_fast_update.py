"""Exercise the unmodified v0.1.5 installer and both old ZIP validators on a test copy."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from PyInstaller.archive.readers import CArchiveReader
from desktop.version import VERSION


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, required=True, help='Isolated bundle produced by frozen_fast_vocals.py')
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--old-archive', type=Path, required=True)
    args = parser.parse_args()
    bundle = args.bundle.resolve()
    # Refuse to run this test on a live or user-supplied installation.
    if not bundle.parent.name.startswith('frozen-fast-') or bundle.parent.parent != ROOT / 'build':
        raise ValueError('Use only an isolated frozen-fast test installation')
    data = bundle.parent / 'legacy-update-data'
    data.mkdir(exist_ok=True)
    stage = data / 'update-legacy-test'
    stage.mkdir(exist_ok=True)
    selected = None
    for version in ('0.1.5', '0.1.6'):
        reader = CArchiveReader(str(ROOT / f'build/patch-{version}/Pujian.exe'))
        pyz = reader.open_embedded_archive(next(name for name in reader.toc if name.endswith('.pyz')))
        namespace = {'__name__': f'legacy_{version.replace(".", "_")}'}
        exec(pyz.extract('desktop.updater'), namespace)
        selected = namespace['extract_patch'](args.archive, stage / 'files', VERSION, '0.1.0')
        print(f'Unmodified {version} ZIP validator accepted {len(selected)} program/UI files', flush=True)
    with zipfile.ZipFile(args.old_archive) as archive:
        old_installer = archive.read('_internal/update-install.ps1')
    assert b'-WindowStyle Hidden' in old_installer
    installer = data / 'legacy-0.1.5-installer.ps1'
    installer.write_bytes(old_installer)
    shutil.copyfile(ROOT / 'build/patch-0.1.5/Pujian.exe', bundle / 'Pujian.exe')
    plan = data / 'plan.json'
    plan.write_text(json.dumps({'pid': 2147483647, 'bundle': str(bundle), 'stage': str(stage),
                                'data': str(data), 'files': selected}), encoding='utf-8')
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    environment = {key: value for key, value in os.environ.items()
                   if not key.startswith('PUJIAN_') and key != 'HF_HUB_OFFLINE'}
    environment.update(PUJIAN_DATA_DIR=str(data), PUJIAN_TEST_PORT=str(port))
    powershell = Path(os.environ['SystemRoot']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
    subprocess.run([str(powershell), '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
                    '-File', str(installer), '-Plan', str(plan)], check=True, env=environment,
                   creationflags=subprocess.CREATE_NO_WINDOW, timeout=120)
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/desktop/health', timeout=2) as response:
                assert json.load(response)['version'] == VERSION
            log = (data / 'desktop.log').read_text(encoding='utf-8')
            if 'Desktop window shown: visible=True; within_work_area=True' in log:
                report = {'version': VERSION, 'legacyInstaller': '0.1.5', 'visible': True,
                          'withinWorkArea': True, 'bundle': str(bundle), 'data': str(data), 'port': port}
                (data / 'result.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
                print(json.dumps(report), flush=True)
                return
        except (OSError, ValueError):
            pass
        time.sleep(.25)
    raise RuntimeError('Legacy restart did not show the new window; see ' + str(data))


if __name__ == '__main__':
    main()
