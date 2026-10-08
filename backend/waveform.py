"""Compact waveform data computed from the imported audio, not decoration."""

from functools import lru_cache
import numpy as np
from faster_whisper.audio import decode_audio


@lru_cache(maxsize=16)
def waveform_for_audio(path: str, modified_ns: int, bins: int = 720) -> dict:
    # The mtime is part of the cache key so replacing a file refreshes its waveform.
    _ = modified_ns
    samples = decode_audio(path, sampling_rate=16000)
    if samples.size == 0:
        raise ValueError("音频中没有可解码的声音")
    edges = np.linspace(0, samples.size, bins + 1, dtype=np.int64)
    levels = np.empty(bins, dtype=np.float32)
    peaks = np.empty(bins, dtype=np.float32)
    for index in range(bins):
        section = samples[edges[index]:edges[index + 1]]
        levels[index] = float(np.sqrt(np.mean(np.square(section)))) if section.size else 0
        peaks[index] = float(np.max(np.abs(section))) if section.size else 0
    level_reference = max(float(np.quantile(levels, .98)), .0001)
    peak_reference = max(float(np.quantile(peaks, .98)), .0001)
    normalized = np.clip(levels / level_reference, 0, 1)
    normalized_peaks = np.maximum(np.clip(peaks / peak_reference, 0, 1), normalized)
    return {
        "duration": round(samples.size / 16000, 3),
        "levels": [round(float(value), 3) for value in normalized],
        "peaks": [round(float(value), 3) for value in normalized_peaks],
        "kind": "mix-rms",
    }
