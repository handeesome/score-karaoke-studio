"""Local, reviewable score-to-audio alignment suggestions."""

from __future__ import annotations

import csv
import io
import re
import shutil
import subprocess
from difflib import SequenceMatcher
from pathlib import Path
from statistics import median

import numpy as np
from PIL import Image


HAN = re.compile(r"[\u3400-\u9fff]")
TRADITIONAL = str.maketrans(
    "這愛們門聽從給將與過無為開聲裡來會時說見對讓還個東處風後間親長樂嗎總願歲樣別終離帶領進頭腳角斷醫治碎淚滿廣顯麗",
    "这爱们门听从给将与过无为开声里来会时说见对让还个东处风后间亲长乐吗总愿岁样别终离带领进头脚角断医治碎泪满广显丽",
)


def normalize(value: str) -> str:
    return "".join(HAN.findall(value.translate(TRADITIONAL)))


def _tesseract() -> str:
    found = shutil.which("tesseract")
    if found:
        return found
    windows = Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe")
    if windows.is_file():
        return str(windows)
    raise RuntimeError("缺少 Tesseract OCR，请安装中文识别语言包后重试")


def read_score_rows(pages: list[dict], media_dir: Path) -> list[dict]:
    """Read lyric rows and rearrange repeated verse rows into singing order."""
    all_systems: list[list[dict]] = []
    for page in pages:
        url = page.get("image", "")
        if not url.startswith("/media/"):
            continue
        image_path = (media_dir / url.removeprefix("/media/")).resolve()
        if not image_path.is_relative_to(media_dir.resolve()) or not image_path.is_file():
            continue
        with Image.open(image_path) as source:
            source = source.convert("RGB")
            factor = min(1.0, 2200 / source.width)
            image = source.resize((round(source.width * factor), round(source.height * factor)))
            output = io.BytesIO()
            image.save(output, format="PNG")
        result = subprocess.run(
            [_tesseract(), "stdin", "stdout", "-l", "chi_sim+eng", "--psm", "11", "tsv"],
            input=output.getvalue(), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            timeout=120, check=False,
        )
        if result.returncode:
            raise RuntimeError("乐谱文字识别失败；请确认 Tesseract 安装了 chi_sim 语言包")
        words = []
        for item in csv.DictReader(io.StringIO(result.stdout.decode("utf-8-sig", errors="replace")), delimiter="\t"):
            if item.get("level") != "5":
                continue
            text = normalize(item.get("text", ""))
            try:
                confidence = float(item["conf"])
                x, y, width, height = (int(item[key]) for key in ("left", "top", "width", "height"))
            except (TypeError, ValueError, KeyError):
                continue
            if text and confidence >= 35 and height > 8:
                words.append({"text": text, "x": x, "y": y, "width": width, "height": height, "cy": y + height / 2})
        if not words:
            continue
        height_med = median(word["height"] for word in words)
        row_groups: list[list[dict]] = []
        for word in sorted(words, key=lambda item: item["cy"]):
            if row_groups and abs(word["cy"] - median(item["cy"] for item in row_groups[-1])) <= height_med * .48:
                row_groups[-1].append(word)
            else:
                row_groups.append([word])
        rows = []
        for group in row_groups:
            group.sort(key=lambda item: item["x"])
            text = "".join(item["text"] for item in group)
            if len(text) < 5:
                continue
            top = min(item["y"] for item in group)
            bottom = max(item["y"] + item["height"] for item in group)
            left = min(item["x"] for item in group)
            right = max(item["x"] + item["width"] for item in group)
            padding = max(5, height_med * .24)
            region = {
                "x": max(0.0, (left - padding) / image.width),
                "y": max(0.0, (top - padding) / image.height),
                "width": min(1.0, (right - left + padding * 2) / image.width),
                "height": min(1.0, (bottom - top + padding * 2) / image.height),
            }
            region["width"] = min(region["width"], 1 - region["x"])
            region["height"] = min(region["height"], 1 - region["y"])
            rows.append({"pageId": page["id"], "text": text, "region": region, "y": (top + bottom) / 2})
        if not rows:
            continue
        rows.sort(key=lambda item: item["y"])
        row_gap = median(b["y"] - a["y"] for a, b in zip(rows, rows[1:])) if len(rows) > 1 else height_med * 2
        systems: list[list[dict]] = []
        for row in rows:
            if not systems or row["y"] - systems[-1][-1]["y"] > max(row_gap * 1.8, height_med * 2.5):
                systems.append([])
            systems[-1].append(row)
        # Isolated headings and credits above/below the score are not lyric verses.
        systems = [system for system in systems if len(system) >= 2]
        all_systems.extend(systems)
    if not all_systems:
        raise RuntimeError("没有识别出可用的歌词行；可先手工划行再自动对时")
    # A score with parallel verses is read across all staves for verse 1, then verse 2.
    verse_count = max(len(system) for system in all_systems)
    if verse_count > 4 or sum(len(system) == verse_count for system in all_systems) < max(1, len(all_systems) // 2):
        return [row for system in all_systems for row in system]
    return [system[verse] for verse in range(verse_count) for system in all_systems if verse < len(system)]


def _similarity(score: str, heard: str) -> float:
    if not score or not heard:
        return 0.0
    a, b = normalize(score), normalize(heard)
    if not a or not b:
        return 0.0
    matcher = SequenceMatcher(None, a, b, autojunk=False)
    matching = sum(block.size for block in matcher.get_matching_blocks())
    if matching < 2:
        return 0.0
    return .55 * matching / min(len(a), len(b)) + .45 * matching / max(len(a), len(b))


def align_rows(rows: list[dict], transcript: list[dict], duration: float) -> list[dict]:
    """Monotone phrase matching, with interpolation where recognition is weak."""
    phrases = [item for item in transcript if normalize(item.get("text", "")) and float(item.get("end", 0)) > float(item.get("start", 0))]
    if not phrases:
        raise RuntimeError("未从音频识别出可用于对齐的唱词")
    # Each row may span several Whisper phrases, or only its opening words may be recognized.
    proposals: list[list[tuple[float, int, int]]] = []
    for row in rows:
        choices = []
        for start in range(len(phrases)):
            for stop in range(start + 1, min(len(phrases), start + 4) + 1):
                heard = "".join(item["text"] for item in phrases[start:stop])
                similarity = _similarity(row["text"], heard)
                if similarity >= .34:
                    duration_penalty = max(0, float(phrases[stop - 1]["end"]) - float(phrases[start]["start"]) - 19) * .012
                    choices.append((similarity - duration_penalty, start, stop))
        proposals.append(sorted(choices, reverse=True)[:50])
    # Dynamic programming keeps repeated refrains in audio order. Unmatched rows remain interpolated.
    states: dict[int, tuple[float, list[tuple[float, int, int] | None]]] = {0: (0.0, [])}
    for row_index, choices in enumerate(proposals):
        next_states: dict[int, tuple[float, list[tuple[float, int, int] | None]]] = {}
        for previous_end, (score, history) in states.items():
            keep = next_states.get(previous_end)
            if keep is None or score - .07 > keep[0]:
                next_states[previous_end] = (score - .07, history + [None])
            for choice in choices:
                match_score, start, stop = choice
                if start < previous_end:
                    continue
                previous_match = next(((i, item) for i, item in reversed(list(enumerate(history))) if item is not None), None)
                gap_penalty = 0.0
                if previous_match:
                    previous_row, previous_choice = previous_match
                    previous_time = float(phrases[previous_choice[2] - 1]["end"])
                    gap = float(phrases[start]["start"]) - previous_time
                    # More unrecognized score rows justify a longer audio gap.
                    allowance = 3 + 11 * max(0, row_index - previous_row - 1)
                    gap_penalty = max(0.0, gap - allowance) * .018
                value = score + match_score - .34 - gap_penalty
                current = next_states.get(stop)
                if current is None or value > current[0]:
                    next_states[stop] = (value, history + [choice])
        states = next_states
    _, history = max(states.values(), key=lambda item: item[0])

    starts: list[float | None] = [None] * len(rows)
    confidence = [0.0] * len(rows)
    matches = [""] * len(rows)
    for index, choice in enumerate(history):
        if choice is None:
            continue
        value, start, stop = choice
        heard = "".join(item["text"] for item in phrases[start:stop])
        # A match to a short prefix gives a reliable beginning, not the whole-row duration.
        starts[index] = float(phrases[start]["start"])
        coverage = min(1.0, len(normalize(heard)) / max(1, len(normalize(rows[index]["text"]))))
        confidence[index] = min(.95, max(.2, value * (.45 + .55 * coverage)))
        matches[index] = heard
    # Discard anchors that crowd the previous row; their text may be a repeated refrain.
    for index in range(1, len(starts)):
        if starts[index] is not None and starts[index - 1] is not None and starts[index] - starts[index - 1] < 1.0:
            if confidence[index] <= confidence[index - 1]:
                starts[index] = None
                confidence[index] = 0
            else:
                starts[index - 1] = None
                confidence[index - 1] = 0
    weighted = [max(4, len(normalize(row["text"]))) for row in rows]
    known = [index for index, value in enumerate(starts) if value is not None]
    if not known:
        raise RuntimeError("乐谱歌词与音频转写没有找到可信的对应；请先手动定位几处")
    # Interpolate missing rows by syllable count rather than visual pixel width.
    first = known[0]
    for index in range(first - 1, -1, -1):
        starts[index] = max(0.0, float(starts[index + 1]) - weighted[index] * .42)
    for left, right in zip(known, known[1:]):
        span = sum(weighted[left:right])
        elapsed = weighted[left]
        for index in range(left + 1, right):
            starts[index] = float(starts[left]) + (float(starts[right]) - float(starts[left])) * elapsed / max(1, span)
            elapsed += weighted[index]
    for index in range(known[-1] + 1, len(rows)):
        starts[index] = min(duration - .1, float(starts[index - 1]) + weighted[index - 1] * .42)
    result = []
    for index, row in enumerate(rows):
        start = max(0.0, min(duration - .1, float(starts[index] or 0)))
        next_start = float(starts[index + 1]) if index + 1 < len(rows) else duration
        end = max(start + .1, min(duration, next_start - .08))
        result.append({
            "pageId": row["pageId"], "region": row["region"], "text": row["text"],
            "startTime": round(start, 3), "endTime": round(end, 3),
            "confidence": round(confidence[index], 2), "matchedText": matches[index],
            "source": "识别匹配" if confidence[index] else "按相邻乐句推算",
        })
    return result


def refine_interpolated_starts(candidates: list[dict], audio_path: Path) -> list[dict]:
    """Snap only interpolated phrase boundaries to a nearby, strong spectral onset."""
    from faster_whisper.audio import decode_audio

    audio = decode_audio(str(audio_path), sampling_rate=16000)
    hop, width = 320, 1024
    if len(audio) < width:
        return candidates
    frames = np.lib.stride_tricks.sliding_window_view(audio, width)[::hop]
    spectrum = np.log1p(np.abs(np.fft.rfft(frames * np.hanning(width), axis=1)))
    flux = np.maximum(0, np.diff(spectrum, axis=0)).mean(axis=1)
    center = float(np.median(flux))
    spread = float(np.median(np.abs(flux - center))) or 1e-6
    for index, item in enumerate(candidates):
        if index == 0 or item["confidence"] > 0:
            continue
        estimate = item["startTime"]
        start = max(1, round((estimate - .28) * 50))
        stop = min(len(flux) - 1, round((estimate + .28) * 50))
        if stop <= start:
            continue
        peaks = [i for i in range(start, stop) if flux[i] > flux[i - 1] and flux[i] >= flux[i + 1]]
        if not peaks:
            continue
        best = max(peaks, key=lambda i: (flux[i] - center) / spread - abs((i + 1) / 50 - estimate) * 3)
        if flux[best] < center + 2 * spread:
            continue
        adjusted = round((best + 1) / 50, 3)
        if adjusted <= candidates[index - 1]["startTime"] + .2 or (index + 1 < len(candidates) and adjusted >= candidates[index + 1]["startTime"] - .2):
            continue
        item["startTime"] = adjusted
        candidates[index - 1]["endTime"] = round(max(candidates[index - 1]["startTime"] + .1, adjusted - .08), 3)
        item["source"] = "歌词顺序＋波形起音推算"
    return candidates


def append_repeated_tail(candidates: list[dict], transcript: list[dict], duration: float) -> list[dict]:
    """Suggest a repeated final two score rows when the outro sings them again."""
    if len(candidates) < 3:
        return candidates
    phrases = [item for item in transcript if normalize(item.get("text", ""))]
    last_start = candidates[-1]["startTime"]

    def best_match(reference: str, earliest: float, latest: float) -> tuple[float, float, str, float] | None:
        options = []
        for start, item in enumerate(phrases):
            beginning = float(item["start"])
            if beginning < earliest or beginning > latest:
                continue
            for stop in range(start + 1, min(start + 4, len(phrases)) + 1):
                ending = float(phrases[stop - 1]["end"])
                if ending - beginning > 18:
                    continue
                heard = "".join(chunk["text"] for chunk in phrases[start:stop])
                score = _similarity(reference, heard)
                options.append((score, beginning, heard, ending))
        if not options:
            return None
        return max(options)

    previous = best_match(candidates[-2]["text"], last_start + 4, duration - 10)
    if not previous or previous[0] < .42:
        return candidates
    final = best_match(candidates[-1]["text"], previous[3] - .2, duration - 2)
    if not final or final[0] < .58 or previous[0] + final[0] < 1.08 or final[1] - previous[1] < 4:
        return candidates
    if previous[1] - last_start < 4:
        return candidates
    candidates[-1]["endTime"] = round(previous[1] - .08, 3)
    for template, start, end, score, heard in (
        (candidates[-2], previous[1], final[1] - .08, previous[0], previous[2]),
        (candidates[-1], final[1], duration, final[0], final[2]),
    ):
        candidates.append({**template, "startTime": round(start, 3), "endTime": round(end, 3),
                           "confidence": round(min(.65, score * .7), 2), "matchedText": heard,
                           "source": "重复乐句推测"})
    return candidates


def suggest(project: dict, media_dir: Path, models_dir: Path, audio_path: Path, duration: float, update=lambda _: None) -> list[dict]:
    from faster_whisper import WhisperModel

    update("正在识别乐谱歌词")
    rows = read_score_rows(project.get("pages", []), media_dir)
    update(f"已找到 {len(rows)} 行歌词，正在识别音频")
    model = WhisperModel("base", device="cpu", compute_type="int8", download_root=str(models_dir))
    # Music confuses speech VAD: it can remove sustained vocals along with accompaniment.
    chunks, _ = model.transcribe(str(audio_path), language="zh", word_timestamps=False,
                                 beam_size=5, condition_on_previous_text=False, vad_filter=False)
    transcript = []
    for chunk in chunks:
        transcript.append({"start": chunk.start, "end": chunk.end, "text": chunk.text})
    update("正在按歌词顺序和波形起音匹配时间")
    candidates = align_rows(rows, transcript, duration)
    candidates = append_repeated_tail(candidates, transcript, duration)
    return refine_interpolated_starts(candidates, audio_path)
