from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Callable

import imageio_ffmpeg
from mutagen.mp3 import MP3

from .frame_renderer import render_frame


def audio_duration(path: Path) -> float:
    return float(MP3(path).info.length)


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
    frame_count = max(1, int(duration * fps + 0.5))
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    command = [
        ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
        "-f", "rawvideo", "-vcodec", "rawvideo", "-pix_fmt", "rgb24",
        "-s:v", f"{width}x{height}", "-r", str(fps), "-i", "pipe:0",
        "-i", str(audio_path), "-map", "0:v:0", "-map", "1:a:0",
        "-t", f"{duration:.6f}", "-c:v", "libx264", "-preset", "veryfast",
        "-crf", "19", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
        "-shortest", "-movflags", "+faststart", str(output_path),
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
            raise RuntimeError(stderr.decode("utf-8", errors="replace")[-3000:] or f"FFmpeg exited with code {return_code}")
    except Exception:
        if process.poll() is None:
            process.kill()
        process.wait()
        raise
    return duration
