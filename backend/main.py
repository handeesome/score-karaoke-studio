from __future__ import annotations

import re
import shutil
import uuid
import json
import io
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Lock
from typing import Literal

import fitz
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
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
from backend.rendering.frame_renderer import render_frame
from backend.rendering.video_renderer import encode_video

ROOT = Path(__file__).resolve().parent
PROJECTS = ROOT / "projects"
MEDIA = ROOT / "media"
EXPORTS = ROOT / "exports"
PROJECTS.mkdir(exist_ok=True)
MEDIA.mkdir(exist_ok=True)
EXPORTS.mkdir(exist_ok=True)
executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="score-export")
alignment_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="score-alignment")
jobs: dict[str, dict] = {}
jobs_lock = Lock()
alignment_jobs: dict[str, dict] = {}
alignment_lock = Lock()

app = FastAPI(title="谱间本地项目服务", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"], allow_methods=["*"], allow_headers=["*"])
app.mount("/media", StaticFiles(directory=MEDIA), name="media")


def safe_filename(name: str) -> str:
    return re.sub(r"[^\w.\-\u4e00-\u9fff ]", "_", Path(name).name)[:120] or "upload"


class ExportOptions(BaseModel):
    preset: Literal["landscape", "portrait", "social", "square", "custom"] = "landscape"
    width: int = Field(ge=320, le=3840)
    height: int = Field(ge=320, le=3840)
    fps: Literal[30] = 30
    scoreZoom: float = Field(ge=0.5, le=1.5)

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
    if not project.get("pages"):
        errors.append("尚未导入乐谱 PDF")
    if not segments:
        errors.append("请至少添加一条乐句标注")
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
        region = segment.get("region", {})
        if segment.get("pageId") not in page_ids:
            errors.append(f"{label}引用了不存在的乐谱页")
        if start < 0 or end <= start:
            errors.append(f"{label}的结束时间必须晚于开始时间")
        if duration and end > duration + 0.05:
            errors.append(f"{label}超出音频时长")
        try:
            x, y, w, h = (float(region[key]) for key in ("x", "y", "width", "height"))
            if min(x, y, w, h) < 0 or w <= 0 or h <= 0 or x + w > 1.000001 or y + h > 1.000001:
                errors.append(f"{label}的标注区域超出页面范围")
        except (KeyError, TypeError, ValueError):
            errors.append(f"{label}缺少有效的标注区域")
        anchors = segment.get("anchors", [])
        if anchors:
            if anchors != sorted(anchors, key=lambda anchor: float(anchor.get("time", 0))):
                errors.append(f"{label}的同步锚点没有按时间排序")
            if anchors != sorted(anchors, key=lambda anchor: float(anchor.get("progress", 0))):
                errors.append(f"{label}的同步锚点进度没有从左到右排列")
        cuts = segment.get("cuts") or []
        if any(not 0 < float(cut) < 1 for cut in cuts) or cuts != sorted(set(cuts)):
            errors.append(f"{label}的竖切线需位于行内且从左到右排列")
    for previous, current in zip(segments, segments[1:]):
        gap = float(current["startTime"]) - float(previous["endTime"])
        if gap < -0.05:
            warnings.append(f"第 {segments.index(current) + 1} 句与前一句有 {abs(gap):.2f} 秒重叠")
        elif gap > 2.0:
            warnings.append(f"第 {segments.index(current) + 1} 句前有 {gap:.2f} 秒空档")
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
            jobs[job_id].update(status="completed", progress=1.0, duration=duration, file=output_path.name)
    except Exception as error:
        with jobs_lock:
            jobs[job_id].update(status="failed", error=str(error))


def _run_alignment(job_id: str, project: dict, audio_path: Path, duration: float):
    def update(stage: str):
        with alignment_lock:
            alignment_jobs[job_id].update(status="running", stage=stage)
    try:
        candidates = suggest_alignment(project, MEDIA, ROOT.parent / "reference" / "models", audio_path, duration, update)
        with alignment_lock:
            alignment_jobs[job_id].update(status="completed", stage="候选标注已生成", candidates=candidates)
    except Exception as error:
        with alignment_lock:
            alignment_jobs[job_id].update(status="failed", error=str(error))


@app.get("/api/projects/recent")
def load_recent_project():
    candidates = list(PROJECTS.glob("*/project.json"))
    if not candidates:
        raise HTTPException(status_code=404, detail="尚无已保存项目")
    newest = max(candidates, key=lambda item: item.stat().st_mtime)
    return json.loads(newest.read_text(encoding="utf-8"))


@app.get("/api/projects")
def list_projects():
    items = []
    for path in PROJECTS.glob("*/project.json"):
        try:
            project = json.loads(path.read_text(encoding="utf-8"))
            items.append({
                "projectId": project.get("projectId", path.parent.name),
                "projectName": project.get("projectName", "未命名歌曲"),
                "updatedAt": path.stat().st_mtime,
                "pdf": project.get("source", {}).get("pdf"),
                "audio": project.get("source", {}).get("audio"),
            })
        except (OSError, ValueError):
            continue
    return sorted(items, key=lambda item: item["updatedAt"], reverse=True)


@app.post("/api/projects")
def create_project(payload: dict | None = None):
    project_id = uuid.uuid4().hex
    project_name = str((payload or {}).get("projectName") or "未命名歌曲")[:120]
    project = {
        "version": 1,
        "projectName": project_name,
        "projectId": project_id,
        "source": {"pdf": None, "audio": None, "audioUrl": None},
        "pages": [],
        "segments": [],
        "flags": [],
        "audioDuration": None,
        "export": {"preset": "landscape", "width": 1920, "height": 1080, "fps": 30, "scoreZoom": 1.0},
        "highlight": {"opacity": 0.32},
    }
    target = PROJECTS / project_id
    target.mkdir(parents=True)
    (target / "project.json").write_text(json.dumps(project, ensure_ascii=False, indent=2), encoding="utf-8")
    return project


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


@app.get("/api/projects/{project_id}")
def load_project(project_id: str):
    if not re.fullmatch(r"[a-f0-9]{32}", project_id):
        raise HTTPException(status_code=400, detail="无效的项目编号")
    path = PROJECTS / project_id / "project.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="找不到该项目")
    return json.loads(path.read_text(encoding="utf-8"))


@app.post("/api/projects/{project_id}/validate")
def validate_saved_project(project_id: str):
    report = validate_project(read_project(project_id))
    return {key: value for key, value in report.items() if key != "audioPath"}


@app.post("/api/projects/{project_id}/auto-align")
def start_auto_alignment(project_id: str):
    project = read_project(project_id)
    if not project.get("pages"):
        raise HTTPException(status_code=422, detail="请先导入乐谱 PDF")
    try:
        audio_path = resolve_audio(project)
        duration = read_audio_duration(audio_path)
    except Exception as error:
        raise HTTPException(status_code=422, detail="请先导入可读取的 MP3 音频") from error
    if not duration or duration <= 0:
        raise HTTPException(status_code=422, detail="无法读取音频时长")
    job_id = uuid.uuid4().hex
    with alignment_lock:
        alignment_jobs[job_id] = {"status": "queued", "stage": "等待本地识别", "candidates": []}
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
    output_path = EXPORTS / f"{project_name}-{options.preset}-{job_id[:8]}.mp4"
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
        path = EXPORTS / job["file"]
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


@app.post("/api/auto-boxes")
def auto_boxes(request: AutoBoxesRequest):
    try:
        return {"candidates": suggest_boxes(request.pages, MEDIA)}
    except (RuntimeError, ValueError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/api/import/pdf")
async def import_pdf(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="请选择 PDF 乐谱文件")
    raw = await file.read()
    if not raw.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="文件内容不是有效的 PDF")
    project_id = uuid.uuid4().hex
    project_dir = PROJECTS / project_id
    pages_dir = MEDIA / project_id / "pages"
    project_dir.mkdir(parents=True)
    pages_dir.mkdir(parents=True)
    source_path = project_dir / "source.pdf"
    source_path.write_bytes(raw)
    pages = []
    try:
        with fitz.open(stream=raw, filetype="pdf") as document:
            if document.page_count > 100:
                raise HTTPException(status_code=400, detail="PDF 页数过多，请使用不超过 100 页的文件")
            scale = 240 / 72
            for index, page in enumerate(document):
                pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
                filename = f"page-{index + 1:03d}.png"
                pixmap.save(pages_dir / filename)
                pages.append({"id": f"page-{index + 1:03d}", "image": f"/media/{project_id}/pages/{filename}", "width": pixmap.width, "height": pixmap.height, "pdfWidth": round(page.rect.width, 2), "pdfHeight": round(page.rect.height, 2)})
    except HTTPException:
        shutil.rmtree(project_dir, ignore_errors=True)
        shutil.rmtree(MEDIA / project_id, ignore_errors=True)
        raise
    except Exception as error:
        shutil.rmtree(project_dir, ignore_errors=True)
        shutil.rmtree(MEDIA / project_id, ignore_errors=True)
        raise HTTPException(status_code=400, detail=f"无法解析 PDF：{error}") from error
    return {"projectId": project_id, "filename": safe_filename(file.filename), "pages": pages, "renderDpi": 240}


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
