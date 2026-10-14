"""Paths shared by source runs and the portable Windows application."""
from __future__ import annotations

import os
from pathlib import Path

SOURCE_ROOT = Path(__file__).resolve().parent.parent


def data_root() -> Path:
    return Path(os.environ.get("PUJIAN_DATA_DIR", str(SOURCE_ROOT / "backend")))


def whisper_cache() -> Path:
    return Path(os.environ.get("PUJIAN_MODEL_CACHE", str(SOURCE_ROOT / "reference" / "models")))


def vocal_cache() -> Path:
    return Path(os.environ.get("PUJIAN_VOCAL_CACHE", str(SOURCE_ROOT / "reference" / "vocals")))


def offline() -> bool:
    return os.environ.get("PUJIAN_OFFLINE") == "1"


def complete_whisper(path: Path) -> bool:
    # tokenizer.json prevents a fallback tokenizer download during offline use.
    return all((path / name).is_file() and (path / name).stat().st_size > 0
               for name in ("config.json", "model.bin", "tokenizer.json"))


def local_whisper(cache: Path) -> Path | None:
    explicit = os.environ.get("PUJIAN_WHISPER_MODEL")
    if explicit:
        path = Path(explicit).resolve()
        if not complete_whisper(path):
            raise RuntimeError(f"Whisper 模型目录不完整：{path}")
        return path
    bundled = os.environ.get("PUJIAN_BUNDLE_DIR")
    candidates = [cache / "whisper-base"]
    if bundled:
        candidates.insert(0, Path(bundled) / "models" / "whisper-base")
    for path in candidates:
        if complete_whisper(path):
            return path
    # Ask Hugging Face for the cached snapshot, without contacting the network.
    from faster_whisper.utils import download_model
    for cache_dir in (str(cache), None):
        try:
            path = Path(download_model("base", cache_dir=cache_dir, local_files_only=True))
        except (OSError, ValueError):
            continue
        if complete_whisper(path):
            return path
    return None


def whisper_source(cache: Path) -> str:
    found = local_whisper(cache)
    if found:
        return str(found)
    if offline():
        raise RuntimeError("离线包缺少完整的 Whisper 模型，请重新解压完整发行包")
    return "base"


def local_demucs() -> Path | None:
    explicit = os.environ.get("PUJIAN_DEMUCS_REPO")
    bundled = os.environ.get("PUJIAN_BUNDLE_DIR")
    candidates = ([Path(explicit)] if explicit else [])
    if bundled:
        candidates.append(Path(bundled) / "models" / "demucs")
    candidates.append(whisper_cache() / "demucs")
    for path in candidates:
        if not (path / "htdemucs.yaml").is_file():
            if explicit and path == Path(explicit):
                raise RuntimeError(f"Demucs 目录缺少 htdemucs.yaml：{path}")
            continue
        import yaml
        config = yaml.safe_load((path / "htdemucs.yaml").read_text(encoding="utf-8"))
        signatures = config.get("models", []) if isinstance(config, dict) else []
        if signatures and all(any(file.stat().st_size > 0 for file in path.glob(f"{sig}*.th"))
                              for sig in signatures):
            return path.resolve()
        raise RuntimeError(f"Demucs 模型文件不完整：{path}")
    if offline():
        raise RuntimeError("离线包缺少 Demucs 模型，请重新解压完整发行包")
    return None
