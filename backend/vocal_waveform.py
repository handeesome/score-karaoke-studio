"""Extract a vocal stem locally and cache its waveform for the timeline."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Callable

from backend.waveform import waveform_for_audio
from imageio_ffmpeg import get_ffmpeg_exe


def separator_available() -> bool:
    return importlib.util.find_spec("demucs") is not None


def cache_key(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()[:24]


def vocal_waveform_for_audio(path: Path, cache_root: Path, update: Callable[[str], None]) -> dict:
    work_dir = cache_root / cache_key(path)
    cached = work_dir / "waveform.json"
    if cached.is_file():
        return json.loads(cached.read_text(encoding="utf-8"))
    vocals = next((stem for stem in work_dir.glob("*/**/vocals.mp3") if stem.is_file() and stem.stat().st_size > 0), None)
    if vocals is None and not separator_available():
        raise RuntimeError("尚未安装人声分离组件 Demucs；请按 README 的「人声波形」步骤安装")

    work_dir.mkdir(parents=True, exist_ok=True)
    if vocals is None:
        model_dir = cache_root / "models"
        model_dir.mkdir(parents=True, exist_ok=True)
        tools_dir = cache_root / "bin"
        tools_dir.mkdir(parents=True, exist_ok=True)
        ffmpeg = tools_dir / "ffmpeg.exe"
        if not ffmpeg.is_file():
            bundled = Path(get_ffmpeg_exe())
            try:
                os.link(bundled, ffmpeg)
            except OSError:
                shutil.copy2(bundled, ffmpeg)
        environment = os.environ.copy()
        environment["TORCH_HOME"] = str(model_dir)
        environment["PATH"] = str(tools_dir) + os.pathsep + environment.get("PATH", "")
        update("正在分离人声；首次运行会下载模型，CPU 处理可能需要几分钟")
        command = [
            sys.executable, "-m", "demucs", "--two-stems=vocals", "--other-method", "none",
            "-n", "htdemucs", "-d", "cpu", "--segment", "7", "--overlap", "0.1",
            "--mp3", "--mp3-bitrate", "192",
            "--out", str(work_dir), str(path),
        ]
        try:
            completed = subprocess.run(
                command, env=environment, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, timeout=3600, check=False,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except subprocess.TimeoutExpired as error:
            raise RuntimeError("人声分离超时；可检查电脑内存或换较短的音频") from error
        if completed.returncode != 0:
            details = (completed.stdout or "").strip().splitlines()
            raise RuntimeError("人声分离失败：" + (details[-1] if details else "模型运行出错"))

        vocals = next((stem for stem in work_dir.glob("*/**/vocals.mp3") if stem.is_file() and stem.stat().st_size > 0), None)
    else:
        update("已找到上次分离的人声，正在生成波形")
    if vocals is None:
        raise RuntimeError("分离完成，但没有找到人声音轨")
    update("正在生成纯人声波形")
    waveform = {**waveform_for_audio(str(vocals), vocals.stat().st_mtime_ns), "kind": "vocal-rms"}
    temporary = work_dir / "waveform.tmp"
    temporary.write_text(json.dumps(waveform, ensure_ascii=False), encoding="utf-8")
    temporary.replace(cached)
    return waveform
