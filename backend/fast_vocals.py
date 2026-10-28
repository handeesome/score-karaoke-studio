"""Small CPU-only Spleeter inference for the timeline's vocal waveform.

Model format: k2-fsa/sherpa-onnx Spleeter 2-stem ONNX export.
Audio stays at 44.1 kHz; centred analysis and context trimming preserve timing.
"""
from __future__ import annotations

import os
import hashlib
import importlib.util
import tempfile
import zlib
from pathlib import Path
from typing import Callable

import numpy as np

SAMPLE_RATE = 44100
FFT_SIZE = 4096
HOP = 1024
MODEL_FRAMES = 512
MODEL_BINS = 1024
CORE_SAMPLES = 10 * SAMPLE_RATE
CONTEXT_SAMPLES = round(.8 * SAMPLE_RATE)
MODEL_FILES = ('vocals.fp16.onnx', 'accompaniment.fp16.onnx')
MODEL_SHA256 = {
    'vocals.fp16.onnx': '24cef84aedcd1fe87c0b743ef3370ad34dc1fabf6c9014d6128a75a538c7b668',
    'accompaniment.fp16.onnx': 'd14cea55793cc531a5875f5f4da08207d1c5ab9292e8e0099a104eecb014fcc0',
}


def embedded_models(destination: Path) -> Path | None:
    """Materialize immutable EXE assets into their own versioned cache, without downloads."""
    if importlib.util.find_spec('backend._fast_model_assets') is None:
        return None
    try:
        validate_models(destination)
        return destination
    except (OSError, RuntimeError):
        pass
    from backend import _fast_model_assets

    destination.mkdir(parents=True, exist_ok=True)
    for name, compressed in _fast_model_assets.PAYLOADS.items():
        # The asset table is built into the application, but still constrain writes.
        if name not in (*MODEL_FILES, 'manifest.json', 'Spleeter-LICENSE.txt', 'sherpa-onnx-LICENSE.txt'):
            raise RuntimeError('内置人声模型包含不支持的文件')
        content = zlib.decompress(compressed)
        if name in MODEL_SHA256 and hashlib.sha256(content).hexdigest() != MODEL_SHA256[name]:
            raise RuntimeError('内置人声模型校验失败')
        with tempfile.NamedTemporaryFile(dir=destination, prefix='asset-', delete=False) as output:
            temporary = Path(output.name)
            output.write(content)
        try:
            temporary.replace(destination / name)
        finally:
            temporary.unlink(missing_ok=True)
    validate_models(destination)
    return destination


def validate_models(directory: Path):
    for name, expected in MODEL_SHA256.items():
        path = directory / name
        digest = hashlib.sha256()
        with path.open('rb') as source:
            for block in iter(lambda: source.read(1024 * 1024), b''):
                digest.update(block)
        if digest.hexdigest() != expected:
            raise RuntimeError(f'快速人声模型校验失败：{name}，请重新安装快速模型包。')


def decode_stereo(path: Path) -> np.ndarray:
    import av

    chunks = []
    resampler = av.AudioResampler(format='fltp', layout='stereo', rate=SAMPLE_RATE)
    with av.open(str(path)) as source:
        frames = iter(source.decode(audio=0))
        while True:
            try:
                frame = next(frames)
            except StopIteration:
                break
            except av.error.InvalidDataError:
                # Match the existing decoder: skip damaged MP3 packets, then continue.
                continue
            chunks.extend(part.to_ndarray() for part in resampler.resample(frame))
        chunks.extend(part.to_ndarray() for part in resampler.resample(None))
    if not chunks:
        raise RuntimeError('音频中没有可解码的声音')
    return np.concatenate(chunks, axis=1).astype(np.float32, copy=False)


def cpu_threads() -> int:
    value = int(os.environ.get('PUJIAN_VOCAL_THREADS', '2'))
    return max(1, min(value, os.cpu_count() or 1))


def load_sessions(directory: Path, threads: int | None = None):
    import onnxruntime as ort

    options = ort.SessionOptions()
    options.intra_op_num_threads = threads or cpu_threads()
    options.inter_op_num_threads = 1
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    options.add_session_config_entry('session.intra_op.allow_spinning', '0')
    sessions = [ort.InferenceSession(str(directory / name), sess_options=options,
                                    providers=['CPUExecutionProvider']) for name in MODEL_FILES]
    for session in sessions:
        node = session.get_inputs()[0]
        if node.type != 'tensor(float)' or node.shape[0] != 2 or node.shape[2:] != [MODEL_FRAMES, MODEL_BINS]:
            raise RuntimeError('快速人声模型格式不兼容，请重新安装快速模型包。')
    return sessions


def analysis(audio: np.ndarray) -> np.ndarray:
    """Return channels x frames x bins, with frame zero centred at sample zero."""
    padded = np.pad(audio, ((0, 0), (FFT_SIZE // 2, FFT_SIZE // 2)))
    frames = np.lib.stride_tricks.sliding_window_view(padded, FFT_SIZE, axis=1)[:, ::HOP]
    window = np.hanning(FFT_SIZE + 1)[:-1].astype(np.float32)
    return np.fft.rfft(frames * window, axis=-1).astype(np.complex64)


def synthesis(spectrum: np.ndarray, length: int) -> np.ndarray:
    frames = np.fft.irfft(spectrum, n=FFT_SIZE, axis=-1).astype(np.float32)
    window = np.hanning(FFT_SIZE + 1)[:-1].astype(np.float32)
    output = np.zeros((2, (frames.shape[1] - 1) * HOP + FFT_SIZE), dtype=np.float32)
    weights = np.zeros(output.shape[1], dtype=np.float32)
    for i in range(frames.shape[1]):
        start = i * HOP
        output[:, start:start + FFT_SIZE] += frames[:, i] * window
        weights[start:start + FFT_SIZE] += window * window
    output /= np.maximum(weights, 1e-8)
    return output[:, FFT_SIZE // 2:FFT_SIZE // 2 + length]


def separate_chunk(audio: np.ndarray, sessions) -> np.ndarray:
    spectrum = analysis(audio)
    frames = spectrum.shape[1]
    if frames > MODEL_FRAMES:
        raise ValueError('Audio chunk exceeds the fast model frame limit')
    magnitudes = np.abs(spectrum[:, :, :MODEL_BINS])
    feed = np.pad(magnitudes, ((0, 0), (0, MODEL_FRAMES - frames), (0, 0)))[:, None]
    estimates = [session.run(None, {session.get_inputs()[0].name: feed})[0][:, 0, :frames]
                 for session in sessions]
    vocal_power = np.square(estimates[0])
    mask = (vocal_power + 5e-11) / (vocal_power + np.square(estimates[1]) + 1e-10)
    spectrum[:, :, :MODEL_BINS] *= mask
    spectrum[:, :, MODEL_BINS:] = 0
    return synthesis(spectrum, audio.shape[1])


def separate_audio(audio: np.ndarray, sessions, on_chunk: Callable[[int, int], None] | None = None) -> np.ndarray:
    if audio.ndim != 2 or audio.shape[0] != 2 or audio.shape[1] == 0:
        raise ValueError('Expected non-empty stereo audio')
    output = np.empty_like(audio, dtype=np.float32)
    total = audio.shape[1]
    for start in range(0, total, CORE_SAMPLES):
        end = min(start + CORE_SAMPLES, total)
        left, right = max(0, start - CONTEXT_SAMPLES), min(total, end + CONTEXT_SAMPLES)
        separated = separate_chunk(audio[:, left:right], sessions)
        output[:, start:end] = separated[:, start - left:end - left]
        if on_chunk:
            on_chunk(end, total)
    return output
