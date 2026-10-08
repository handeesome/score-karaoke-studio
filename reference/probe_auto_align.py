"""Use the cached sample transcription to inspect candidate alignment."""

import json
from pathlib import Path

from backend.auto_alignment import align_rows, append_repeated_tail, read_score_rows


root = Path(__file__).resolve().parents[1]
project = json.loads((root / "backend/projects/f5d4b676451e483eb2b72b8f4c1a7a1c/project.json").read_text(encoding="utf-8"))
rows = read_score_rows(project["pages"], root / "backend/media")
transcript = []
for file in sorted((root / "reference").glob("whisper-base-*.json")):
    transcript.extend(json.loads(file.read_text(encoding="utf-8"))["segments"])
transcript.sort(key=lambda item: item["start"])
candidates = append_repeated_tail(align_rows(rows, transcript, project["audioDuration"]), transcript, project["audioDuration"])
for index, candidate in enumerate(candidates, 1):
    print(f"{index:02} {candidate['startTime']:6.1f}-{candidate['endTime']:6.1f} {candidate['confidence']:.2f} {candidate['text']} | {candidate['matchedText']}")
