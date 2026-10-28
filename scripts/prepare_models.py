"""Copy compatible cached models, or explicitly download missing ones."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def copy_whisper(destination: Path, supplied: Path | None, download: bool):
    from backend.runtime import complete_whisper, local_whisper
    from faster_whisper.utils import download_model
    source = supplied or local_whisper(ROOT / "reference" / "models")
    if source is None:
        if not download:
            raise RuntimeError("没有完整的 Whisper base 缓存。指定 --whisper 路径，或加 --download 下载。")
        source = Path(download_model("base", cache_dir=str(ROOT / "reference" / "models")))
    if not complete_whisper(source):
        raise RuntimeError(f"Whisper 文件不完整：{source}")
    # Verify compatibility before calling this an offline model bundle.
    from faster_whisper import WhisperModel
    WhisperModel(str(source), device="cpu", compute_type="int8")
    destination.mkdir(parents=True, exist_ok=True)
    names = ("config.json", "model.bin", "tokenizer.json", "preprocessor_config.json",
             "vocabulary.txt", "vocabulary.json")
    for name in names:
        file = source / name
        if file.is_file():
            if file.resolve() != (destination / name).resolve():
                shutil.copyfile(file, destination / name)  # Dereference HF cache symlinks.


def copy_demucs(destination: Path, supplied: Path | None, download: bool):
    import torch
    import yaml
    from demucs.pretrained import REMOTE_ROOT, _parse_remote_files, get_model
    from demucs.repo import check_checksum
    source_yaml = (supplied / "htdemucs.yaml") if supplied else REMOTE_ROOT / "htdemucs.yaml"
    config = yaml.safe_load(source_yaml.read_text(encoding="utf-8"))
    signatures = config["models"]
    if not signatures:
        raise RuntimeError("htdemucs.yaml 中没有模型")
    destination.mkdir(parents=True, exist_ok=True)
    search_dirs = ([supplied] if supplied else []) + [
        ROOT / "reference" / "models" / "demucs",
        ROOT / "reference" / "vocals" / "models" / "hub" / "checkpoints",
        Path(torch.hub.get_dir()) / "checkpoints",
    ]
    urls = _parse_remote_files(REMOTE_ROOT / "files.txt")
    for signature in signatures:
        files = [file for folder in search_dirs for file in folder.glob(f"{signature}*.th")
                 if file.is_file() and file.stat().st_size]
        if files:
            source = files[0]
            target = destination / source.name
            if "-" in source.stem:
                check_checksum(source, source.stem.rsplit("-", 1)[1])
            if source.resolve() != target.resolve():
                shutil.copyfile(source, target)
        else:
            if not download:
                raise RuntimeError(f"缺少 htdemucs 权重 {signature}。指定 --demucs 本地目录，或加 --download。")
            url = urls[signature]
            cache_dir = ROOT / "reference" / "vocals" / "models" / "hub" / "checkpoints"
            cache_dir.mkdir(parents=True, exist_ok=True)
            cached = cache_dir / url.rsplit("/", 1)[1]
            partial = cached.with_suffix(".partial")
            print(f"Downloading {url}", flush=True)
            urllib.request.urlretrieve(url, partial)
            check_checksum(partial, cached.stem.rsplit("-", 1)[1])
            partial.replace(cached)
            target = destination / cached.name
            if cached.resolve() != target.resolve():
                shutil.copyfile(cached, target)
    if source_yaml.resolve() != (destination / "htdemucs.yaml").resolve():
        shutil.copyfile(source_yaml, destination / "htdemucs.yaml")
    get_model("htdemucs", repo=destination)  # Validates YAML, hashes and architecture.


def prepare(output: Path, whisper: Path | None = None, demucs: Path | None = None, download=False,
            fast_vocals: Path | None = None):
    output.mkdir(parents=True, exist_ok=True)
    copy_whisper(output / "whisper-base", whisper, download)
    copy_demucs(output / "demucs", demucs, download)
    if fast_vocals is not None:
        from prepare_fast_vocals import prepare as prepare_fast
        prepare_fast(output / 'spleeter-2stems', fast_vocals)
    # Record exact model bytes, without shipping any of the user's audio or project files.
    entries = {}
    for file in sorted(output.rglob("*")):
        if file.is_file() and file.name != "manifest.json":
            digest = hashlib.sha256()
            with file.open("rb") as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(chunk)
            entries[file.relative_to(output).as_posix()] = {"bytes": file.stat().st_size, "sha256": digest.hexdigest()}
    (output / "manifest.json").write_text(json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "reference" / "models" / "portable")
    parser.add_argument("--whisper", type=Path, help="完整的 faster-whisper 模型目录")
    parser.add_argument("--demucs", type=Path, help="含 htdemucs.yaml 和 .th 权重的本地目录")
    parser.add_argument("--download", action="store_true", help="允许下载缺少的模型，默认仅复制本地缓存")
    parser.add_argument("--fast-vocals", type=Path, help="可选：已准备的 Spleeter 快速人声模型目录")
    args = parser.parse_args()
    prepare(args.output.resolve(), args.whisper, args.demucs, args.download, args.fast_vocals)
    print(f"Models ready: {args.output}")
