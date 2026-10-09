"""Suggest lyric rectangles from OCR rows and unusually wide blank spaces."""

from math import ceil
from pathlib import Path
from typing import Callable

import numpy as np
from PIL import Image

from backend.auto_alignment import read_score_rows, text_in_region


def suggest_boxes(pages: list[dict], media_dir: Path, rows: list[dict] | None = None,
                  update: Callable[[str, int], None] | None = None) -> list[dict]:
    if rows is None:
        if update:
            update("正在识别乐谱上的歌词行", 5)
        rows = read_score_rows(pages, media_dir,
                               (lambda done, total: update(f"已识别 {done}/{total} 页乐谱", 5 + round(60 * done / total)))
                               if update else None)
    page_paths = {}
    for page in pages:
        url = page.get("image", "")
        if not url.startswith("/media/"):
            continue
        path = (media_dir / url.removeprefix("/media/")).resolve()
        if path.is_relative_to(media_dir.resolve()) and path.is_file():
            page_paths[page["id"]] = path

    page_grays = {}
    for page_id, path in page_paths.items():
        with Image.open(path) as source:
            page_grays[page_id] = np.asarray(source.convert("L"))
    page_bounds = {}
    page_centers = {}
    for page_id in page_paths:
        page_rows = [row for row in rows if row["pageId"] == page_id]
        if not page_rows:
            continue
        page_bounds[page_id] = (
            max(0.0, min(row["region"]["x"] for row in page_rows) - .01),
            min(1.0, max(row["region"]["x"] + row["region"]["width"] for row in page_rows) + .01),
        )
        page_centers[page_id] = sorted(row["region"]["y"] + row["region"]["height"] / 2 for row in page_rows)

    boxes: list[dict] = []
    for row_index, row in enumerate(rows):
        if update:
            update(f"正在拆分第 {row_index + 1}/{len(rows)} 行歌词", 65 + round(30 * row_index / len(rows)))
        gray = page_grays.get(row["pageId"])
        if gray is None:
            continue
        image_height, image_width = gray.shape
        region = row["region"]
        center = region["y"] + region["height"] / 2
        centers = page_centers[row["pageId"]]
        above = [value for value in centers if value < center - .001]
        below = [value for value in centers if value > center + .001]
        other_centers = [abs(value - center) for value in centers if abs(value - center) > .001]
        nearest = min(other_centers) if other_centers else 1.0
        scan_height = min(region["height"], nearest * .72)
        x_start, x_end = page_bounds[row["pageId"]]
        left = max(0, int(x_start * image_width))
        right = min(image_width, int(x_end * image_width))
        scan_top = max(0, int((center - scan_height / 2) * image_height))
        scan_bottom = min(image_height, int((center + scan_height / 2) * image_height))
        crop = gray[scan_top:scan_bottom, left:right]
        if crop.size == 0:
            continue
        # The narrow scan band is only for finding horizontal gaps. Keep the
        # full OCR row in the final box so its upper strokes are not clipped.
        upper_limit = (max(above) + center) / 2 if above else 0.0
        lower_limit = (min(below) + center) / 2 if below else 1.0
        row_top = region["y"]
        row_bottom = row_top + region["height"]
        padded_top = max(upper_limit, row_top - region["height"] * .12)
        padded_bottom = min(lower_limit, row_bottom + region["height"] * .06)
        box_top = max(0, int(min(row_top, padded_top) * image_height))
        box_bottom = min(image_height, ceil(max(row_bottom, padded_bottom) * image_height))
        # The row comes from Chinese OCR. A wide gap is meaningful only relative
        # to the text height; normal spacing between individual characters stays.
        ink = np.count_nonzero(crop < 150, axis=0) >= max(2, round(crop.shape[0] * .06))
        occupied = np.flatnonzero(ink)
        if occupied.size == 0:
            continue
        first, last = int(occupied[0]), int(occupied[-1]) + 1
        minimum_gap = max(14, round(crop.shape[0] * 1.35))
        split_points = [first]
        for a, b in zip(occupied[:-1], occupied[1:]):
            gap = int(b - a - 1)
            if gap >= minimum_gap and a - split_points[-1] >= crop.shape[0] * 1.1 and last - b >= crop.shape[0] * 1.1:
                split_points.append(int((a + b) / 2))
        split_points.append(last)
        minimum_part_width = max(crop.shape[0] * 1.6, image_width * .04)
        part_index = 0
        while part_index < len(split_points) - 1 and len(split_points) > 2:
            start, stop = split_points[part_index:part_index + 2]
            within = occupied[(occupied >= start) & (occupied < stop)]
            span = int(within[-1] - within[0]) if within.size else 0
            if span < minimum_part_width:
                del split_points[part_index + 1 if part_index < len(split_points) - 2 else part_index]
                part_index = max(0, part_index - 1)
            else:
                part_index += 1
        for part, (start, stop) in enumerate(zip(split_points, split_points[1:]), start=1):
            within = occupied[(occupied >= start) & (occupied < stop)]
            if within.size == 0:
                continue
            x0 = max(0, left + int(within[0]) - 5)
            x1 = min(image_width, left + int(within[-1]) + 6)
            if x1 - x0 < crop.shape[0] * 1.1:
                continue
            box_region = {"x": x0 / image_width, "y": box_top / image_height,
                          "width": (x1 - x0) / image_width, "height": (box_bottom - box_top) / image_height}
            boxes.append({
                "pageId": row["pageId"],
                "region": box_region, "sourceText": text_in_region(row, box_region),
                "row": row_index + 1, "part": part,
            })
    if not boxes:
        raise RuntimeError("没有找到可用的歌词标注区域")
    return boxes
