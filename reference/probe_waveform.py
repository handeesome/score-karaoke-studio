"""Inspect short-time energy in the sample mix; no model inference."""

from pathlib import Path

import numpy as np
from faster_whisper.audio import decode_audio


audio_path = next((Path(__file__).resolve().parents[1] / "backend" / "media").glob("*.mp3"))
audio = decode_audio(str(audio_path), sampling_rate=16000)
window = 320  # 20 ms
rms = np.sqrt(np.mean(audio[: len(audio) // window * window].reshape(-1, window) ** 2, axis=1))


def describe(label: str, start: float, end: float) -> None:
    values = rms[round(start * 50) : round(end * 50)]
    q10, median, q90 = np.quantile(values, [0.1, 0.5, 0.9])
    print(f"{label:20} {start:6.2f}-{end:6.2f}s  RMS 10/50/90%: {q10:.4f} {median:.4f} {q90:.4f}")


describe("full track", 0, len(rms) / 50)
describe("recognized 4 chars", 24.34, 28.14)
describe("nearby candidate gap", 34.06, 35.24)
describe("second occurrence", 94.58, 98.40)
