"""Verify a manual overlay's real EXE against an isolated copy of the old runtime.

No live app is closed, and the input audio is only read. Test media and data stay in build/.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from backend.waveform import waveform_for_audio
from desktop.version import VERSION


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', type=Path, required=True)
    parser.add_argument('--overlay', type=Path, required=True)
    parser.add_argument('--audio', type=Path, required=True)
    args = parser.parse_args()
    data = Path(tempfile.mkdtemp(prefix='frozen-fast-', dir=ROOT / 'build'))
    bundle = data / 'Pujian'
    base = args.base.resolve()
    for source in base.rglob('*'):
        if not source.is_file():
            continue
        relative = source.relative_to(base)
        # Never overwrite a link to the real installation with overlay contents.
        if (relative.name == 'Pujian.exe' or relative.parts[:2] == ('_internal', 'dist')
                or relative.as_posix() == '_internal/update-install.ps1'
                or relative.parts[:2] == ('models', 'spleeter-2stems')):
            continue
        target = bundle / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            target.hardlink_to(source)
        except OSError:
            shutil.copy2(source, target)
    shutil.copytree(args.overlay, bundle, dirs_exist_ok=True)
    environment = {key: value for key, value in os.environ.items()
                   if not key.startswith('PUJIAN_') and key != 'HF_HUB_OFFLINE'}
    environment.update(PUJIAN_DATA_DIR=str(data / 'data'), HF_HUB_OFFLINE='1')
    output, progress = data / 'output', data / 'progress.json'
    output.mkdir()
    command = [str(bundle / 'Pujian.exe'), '--separate-vocals', '--audio', str(args.audio.resolve()),
               '--output', str(output), '--progress-file', str(progress)]
    started = time.monotonic()
    subprocess.run(command, env=environment, cwd=bundle, check=True, timeout=180,
                   creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    log = (data / 'data/desktop.log').read_text(encoding='utf-8')
    assert f'Pujian {VERSION} starting' in log, log
    state = json.loads(progress.read_text(encoding='utf-8'))
    assert state['phase'] == 'separated' and state['model'] == 'spleeter-2stems-fp16', state
    assert state['threads'] == 2, state
    stem = next(output.glob('*/**/vocals.mp3'))
    waveform = waveform_for_audio(str(stem), stem.stat().st_mtime_ns)
    assert len(waveform['levels']) == len(waveform['peaks']) == 720
    assert max(waveform['levels']) > .1
    report = {'version': VERSION, 'model': state['model'], 'threads': state['threads'],
              'seconds': round(time.monotonic() - started, 3), 'duration': waveform['duration'],
              'bundle': str(bundle), 'data': str(data), 'offline': True}
    (data / 'result.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report), flush=True)


if __name__ == '__main__':
    main()
