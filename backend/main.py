from __future__ import annotations

import re
import shutil
import uuid
import time
import json
import io
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Lock
from typing import Literal

import fitz
from PIL import Image, ImageOps
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from mutagen import File as AudioFile
from mutagen.mp3 import MP3
from mutagen.mp4 import MP4
from mutagen.oggvorbis import OggVorbis
from mutagen.wave import WAVE
from pydantic import BaseModel, Field, model_validator
from backend.models.project import ProjectDocument
from backend.auto_alignment import suggest as suggest_alignment
from backend.auto_boxes import suggest_boxes
from backend.waveform import waveform_for_audio
from backend.vocal_waveform import cache_key as vocal_cache_key, separator_available, vocal_waveform_for_audio
from backend.rendering.frame_renderer import render_frame
from backend.rendering.video_renderer import encode_video
from backend.runtime import data_root, whisper_cache, vocal_cache

ROOT = data_root()
PROJECTS = ROOT / "projects"
MEDIA = ROOT / "media"
EXPORTS = ROOT / "exports"
VOCAL_CACHE = vocal_cache()
PROJECTS.mkdir(parents=True, exist_ok=True)
MEDIA.mkdir(parents=True, exist_ok=True)
EXPORTS.mkdir(parents=True, exist_ok=True)
executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="score-export")
alignment_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="score-alignment")
box_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="score-boxes")
vocal_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="score-vocals")
jobs: dict[str, dict] = {}
jobs_lock = Lock()
alignment_jobs: dict[str, dict] = {}
alignment_lock = Lock()
box_jobs: dict[str, dict] = {}
box_lock = Lock()
vocal_jobs: dict[str, dict] = {}
vocal_jobs_by_audio: dict[str, str] = {}
vocal_lock = Lock()

app = FastAPI(title="谱间本地项目服务", version="0.1.0")
app.mount("/media", StaticFiles(directory=MEDIA), name="media")


def safe_filename(name: str) -> str:
    return re.sub(r"[^\w.\-\u4e00-\u9fff ]", "_", Path(name).name)[:120] or "upload"


class ExportOptions(BaseModel):
    preset: Literal["landscape", "portrait", "social", "square", "custom"] = "landscape"
    width: int = Field(ge=320, le=3840)
    height: int = Field(ge=320, le=3840)
    fps: Literal[30] = 30
    scoreZoom: float = Field(ge=0.5, le=1.5)
    outputDirectory: str | None = None

    @model_validator(mode="after")
    def even_dimensions(self):
        if self.width % 2 or self.height % 2:
            raise ValueError("视频宽高必须为偶数")
        return self


class WaveformRequest(BaseModel):
    audioUrl: str


class AutoBoxesRequest(BaseModel):
    pages: list[dict]


def project_path(project_id: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{32}", project_id):
        raise HTTPException(status_code=400, detail="无效的项目编号")
    path = PROJECTS / project_id / "project.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="找不到该项目")
    return path


def read_project(project_id: str) -> dict:
    return json.loads(project_path(project_id).read_text(encoding="utf-8"))


def resolve_audio(project: dict) -> Path:
    url = project.get("source", {}).get("audioUrl") or ""
    if not url.startswith("/media/"):
        raise FileNotFoundError("请先导入 MP3 音频")
    path = (MEDIA / url.removeprefix("/media/")).resolve()
    try:
        path.relative_to(MEDIA.resolve())
    except ValueError as error:
        raise FileNotFoundError("音频文件路径无效") from error
    if not path.is_file():
        raise FileNotFoundError("找不到项目音频文件")
    return path


def read_audio_duration(path: Path) -> float | None:
    """Read duration even when Mutagen's generic sniffing misses a valid MP3."""
    parsed = AudioFile(str(path))
    if parsed is None or not getattr(parsed, "info", None):
        parser = {".mp3": MP3, ".wav": WAVE, ".m4a": MP4, ".ogg": OggVorbis}.get(path.suffix.lower())
        if parser is not None:
            parsed = parser(path)
    info = getattr(parsed, "info", None) if parsed is not None else None
    return float(info.length) if info is not None else None


def validate_project(project: dict):
    errors: list[str] = []
    warnings: list[str] = []
    segments = sorted(project.get("segments", []), key=lambda item: float(item.get("startTime", 0)))
    timed_ids = {flag.get("segmentId") for flag in project.get("flags", []) if flag.get("kind") != "end"}
    assigned_ids = {segment["id"] for segment in segments if segment.get("timingSet") or segment["id"] in timed_ids}
    if not project.get("pages"):
        errors.append("尚未导入乐谱")
    if not segments:
        errors.append("请至少添加一条乐句标注")
    elif not assigned_ids:
        errors.append("第 1 句尚未设置时间，请先打点")
    try:
        audio_path = resolve_audio(project)
        duration = read_audio_duration(audio_path) or 0.0
        if duration <= 0:
            raise ValueError
    except Exception:
        audio_path = None
        duration = float(project.get("audioDuration") or 0)
        errors.append("找不到可播放的音频文件")

    page_ids = {page.get("id") for page in project.get("pages", [])}
    for index, segment in enumerate(segments, start=1):
        label = f"第 {index} 句"
        start, end = float(segment.get("startTime", -1)), float(segment.get("endTime", -1))
        regions = segment.get("regions") or [{"pageId": segment.get("pageId"), "region": segment.get("region", {})}]
        if segment["id"] in assigned_ids and (start < 0 or end <= start):
            errors.append(f"{label}的结束时间必须晚于开始时间")
        if segment["id"] in assigned_ids and duration and end > duration + 0.05:
            errors.append(f"{label}超出音频时长")
        for part in regions:
            region = part.get("region", {})
            if part.get("pageId") not in page_ids:
                errors.append(f"{label}引用了不存在的乐谱页")
            try:
                x, y, w, h = (float(region[key]) for key in ("x", "y", "width", "height"))
                if min(x, y, w, h) < 0 or w <= 0 or h <= 0 or x + w > 1.000001 or y + h > 1.000001:
                    errors.append(f"{label}的标注区域超出页面范围")
            except (KeyError, TypeError, ValueError):
                errors.append(f"{label}缺少有效的标注区域")
    timed_segments = [segment for segment in segments if segment.get("timingSet") or segment.get("id") in timed_ids]
    unassigned_count = len(segments) - len(assigned_ids)
    if assigned_ids and unassigned_count:
        warnings.append(f"还有 {unassigned_count} 条乐句未放入时间轴，视频只高亮已安排的乐句")
    for previous, current in zip(timed_segments, timed_segments[1:]):
        gap = float(current["startTime"]) - float(previous["endTime"])
        if gap < -0.05:
            warnings.append(f"第 {project['segments'].index(current) + 1} 句与前一句有 {abs(gap):.2f} 秒重叠")
        elif gap > 2.0:
            warnings.append(f"第 {project['segments'].index(current) + 1} 句前有 {gap:.2f} 秒空档")
    return {"valid": not errors, "errors": errors, "warnings": warnings, "duration": duration, "audioPath": audio_path}


def _run_export(job_id: str, project: dict, audio_path: Path, output_path: Path, options: ExportOptions):
    with jobs_lock:
        jobs[job_id]["status"] = "running"
    try:
        def update(value: float):
            with jobs_lock:
                jobs[job_id]["progress"] = round(value, 4)
        duration = encode_video(project, audio_path, output_path, options.width, options.height, options.fps, options.scoreZoom, progress=update)
        with jobs_lock:
            jobs[job_id].update(status="completed", progress=1.0, duration=duration, file=output_path.name, outputPath=str(output_path.resolve()))
    except Exception as error:
        with jobs_lock:
            jobs[job_id].update(status="failed", error=str(error))


def _run_alignment(job_id: str, project: dict, audio_path: Path, duration: float):
    def update(stage: str, progress: int):
        with alignment_lock:
            alignment_jobs[job_id].update(status="running", stage=stage, progress=progress)
    try:
        candidates = suggest_alignment(project, MEDIA, whisper_cache(), audio_path, duration, update)
        with alignment_lock:
            alignment_jobs[job_id].update(status="completed", stage="候选标注已生成", progress=100, candidates=candidates)
    except Exception as error:
        with alignment_lock:
            alignment_jobs[job_id].update(status="failed", error=str(error))


def _run_auto_boxes(job_id: str, pages: list[dict]):
    def update(stage: str, progress: int):
        with box_lock:
            box_jobs[job_id].update(status="running", stage=stage, progress=progress)
    try:
        candidates = suggest_boxes(pages, MEDIA, update=update)
        with box_lock:
            box_jobs[job_id].update(status="completed", stage="候选框已生成", progress=100, candidates=candidates)
    except Exception as error:
        with box_lock:
            box_jobs[job_id].update(status="failed", error=str(error))


@app.put("/api/projects/{project_id}")
def save_project(project_id: str, project: ProjectDocument):
    if not re.fullmatch(r"[a-f0-9]{32}", project_id):
        raise HTTPException(status_code=400, detail="无效的项目编号")
    target = PROJECTS / project_id
    target.mkdir(exist_ok=True)
    payload = project.model_dump(mode="json")
    payload["projectId"] = project_id
    (target / "project.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"saved": True, "projectId": project_id}


@app.post("/api/projects/{project_id}/validate")
def validate_saved_project(project_id: str):
    report = validate_project(read_project(project_id))
    return {key: value for key, value in report.items() if key != "audioPath"}


@app.post("/api/projects/{project_id}/auto-align")
def start_auto_alignment(project_id: str):
    project = read_project(project_id)
    if not project.get("pages"):
        raise HTTPException(status_code=422, detail="请先导入乐谱")
    try:
        audio_path = resolve_audio(project)
        duration = read_audio_duration(audio_path)
    except Exception as error:
        raise HTTPException(status_code=422, detail="请先导入可读取的 MP3 音频") from error
    if not duration or duration <= 0:
        raise HTTPException(status_code=422, detail="无法读取音频时长")
    job_id = uuid.uuid4().hex
    with alignment_lock:
        alignment_jobs[job_id] = {"status": "queued", "stage": "等待本地识别", "progress": 0, "candidates": []}
    alignment_executor.submit(_run_alignment, job_id, project, audio_path, duration)
    return {"jobId": job_id, "status": "queued"}


@app.get("/api/alignments/{job_id}")
def alignment_status(job_id: str):
    with alignment_lock:
        job = alignment_jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="找不到自动对齐任务")
        return dict(job)


@app.get("/api/projects/{project_id}/preview")
def export_preview(project_id: str, time: float = 0, width: int = 1080, height: int = 1920, scoreZoom: float = 1.0):
    if not (320 <= width <= 3840 and 320 <= height <= 3840 and 0.5 <= scoreZoom <= 1.5):
        raise HTTPException(status_code=400, detail="预览尺寸或乐谱缩放比例无效")
    project = read_project(project_id)
    try:
        frame = render_frame(project, time, width, height, scoreZoom, media_dir=MEDIA)
        output = io.BytesIO()
        frame.save(output, format="PNG")
        return Response(content=output.getvalue(), media_type="image/png")
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"无法生成预览：{error}") from error


@app.post("/api/projects/{project_id}/export")
def start_export(project_id: str, options: ExportOptions):
    project = read_project(project_id)
    report = validate_project(project)
    if not report["valid"]:
        raise HTTPException(status_code=422, detail={"errors": report["errors"], "warnings": report["warnings"]})
    job_id = uuid.uuid4().hex
    project_name = safe_filename(project.get("projectName", "score"))
    destination = Path(options.outputDirectory).expanduser().resolve() if options.outputDirectory else EXPORTS
    if not destination.is_dir():
        raise HTTPException(status_code=400, detail="所选导出文件夹不存在，请重新选择")
    output_path = destination / f"{project_name}-{options.preset}-{job_id[:8]}.mp4"
    with jobs_lock:
        jobs[job_id] = {"status": "queued", "progress": 0.0, "warnings": report["warnings"], "file": None}
    executor.submit(_run_export, job_id, project, report["audioPath"], output_path, options)
    return {"jobId": job_id, "status": "queued", "warnings": report["warnings"]}


@app.get("/api/exports/{job_id}")
def export_status(job_id: str):
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="找不到该导出任务")
        return {**job, "downloadUrl": f"/api/exports/{job_id}/download" if job["status"] == "completed" else None}


@app.get("/api/exports/{job_id}/download")
def download_export(job_id: str):
    with jobs_lock:
        job = jobs.get(job_id)
        if not job or job.get("status") != "completed":
            raise HTTPException(status_code=404, detail="导出文件尚未准备好")
        path = Path(job["outputPath"]) if job.get("outputPath") else EXPORTS / job["file"]
    if not path.is_file():
        raise HTTPException(status_code=404, detail="找不到导出文件")
    return FileResponse(path, media_type="video/mp4", filename=path.name)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "谱间本地项目服务"}


@app.post("/api/waveform")
def audio_waveform(request: WaveformRequest):
    try:
        path = resolve_audio({"source": {"audioUrl": request.audioUrl}})
        return waveform_for_audio(str(path), path.stat().st_mtime_ns)
    except (FileNotFoundError, ValueError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


def _run_vocal_waveform(job_id: str, path: Path):
    with vocal_lock:
        vocal_jobs[job_id].update(status="running", startedAt=time.time())
    def update(stage: str, details: dict):
        with vocal_lock:
            vocal_jobs[job_id].update(status="running", stage=stage, **details)

    try:
        result = vocal_waveform_for_audio(path, VOCAL_CACHE, update)
        with vocal_lock:
            vocal_jobs[job_id].update(status="completed", stage="人声波形已生成", waveform=result,
                                      progress=100, finishedAt=time.time())
    except Exception as error:
        with vocal_lock:
            vocal_jobs[job_id].update(status="failed", stage="人声分离失败", error=str(error), finishedAt=time.time())


@app.post("/api/waveform/vocals")
def start_vocal_waveform(request: WaveformRequest):
    try:
        path = resolve_audio({"source": {"audioUrl": request.audioUrl}})
    except FileNotFoundError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    key = vocal_cache_key(path)
    if not separator_available() and not (VOCAL_CACHE / key / "waveform.json").is_file():
        raise HTTPException(status_code=424, detail="尚未安装 Demucs 人声分离组件，请按 README 的「人声波形」步骤安装")
    with vocal_lock:
        existing = vocal_jobs_by_audio.get(key)
        if existing and vocal_jobs[existing]["status"] != "failed":
            return {"jobId": existing, **vocal_jobs[existing]}
        job_id = uuid.uuid4().hex
        vocal_jobs[job_id] = {"status": "queued", "stage": "等待提取人声", "progress": None, "createdAt": time.time()}
        vocal_jobs_by_audio[key] = job_id
    vocal_executor.submit(_run_vocal_waveform, job_id, path)
    return {"jobId": job_id, "status": "queued", "stage": "等待提取人声"}


@app.get("/api/waveform/vocals/{job_id}")
def vocal_waveform_status(job_id: str):
    with vocal_lock:
        job = vocal_jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="找不到人声提取任务")
        now = time.time()
        return {"jobId": job_id, **job,
                "elapsedSeconds": max(0, round(job.get('finishedAt', now) - job.get('createdAt', job.get('startedAt', now)))),
                "lastProgressSeconds": max(0, round(now - job.get('updatedAt', now)))}


@app.post("/api/auto-boxes")
def auto_boxes(request: AutoBoxesRequest):
    job_id = uuid.uuid4().hex
    with box_lock:
        box_jobs[job_id] = {"status": "queued", "stage": "等待识别乐谱", "progress": 0, "candidates": []}
    box_executor.submit(_run_auto_boxes, job_id, request.pages)
    return {"jobId": job_id, "status": "queued"}


@app.get("/api/auto-boxes/{job_id}")
def auto_boxes_status(job_id: str):
    with box_lock:
        job = box_jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="找不到自动框选任务")
        return {"jobId": job_id, **job}


@app.post("/api/import/score")
async def import_score(files: list[UploadFile] = File(...)):
    suffixes = [Path(file.filename or "").suffix.lower() for file in files]
    is_pdf = len(files) == 1 and suffixes == [".pdf"]
    is_images = bool(files) and all(suffix in {".jpg", ".jpeg", ".png", ".webp"} for suffix in suffixes)
    if not (is_pdf or is_images):
        raise HTTPException(status_code=400, detail="请选择一个 PDF，或一次选择多张 JPG、PNG、WebP 乐谱图片")
    if len(files) > 100:
        raise HTTPException(status_code=400, detail="乐谱最多支持 100 页")
    if is_images:
        def natural_name(file: UploadFile):
            return [(0, int(part)) if part.isdigit() else (1, part.casefold())
                    for part in re.split(r"(\d+)", Path(file.filename or "").name)]
        files = sorted(files, key=natural_name)
        suffixes = [Path(file.filename or "").suffix.lower() for file in files]
    project_id = uuid.uuid4().hex
    project_dir = PROJECTS / project_id
    pages_dir = MEDIA / project_id / "pages"
    project_dir.mkdir(parents=True)
    pages_dir.mkdir(parents=True)
    pages = []
    try:
        if is_pdf:
            raw = await files[0].read()
            if not raw.startswith(b"%PDF"):
                raise HTTPException(status_code=400, detail="文件内容不是有效的 PDF")
            (project_dir / "source.pdf").write_bytes(raw)
            with fitz.open(stream=raw, filetype="pdf") as document:
                if document.page_count > 100:
                    raise HTTPException(status_code=400, detail="PDF 页数过多，请使用不超过 100 页的文件")
                scale = 240 / 72
                for index, page in enumerate(document):
                    pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
                    filename = f"page-{index + 1:03d}.png"
                    pixmap.save(pages_dir / filename)
                    pages.append({"id": f"page-{index + 1:03d}", "image": f"/media/{project_id}/pages/{filename}", "width": pixmap.width, "height": pixmap.height, "pdfWidth": round(page.rect.width, 2), "pdfHeight": round(page.rect.height, 2)})
        else:
            for index, (file, suffix) in enumerate(zip(files, suffixes)):
                raw = await file.read()
                if not raw:
                    raise HTTPException(status_code=400, detail=f"第 {index + 1} 张图片是空文件")
                with Image.open(io.BytesIO(raw)) as image:
                    if image.format not in {"JPEG", "PNG", "WEBP"}:
                        raise HTTPException(status_code=400, detail=f"第 {index + 1} 张图片内容不是 JPG、PNG 或 WebP")
                    image.load()
                    oriented = ImageOps.exif_transpose(image)
                    if "A" in oriented.getbands() or "transparency" in oriented.info:
                        rgba = oriented.convert("RGBA")
                        rendered = Image.alpha_composite(Image.new("RGBA", rgba.size, "white"), rgba).convert("RGB")
                    else:
                        rendered = oriented.convert("RGB")
                filename = f"page-{index + 1:03d}.png"
                rendered.save(pages_dir / filename)
                (project_dir / f"source-{index + 1:03d}{suffix}").write_bytes(raw)
                pages.append({"id": f"page-{index + 1:03d}", "image": f"/media/{project_id}/pages/{filename}", "width": rendered.width, "height": rendered.height})
    except HTTPException:
        shutil.rmtree(project_dir, ignore_errors=True)
        shutil.rmtree(MEDIA / project_id, ignore_errors=True)
        raise
    except Exception as error:
        shutil.rmtree(project_dir, ignore_errors=True)
        shutil.rmtree(MEDIA / project_id, ignore_errors=True)
        raise HTTPException(status_code=400, detail=f"无法解析乐谱：{error}") from error
    return {"projectId": project_id, "filename": safe_filename(files[0].filename), "pages": pages, "renderDpi": 240 if is_pdf else None}


@app.post("/api/import/pdf")
async def import_pdf(file: UploadFile = File(...)):
    if Path(file.filename or "").suffix.lower() != ".pdf":
        raise HTTPException(status_code=400, detail="请选择 PDF 乐谱文件")
    return await import_score([file])


@app.post("/api/import/audio")
async def import_audio(file: UploadFile = File(...)):
    if not file.filename or Path(file.filename).suffix.lower() not in {".mp3", ".wav", ".m4a", ".ogg"}:
        raise HTTPException(status_code=400, detail="请选择 MP3 音频文件")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="音频文件为空")
    name = f"{uuid.uuid4().hex}-{safe_filename(file.filename)}"
    path = MEDIA / name
    path.write_bytes(data)
    try:
        duration = read_audio_duration(path)
    except Exception:
        duration = None
    return {"filename": safe_filename(file.filename), "url": f"/media/{name}", "bytes": len(data), "duration": duration}
