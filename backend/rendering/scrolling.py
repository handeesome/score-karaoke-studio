from __future__ import annotations

import math


def calculate_progress(start: float, end: float, anchors: list[dict], at: float) -> float:
    """Return karaoke wipe progress, using optional (time, progress) anchors."""
    if end <= start:
        return 0.0
    points = [(start, 0.0)]
    points.extend((float(a["time"]), float(a["progress"])) for a in anchors)
    points.append((end, 1.0))
    points.sort(key=lambda point: point[0])
    if at <= points[0][0]:
        return points[0][1]
    if at >= points[-1][0]:
        return points[-1][1]
    for (t0, p0), (t1, p1) in zip(points, points[1:]):
        if t0 <= at <= t1:
            if t1 <= t0:
                return p1
            fraction = (at - t0) / (t1 - t0)
            return max(0.0, min(1.0, p0 + (p1 - p0) * fraction))
    return 0.0


def segment_timing_anchors(segment: dict) -> list[dict]:
    """Evenly time cells between cuts unless manual sync anchors exist."""
    anchors = segment.get("anchors") or []
    if anchors:
        return anchors
    cuts = sorted(float(cut) for cut in (segment.get("cuts") or []))
    start, end = float(segment["startTime"]), float(segment["endTime"])
    return [
        {"time": start + (end - start) * (index + 1) / (len(cuts) + 1), "progress": cut}
        for index, cut in enumerate(cuts)
    ]


def calculate_camera_target(
    active_center_y: float,
    page_height: float,
    viewport_height: float,
    current_camera_y: float,
    safe_zone: float = 0.58,
    lower_bound: float = 0.30,
    upper_bound: float = 0.72,
) -> float:
    """Keep the active line in a vertical safe band; hold camera inside the band."""
    max_scroll = max(0.0, page_height - viewport_height)
    current = max(0.0, min(max_scroll, current_camera_y))
    visible_y = active_center_y - current
    if lower_bound * viewport_height <= visible_y <= upper_bound * viewport_height:
        return current
    desired = active_center_y - safe_zone * viewport_height
    return max(0.0, min(max_scroll, desired))


def ease_in_out(progress: float) -> float:
    value = max(0.0, min(1.0, progress))
    return 0.5 - 0.5 * math.cos(math.pi * value)
