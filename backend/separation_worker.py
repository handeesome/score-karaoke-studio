"""Run Demucs in an isolated process and publish real segment progress."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import time
import traceback


def run_fast(args, reporter, model_dir):
    import subprocess
    import numpy as np
    from imageio_ffmpeg import get_ffmpeg_exe
    from backend.fast_vocals import (SAMPLE_RATE, cpu_threads, decode_stereo,
                                    load_sessions, separate_audio, validate_models)

    threads = cpu_threads()
    reporter.write('loading', '正在加载人声模型', None, model='spleeter-2stems-fp16', threads=threads)
    validate_models(model_dir)
    sessions = load_sessions(model_dir, threads)
    reporter.write('decoding', '正在读取音频', None)
    audio = decode_stereo(args.audio)
    completed = 0

    def on_chunk(end, total):
        nonlocal completed
        completed += 1
        reporter.write('separating', '正在分离人声', round(5 + 90 * end / total, 1),
                       completedSegments=completed, processedSeconds=round(end / SAMPLE_RATE, 1),
                       durationSeconds=round(total / SAMPLE_RATE, 1), model='spleeter-2stems-fp16', threads=threads)

    vocals = separate_audio(audio, sessions, on_chunk)
    reporter.write('saving', '正在保存人声音轨', 97)
    target = args.output / 'spleeter-2stems' / args.audio.stem / 'vocals.mp3'
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name('vocals.partial.mp3')
    # Encoding is only for the cached analysis stem. Video exports keep the original audio.
    subprocess.run([get_ffmpeg_exe(), '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SAMPLE_RATE),
                    '-ac', '2', '-i', 'pipe:0', '-c:a', 'libmp3lame', '-b:a', '192k', str(partial)],
                   input=np.ascontiguousarray(vocals.T).tobytes(), stdout=subprocess.DEVNULL,
                   stderr=subprocess.PIPE, check=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    partial.replace(target)
    reporter.write('separated', '人声音轨已生成', 98, model='spleeter-2stems-fp16', threads=threads)


class ProgressReporter:
    def __init__(self, path: Path):
        self.path = path
        self.started = time.monotonic()
        self.completed = set()
        self.fraction = 0.0
        self.samplerate = 44100
        self.stride = int(7 * .9 * self.samplerate)

    def write(self, phase: str, stage: str, progress: float | None, **fields):
        record = dict(phase=phase, stage=stage, progress=progress, updatedAt=time.time(),
                      elapsedSeconds=round(time.monotonic() - self.started, 1), **fields)
        temporary = self.path.with_suffix('.tmp')
        temporary.write_text(json.dumps(record, ensure_ascii=False), encoding='utf-8')
        for attempt in range(8):
            try:
                temporary.replace(self.path)
                break
            except PermissionError:
                if attempt == 7:
                    raise
                time.sleep(.025)
        with self.path.with_suffix('.jsonl').open('a', encoding='utf-8') as log:
            log.write(json.dumps(record, ensure_ascii=False) + '\n')

    def callback(self, event: dict):
        if event.get('state') != 'end':
            return
        key = (event.get('model_idx_in_bag', 0), event.get('shift_idx', 0), event['segment_offset'])
        if key in self.completed:
            return
        self.completed.add(key)
        length = max(1, event['audio_length'])
        models = max(1, event.get('models', 1))
        # Account for overlap without double counting, including the random-shift tail.
        covered = min(self.stride, max(0, length - event['segment_offset']))
        self.fraction = min(1.0, self.fraction + covered / length / models)
        self.write('separating', '正在分离人声', round(5 + 90 * self.fraction, 1),
                   completedSegments=len(self.completed), processedSeconds=round(length / self.samplerate * self.fraction, 1),
                   durationSeconds=round(length / self.samplerate, 1))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audio', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--progress-file', type=Path, required=True)
    parser.add_argument('--repo', type=Path)
    parser.add_argument('--engine', choices=('auto', 'htdemucs'), default='auto')
    args = parser.parse_args(argv)
    args.output.mkdir(parents=True, exist_ok=True)
    reporter = ProgressReporter(args.progress_file)
    try:
        from backend.runtime import local_fast_vocals
        fast_models = local_fast_vocals() if args.engine == 'auto' else None
        if fast_models is not None:
            run_fast(args, reporter, fast_models)
            return
        reporter.write('loading', '正在加载人声模型', None)
        import torch
        from backend.fast_vocals import cpu_threads
        torch.set_num_threads(cpu_threads())
        from demucs.api import Separator, save_audio
        separator = Separator(model='htdemucs', repo=args.repo, device='cpu', shifts=1,
                              segment=7, overlap=.1, jobs=0, progress=False, callback=reporter.callback)
        reporter.samplerate = separator.samplerate
        reporter.stride = int(.9 * 7 * separator.samplerate)
        reporter.write('decoding', '正在读取音频', None)
        _, stems = separator.separate_audio_file(args.audio)
        reporter.write('saving', '正在保存人声音轨', 97)
        target = args.output / 'htdemucs' / args.audio.stem / 'vocals.mp3'
        target.parent.mkdir(parents=True, exist_ok=True)
        partial = target.with_name('vocals.partial.mp3')
        save_audio(stems['vocals'], partial, samplerate=separator.samplerate, bitrate=192)
        partial.replace(target)  # Only a fully saved stem may be reused after a restart.
        reporter.write('separated', '人声音轨已生成', 98)
    except Exception as error:
        reporter.write('failed', '人声分离失败', None, error=str(error), traceback=traceback.format_exc())
        raise


if __name__ == '__main__':
    main()
