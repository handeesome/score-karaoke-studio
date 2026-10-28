"""Prepare the pinned small ONNX model for an offline CPU-fast installation."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil
import sys
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from backend.fast_vocals import MODEL_FILES, MODEL_SHA256, validate_models

MODEL_URL = ('https://github.com/k2-fsa/sherpa-onnx/releases/download/'
             'source-separation-models/sherpa-onnx-spleeter-2stems-fp16.tar.bz2')


def prepare(destination: Path, source: Path | None = None, download=False):
    destination = destination.resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='fast-vocals-', dir=destination.parent) as folder:
        stage = Path(folder)
        if source is None:
            if not download:
                raise RuntimeError('请指定 --source，或加 --download 下载快速模型。')
            archive = stage / 'models.tar.bz2'
            print(f'Downloading {MODEL_URL}', flush=True)
            with urllib.request.urlopen(MODEL_URL, timeout=60) as response, archive.open('wb') as output:
                shutil.copyfileobj(response, output, length=1024 * 1024)
            with tarfile.open(archive) as package:
                # Never extract archive paths or links onto the filesystem.
                for entry in package.getmembers():
                    name = Path(entry.name).name
                    if entry.isfile() and name in MODEL_FILES:
                        with package.extractfile(entry) as stream, (stage / name).open('wb') as output:
                            shutil.copyfileobj(stream, output)
            source = stage
        validate_models(source)
        destination.mkdir(exist_ok=True)
        for name in MODEL_FILES:
            if (source / name).resolve() != (destination / name).resolve():
                partial = destination / (name + '.partial')
                shutil.copyfile(source / name, partial)
                partial.replace(destination / name)
        manifest = {'model': 'spleeter-2stems-fp16', 'source': MODEL_URL,
                    'upstream': 'https://github.com/deezer/spleeter',
                    'onnxExport': 'https://github.com/k2-fsa/sherpa-onnx/tree/master/scripts/spleeter',
                    'sampleRate': 44100, 'sha256': MODEL_SHA256}
        (destination / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
        # Bundled attribution for the original model and ONNX exporter.
        for name, url in (
                ('Spleeter-LICENSE.txt', 'https://raw.githubusercontent.com/deezer/spleeter/master/LICENSE'),
                ('sherpa-onnx-LICENSE.txt', 'https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/master/LICENSE')):
            if (source / name).is_file() and (source / name).resolve() != (destination / name).resolve():
                shutil.copyfile(source / name, destination / name)
            elif not (destination / name).is_file() and download:
                with urllib.request.urlopen(url, timeout=30) as response:
                    (destination / name).write_bytes(response.read())
    return destination


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'reference/models/spleeter-2stems')
    parser.add_argument('--source', type=Path)
    parser.add_argument('--download', action='store_true')
    args = parser.parse_args()
    print(prepare(args.output, args.source, args.download))
