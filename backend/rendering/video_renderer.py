from __future__ import annotations

import math
import subprocess
from pathlib import Path
from typing import Callable

import imageio_ffmpeg
from mutagen import File as AudioFile
from mutagen.mp4 import MP4
from mutagen.mp3 import MP3
from mutagen.oggvorbis import OggVorbis
from mutagen.wave import WAVE

from .frame_renderer import render_frame


def audio_duration(path: Path) -> float:
    parsed = AudioFile(str(path))
    if parsed is None or not getattr(parsed, "info", None):
        parser = {".mp3": MP3, ".wav": WAVE, ".m4a": MP4, ".ogg": OggVorbis}.get(path.suffix.lower())
        if parser:
            parsed = parser(path)
    duration = float(parsed.info.length) if parsed is not None and getattr(parsed, "info", None) else 0
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError("无法读取原音频时长，请检查音频文件")
    return duration


def _encoding_error(stderr: bytes, return_code: int) -> RuntimeError:
    detail = stderr.decode("utf-8", errors="replace")[-3000:]
    if "codec not currently supported in container" in detail.lower() or "could not find tag for codec" in detail.lower():
        return RuntimeError("这种音频编码无法原样放入 MP4，导出已停止，未对音频进行转码。请使用兼容 MP4 的原音频文件。")
    return RuntimeError(detail or f"FFmpeg exited with code {return_code}")


def encode_video(
    project: dict,
    audio_path: Path,
    output_path: Path,
    width: int,
    height: int,
    fps: int = 30,
    score_zoom: float = 1.0,
    safe_zone: float | None = None,
    progress: Callable[[float], None] | None = None,
) -> float:
    duration = audio_duration(audio_path)
    frame_count = max(1, math.ceil(duration * fps))
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    command = [
        ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
        "-f", "rawvideo", "-vcodec", "rawvideo", "-pix_fmt", "rgb24",
        "-s:v", f"{width}x{height}", "-r", str(fps), "-i", "pipe:0",
        "-i", str(audio_path), "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "libx264", "-preset", "veryfast",
        "-crf", "19", "-pix_fmt", "yuv420p", "-c:a", "copy",
        # Let both inputs reach EOF. -t/-shortest can discard the last audio packets.
        "-movflags", "+faststart", str(output_path),
    ]
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    try:
        assert process.stdin is not None
        for index in range(frame_count):
            at = min(duration, index / fps)
            frame = render_frame(project, at, width, height, score_zoom, safe_zone)
            process.stdin.write(frame.tobytes())
            if progress and (index % fps == 0 or index + 1 == frame_count):
                progress((index + 1) / frame_count)
        process.stdin.close()
        stderr = process.stderr.read() if process.stderr else b""
        return_code = process.wait()
        if return_code:
            raise _encoding_error(stderr, return_code)
    except Exception as error:
        if process.poll() is None:
            process.kill()
        return_code = process.wait()
        if isinstance(error, (BrokenPipeError, OSError)) and process.stderr:
            stderr = process.stderr.read()
            if stderr:
                raise _encoding_error(stderr, return_code) from error
        raise
    finally:
        for stream in (process.stdin, process.stderr):
            if stream is not None and not stream.closed:
                try:
                    stream.close()
                except OSError:
                    pass
    return duration
