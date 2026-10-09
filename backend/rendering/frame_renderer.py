from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from PIL import Image

from .scrolling import calculate_camera_target, calculate_progress, ease_in_out

BG = (246, 245, 239)
INK_HIGHLIGHT = (222, 75, 45)


@lru_cache(maxsize=24)
def _open_page(path: str, target_width: int) -> Image.Image:
    with Image.open(path) as source:
        ratio = target_width / source.width
        target_height = max(1, round(source.height * ratio))
        return source.convert("RGB").resize((target_width, target_height), Image.Resampling.LANCZOS)


@lru_cache(maxsize=24)
def _ink_mask(path: str, target_width: int) -> Image.Image:
    """Opaque on dark printed ink, transparent on paper and pale scan noise."""
    luminance = _open_page(path, target_width).convert("L")
    values = [max(0, min(255, round(1020 - 5 * value))) for value in range(256)]
    return luminance.point(values)


def resolve_page_path(page: dict, media_dir: Path) -> Path:
    image_ref = page.get("image", "")
    if not image_ref.startswith("/media/"):
        raise ValueError("乐谱页图片路径无效")
    path = (media_dir / image_ref.removeprefix("/media/")).resolve()
    try:
        path.relative_to(media_dir.resolve())
    except ValueError as error:
        raise ValueError("乐谱页图片路径超出项目目录") from error
    if not path.is_file():
        raise FileNotFoundError(f"找不到乐谱图片：{path.name}")
    return path


def _page_layout(page: dict, media_dir: Path, width: int, height: int, zoom: float):
    path = resolve_page_path(page, media_dir)
    scaled_width = max(1, round(width * zoom))
    image = _open_page(str(path), scaled_width)
    ink_mask = _ink_mask(str(path), scaled_width)
    x = (width - image.width) // 2
    y_padding = max(0, (height - image.height) // 2)
    return image, x, y_padding, ink_mask


def _scroll_events(segments: list[dict], page_cache: dict, height: int, safe_zone: float):
    events: list[dict] = []
    camera_by_page: dict[str, float] = {}
    last_page: str | None = None
    for segment in sorted(segments, key=lambda item: (float(item.get("startTime", 0)), item["id"])):
        page_id = segment["pageId"]
        image, _, y_padding, _ = page_cache[page_id]
        if page_id != last_page:
            camera_by_page[page_id] = 0.0
            events.append({"time": float(segment["startTime"]), "from": 0.0, "to": 0.0, "pageId": page_id, "reset": True})
            last_page = page_id
        current = camera_by_page.get(page_id, 0.0)
        region = segment["region"]
        center = y_padding + (float(region["y"]) + float(region["height"]) / 2) * image.height
        target = calculate_camera_target(center, image.height, height, current, safe_zone)
        if abs(target - current) > 0.5:
            events.append({"time": float(segment["startTime"]), "from": current, "to": target, "pageId": page_id})
            camera_by_page[page_id] = target
    return events


def _camera_at(events: list[dict], page_id: str, at: float, height: int, image_height: int) -> float:
    current = 0.0
    for event in events:
        if event["pageId"] != page_id or event["time"] > at:
            continue
        if event.get("reset"):
            current = 0.0
            continue
        fraction = (at - event["time"]) / 0.65
        current = event["from"] + (event["to"] - event["from"]) * ease_in_out(fraction)
    return max(0.0, min(max(0.0, image_height - height), current))


def _segment_for_time(segments: list[dict], at: float):
    ordered = sorted(segments, key=lambda item: (float(item.get("startTime", 0)), item["id"]))
    if not ordered:
        return None, None
    for index, segment in enumerate(ordered):
        if float(segment["startTime"]) <= at < float(segment["endTime"]):
            return segment, index
    prior = [(index, seg) for index, seg in enumerate(ordered) if float(seg["endTime"]) <= at]
    if prior:
        index, segment = prior[-1]
        return segment, index
    return ordered[0], 0


def _draw_one(project: dict, at: float, width: int, height: int, zoom: float, safe_zone: float, page_cache: dict, events: list[dict], segment: dict | None, show_highlight: bool = True) -> Image.Image:
    frame = Image.new("RGB", (width, height), BG)
    if not project.get("pages"):
        return frame
    page_id = segment["pageId"] if segment else project["pages"][0]["id"]
    page = next((p for p in project["pages"] if p["id"] == page_id), project["pages"][0])
    image, x_offset, y_padding, ink_mask = page_cache[page["id"]]
    camera_y = _camera_at(events, page["id"], at, height, image.height)
    page_y = round(y_padding - camera_y)
    frame.paste(image, (x_offset, page_y))

    if segment and show_highlight:
        progress = calculate_progress(float(segment["startTime"]), float(segment["endTime"]), [], at)
        region = segment["region"]
        left = max(0, round(float(region["x"]) * image.width))
        top = max(0, round(float(region["y"]) * image.height))
        region_width = round(float(region["width"]) * image.width)
        region_height = round(float(region["height"]) * image.height)
        reveal = max(0, min(region_width, round(region_width * progress)))
        right = min(image.width, left + reveal)
        bottom = min(image.height, top + region_height)
        if right > left and bottom > top:
            mask = ink_mask.crop((left, top, right, bottom))
            tint = Image.new("RGB", mask.size, INK_HIGHLIGHT)
            frame.paste(tint, (x_offset + left, page_y + top), mask)
    return frame


def render_frame(project: dict, at: float, width: int, height: int, zoom: float = 1.0, safe_zone: float | None = None, media_dir: Path | None = None) -> Image.Image:
    media_dir = media_dir or Path(__file__).resolve().parents[1] / "media"
    safe_zone = safe_zone if safe_zone is not None else (0.50 if height > width else 0.58)
    pages = {page["id"]: _page_layout(page, media_dir, width, height, zoom) for page in project.get("pages", [])}
    segments = sorted(project.get("segments", []), key=lambda item: (float(item.get("startTime", 0)), item["id"]))
    events = _scroll_events(segments, pages, height, safe_zone)
    segment, index = _segment_for_time(segments, at)
    frame = _draw_one(project, at, width, height, zoom, safe_zone, pages, events, segment)

    if segment is not None and index and at - float(segment["startTime"]) < 0.18:
        previous = segments[index - 1]
        if previous["pageId"] != segment["pageId"]:
            old = _draw_one(project, float(segment["startTime"]) - 0.001, width, height, zoom, safe_zone, pages, events, previous, False)
            blend = max(0.0, min(1.0, (at - float(segment["startTime"])) / 0.18))
            frame = Image.blend(old, frame, blend)
    return frame
