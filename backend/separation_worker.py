"""Run Demucs in an isolated process and publish real segment progress."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import time
import traceback


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
    args = parser.parse_args(argv)
    args.output.mkdir(parents=True, exist_ok=True)
    reporter = ProgressReporter(args.progress_file)
    try:
        reporter.write('loading', '正在加载人声模型', None)
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
