"""Extract a vocal stem locally and cache its waveform for the timeline."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import logging
import os
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Callable

from backend.waveform import waveform_for_audio
from imageio_ffmpeg import get_ffmpeg_exe

_generation_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def separator_available() -> bool:
    if importlib.util.find_spec('demucs') is not None:
        return True
    from backend.runtime import local_fast_vocals
    return importlib.util.find_spec('onnxruntime') is not None and local_fast_vocals() is not None


def cache_key(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()[:24]


def vocal_waveform_for_audio(path: Path, cache_root: Path, update: Callable[[str, dict], None]) -> dict:
    work_dir = cache_root / cache_key(path)
    with _locks_guard:
        lock = _generation_locks.setdefault(str(work_dir.resolve()), threading.Lock())
    if not lock.acquire(blocking=False):
        update('正在复用进行中的人声分离', {'phase': 'waiting', 'progress': None})
        while not lock.acquire(timeout=1):
            try:
                details = json.loads((work_dir / 'progress.json').read_text(encoding='utf-8'))
                if details.get('stage'):
                    update(details['stage'], {key: value for key, value in details.items()
                                             if key not in ('stage', 'elapsedSeconds')})
            except (OSError, ValueError):
                pass
    try:
        return _generate_vocal_waveform(path, cache_root, update)
    finally:
        lock.release()


def _generate_vocal_waveform(path: Path, cache_root: Path, update: Callable[[str, dict], None]) -> dict:
    work_dir = cache_root / cache_key(path)
    cached = work_dir / "waveform.json"
    if cached.is_file():
        logging.info("Vocal cache hit: waveform=%s", cached)
        return json.loads(cached.read_text(encoding="utf-8"))
    vocals = next((stem for stem in work_dir.glob("*/**/vocals.mp3") if stem.is_file() and stem.stat().st_size > 0), None)
    if vocals is None and not separator_available():
        raise RuntimeError("尚未安装人声分离组件 Demucs；请按 README 的「人声波形」步骤安装")

    work_dir.mkdir(parents=True, exist_ok=True)
    if vocals is None:
        logging.info("Vocal cache miss: key=%s directory=%s; starting separation", work_dir.name, work_dir)
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
        from backend.runtime import local_demucs, local_fast_vocals
        fast_models = local_fast_vocals()
        repo = None if fast_models else local_demucs()
        logging.info('Vocal engine=%s', 'spleeter-2stems-fp16' if fast_models else 'htdemucs')
        update("正在加载人声模型" if fast_models or repo else "正在准备人声模型，首次使用可能需要下载",
               {"phase": "loading", "progress": None})
        worker = ([sys.executable, "--separate-vocals"] if getattr(sys, "frozen", False)
                  else [sys.executable, "-m", "backend.separation_worker"])
        progress_file = work_dir / 'progress.json'
        # Ignore status from an earlier failed/cancelled attempt.
        progress_file.write_text('{}', encoding='utf-8')
        command = [
            *worker, '--audio', str(path.resolve()), '--output', str(work_dir.resolve()),
            '--progress-file', str(progress_file.resolve()),
        ]
        if repo:
            command.extend(["--repo", str(repo)])
        started = time.monotonic()
        latest = {}
        with (work_dir / 'separation.log').open('a', encoding='utf-8') as log:
            process = subprocess.Popen(command, env=environment, cwd=str(Path(__file__).resolve().parent.parent),
                                       stdout=log, stderr=log, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            try:
                while True:
                    try:
                        latest = json.loads(progress_file.read_text(encoding='utf-8'))
                    except (OSError, ValueError):
                        pass
                    if latest:
                        update(latest['stage'], {key: value for key, value in latest.items()
                                                if key not in ('stage', 'elapsedSeconds')})
                    code = process.poll()
                    if code is not None:
                        try:
                            latest = json.loads(progress_file.read_text(encoding='utf-8'))
                        except (OSError, ValueError):
                            pass
                        break
                    if time.monotonic() - started > 3600:
                        raise RuntimeError('人声分离超过一小时，已停止；请检查电脑内存或换较短的音频')
                    time.sleep(1)
            finally:
                if process.poll() is None:
                    process.kill()
                process.wait()
        if code != 0:
            raise RuntimeError('人声分离失败：' + latest.get('error', f'请查看 {progress_file.with_suffix(".jsonl")}'))

        vocals = next((stem for stem in work_dir.glob("*/**/vocals.mp3") if stem.is_file() and stem.stat().st_size > 0), None)
    else:
        logging.info("Vocal cache hit: stem=%s; generating waveform only", vocals)
        update("已找到上次分离的人声，正在生成波形", {"phase": "waveform", "progress": 98})
    if vocals is None:
        raise RuntimeError("分离完成，但没有找到人声音轨")
    update("正在生成人声波形", {"phase": "waveform", "progress": 98})
    waveform = {**waveform_for_audio(str(vocals), vocals.stat().st_mtime_ns), "kind": "vocal-rms"}
    temporary = work_dir / "waveform.tmp"
    temporary.write_text(json.dumps(waveform, ensure_ascii=False), encoding="utf-8")
    temporary.replace(cached)
    return waveform
