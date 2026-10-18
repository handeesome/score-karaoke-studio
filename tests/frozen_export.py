"""Verify a built Windows EXE exports an actual score from isolated user data.

Run: .venv\Scripts\python.exe tests/frozen_export.py --bundle <Pujian directory>
Never reads user projects or contacts model download services.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid

import imageio_ffmpeg
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from desktop.version import VERSION
from desktop.windows_job import WindowsJob


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, required=True)
    args = parser.parse_args()
    bundle = args.bundle.resolve()
    exe = bundle / 'Pujian.exe'
    assert exe.is_file(), exe
    # Do not connect to or terminate a running user's instance.
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 18765))
    (ROOT / 'build').mkdir(exist_ok=True)
    data = Path(tempfile.mkdtemp(prefix='frozen-export-', dir=ROOT / 'build'))
    project_id = uuid.uuid4().hex
    image = data / 'media' / project_id / 'pages' / 'page-001.png'
    image.parent.mkdir(parents=True)
    Image.new('RGB', (320, 440), (32, 96, 160)).save(image)
    audio = data / 'media' / 'original.mp3'
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    subprocess.run([ffmpeg, '-y', '-v', 'error', '-f', 'lavfi', '-i',
                    'sine=frequency=997:duration=0.3', '-c:a', 'libmp3lame', str(audio)],
                   check=True, capture_output=True)
    image_hash = hashlib.sha256(image.read_bytes()).hexdigest()
    project = {
        'projectName': 'desktop-export-check', 'scoreTimingBound': True,
        'source': {'pdf': 'sample.png', 'audio': 'original.mp3', 'audioUrl': '/media/original.mp3'},
        'pages': [{'id': 'p1', 'image': f'/media/{project_id}/pages/page-001.png', 'width': 320, 'height': 440}],
        'segments': [{'id': 's1', 'pageId': 'p1', 'region': {'x': .1, 'y': .1, 'width': .8, 'height': .1},
                      'startTime': 0, 'endTime': .2, 'timingSet': True}],
        'flags': [{'id': 'f1', 'segmentId': 's1', 'kind': 'start', 'time': 0}],
        'highlight': {'mode': 'full', 'opacity': .32},
    }
    token = uuid.uuid4().hex
    env = {key: value for key, value in os.environ.items() if not key.startswith('PUJIAN_')}
    env.update(PUJIAN_DATA_DIR=str(data), PUJIAN_START_TOKEN=token)
    def request(path, method='GET', body=None):
        payload = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request('http://127.0.0.1:18765' + path, data=payload, method=method,
                                     headers={'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=10) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            raise RuntimeError(f'{method} {path}: {error.code} {error.read().decode("utf-8", errors="replace")}') from error
    job = WindowsJob()
    process = None
    try:
        with (data / 'test-backend.log').open('wb') as log:
            process = subprocess.Popen([str(exe), '--serve'], cwd=bundle, env=env, stdout=log, stderr=log,
                                       creationflags=subprocess.CREATE_NO_WINDOW)
            job.add(process)
            deadline = time.monotonic() + 90
            while True:
                assert process.poll() is None, f'Backend exited; see {data}'
                try:
                    health = json.loads(request('/api/desktop/health'))
                    assert health['token'] == token
                    assert health['version'] == VERSION, health
                    break
                except OSError:
                    assert time.monotonic() < deadline, f'Backend startup timed out; see {data}'
                    time.sleep(.2)
            request(f'/api/projects/{project_id}', 'PUT', project)
            preview = request(f'/api/projects/{project_id}/preview?width=320&height=320')
            assert Image.open(io.BytesIO(preview)).getpixel((160, 160)) == (32, 96, 160)
            assert json.loads(request(f'/api/projects/{project_id}/validate', 'POST'))['valid']
            started = json.loads(request(f'/api/projects/{project_id}/export', 'POST',
                                         {'preset': 'square', 'width': 320, 'height': 320, 'fps': 30, 'scoreZoom': 1}))
            deadline = time.monotonic() + 45
            while True:
                status = json.loads(request('/api/exports/' + started['jobId']))
                assert status['status'] != 'failed', status
                if status['status'] == 'completed':
                    break
                assert time.monotonic() < deadline, status
                time.sleep(.2)
            output = data / 'exports' / status['file']
            assert output.stat().st_size > 0
            assert request(status['downloadUrl']) == output.read_bytes()
            def packet_hash(path):
                return subprocess.run([ffmpeg, '-v', 'error', '-i', str(path), '-map', '0:a:0',
                                       '-c:a', 'copy', '-f', 'hash', '-hash', 'sha256', '-'],
                                      check=True, capture_output=True).stdout
            assert packet_hash(audio) == packet_hash(output)
            assert hashlib.sha256(image.read_bytes()).hexdigest() == image_hash
            result = {'ok': True, 'version': VERSION, 'preview': True, 'videoExport': True,
                      'originalAudioPreserved': True, 'imageUnchanged': True}
            (data / 'result.json').write_text(json.dumps(result), encoding='utf-8')
            print(json.dumps(result), flush=True)
    finally:
        job.close()
        if process is not None:
            process.wait(timeout=10)


if __name__ == '__main__':
    main()
