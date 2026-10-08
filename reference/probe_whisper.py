"""Offline sample probe; never writes to the active project."""

import json
import sys
from pathlib import Path

from faster_whisper import WhisperModel


ROOT = Path(__file__).resolve().parents[1]
AUDIO = next((ROOT / "backend" / "media").glob("*.mp3"))
START = float(sys.argv[1]) if len(sys.argv) > 1 else 0.0
END = float(sys.argv[2]) if len(sys.argv) > 2 else 90.0
OUTPUT = ROOT / "reference" / f"whisper-base-{int(START)}-{int(END)}s.json"

print("Loading local Whisper base model", flush=True)
model = WhisperModel("base", device="cpu", compute_type="int8", download_root=str(ROOT / "reference" / "models"))
print(f"Transcribing {START:g}-{END:g} seconds", flush=True)
segments, info = model.transcribe(
    str(AUDIO),
    language="zh",
    clip_timestamps=f"{START},{END}",
    word_timestamps=True,
    beam_size=5,
    condition_on_previous_text=False,
)
result = {"language": info.language, "segments": []}
for segment in segments:
    result["segments"].append({
        "start": segment.start,
        "end": segment.end,
        "text": segment.text,
        "words": [
            {"start": word.start, "end": word.end, "text": word.word}
            for word in segment.words or []
        ],
    })
    print(f"{segment.start:6.2f}-{segment.end:6.2f} {segment.text}", flush=True)

OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"Saved {OUTPUT}", flush=True)
