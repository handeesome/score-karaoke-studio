"""Windows desktop shell. The existing React UI is served unchanged."""
from __future__ import annotations

import ctypes
import json
import logging
import multiprocessing
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import time
import urllib.request
import uuid

SOURCE_ROOT = Path(__file__).resolve().parent.parent
# PyInstaller embeds resources under _internal; user-supplied models live beside the exe.
ASSETS = Path(getattr(sys, "_MEIPASS", SOURCE_ROOT))
BUNDLE = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else SOURCE_ROOT
PORT = 18765  # A stable origin keeps localStorage available across restarts.


def configure():
    default = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "Pujian"
    data = Path(os.environ.setdefault("PUJIAN_DATA_DIR", str(default))).resolve()
    data.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("PUJIAN_MODEL_CACHE", str(data / "models"))
    os.environ.setdefault("PUJIAN_VOCAL_CACHE", str(data / "vocals"))
    os.environ.setdefault("PUJIAN_BUNDLE_DIR", str(BUNDLE))
    if (BUNDLE / "offline.json").is_file():
        os.environ["PUJIAN_OFFLINE"] = "1"
        os.environ["HF_HUB_OFFLINE"] = "1"
    ocr = BUNDLE / "tools" / "tesseract"
    if (ocr / "tesseract.exe").is_file():
        os.environ.setdefault("PUJIAN_TESSERACT", str(ocr / "tesseract.exe"))
        os.environ["TESSDATA_PREFIX"] = str(ocr / "tessdata")
        os.environ["PATH"] = str(ocr) + os.pathsep + os.environ.get("PATH", "")
    return data


def command(*args):
    if getattr(sys, "frozen", False):
        return [sys.executable, *args]
    return [sys.executable, str(Path(__file__).resolve()), *args]


def serve():
    import uvicorn
    from fastapi.staticfiles import StaticFiles
    from backend.main import app
    frontend = ASSETS / "dist"
    if not (frontend / "index.html").is_file():
        raise RuntimeError("缺少网页构建文件，请先执行 npm run build")

    @app.get("/api/desktop/health")
    def health():
        return {"token": os.environ.get("PUJIAN_START_TOKEN"), "desktop": True}

    # Mount last, so /api and /media retain precedence over frontend files.
    @app.get("/api/desktop/update-ready")
    def update_ready():
        from backend import main as backend
        for collection, lock in ((backend.jobs, backend.jobs_lock), (backend.alignment_jobs, backend.alignment_lock),
                                 (backend.box_jobs, backend.box_lock), (backend.vocal_jobs, backend.vocal_lock)):
            with lock:
                if any(job['status'] in ('queued', 'running') for job in collection.values()):
                    return {"ready": False}
        return {"ready": True}

    app.mount("/", StaticFiles(directory=frontend, html=True), name="desktop-ui")
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_config=None, access_log=False)


def start_backend(data):
    from desktop.windows_job import WindowsJob
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", PORT))
    token = uuid.uuid4().hex
    environment = {**os.environ, "PUJIAN_START_TOKEN": token}
    log = (data / "backend.log").open("a", encoding="utf-8")
    job = WindowsJob()
    process = None
    try:
        process = subprocess.Popen(command("--serve"), env=environment, cwd=str(BUNDLE),
                                   stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
        job.add(process)
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError(f"后台启动失败，请查看 {data / 'backend.log'}")
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/desktop/health", timeout=1) as response:
                    if json.load(response).get("token") == token:
                        return process, job, log
            except (OSError, ValueError):
                pass
            time.sleep(.15)
        raise RuntimeError(f"后台启动超时，请查看 {data / 'backend.log'}")
    except BaseException:
        job.close()
        if process is not None:
            if process.poll() is None:
                process.kill()
            process.wait(timeout=10)
        log.close()
        raise


def stop_backend(process, job, log):
    job.close()  # Also terminates Demucs and FFmpeg descendants.
    process.wait(timeout=10)
    log.close()


def smoke_test(data):
    """Validate the actual bundle without opening a window."""
    import webview  # noqa: F401
    import clr  # noqa: F401  -- exercise the same Python.NET bridge as the desktop window
    from imageio_ffmpeg import get_ffmpeg_exe
    from backend.auto_alignment import _tesseract
    from backend.runtime import offline, local_demucs, whisper_source, whisper_cache
    from faster_whisper import WhisperModel
    process, job, log = start_backend(data)
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/", timeout=10) as response:
            html = response.read().decode("utf-8")
            assert '<div id="root">' in html
        for asset in re.findall(r'(?:src|href)="(/assets/[^\"]+)"', html):
            with urllib.request.urlopen(f"http://127.0.0.1:{PORT}{asset}", timeout=10) as response:
                assert response.read(), f"Empty frontend asset: {asset}"
        subprocess.run([get_ffmpeg_exe(), "-version"], check=True, capture_output=True,
                       creationflags=subprocess.CREATE_NO_WINDOW)
        worker = subprocess.run(command("--demucs", "--help"), capture_output=True, timeout=120,
                                creationflags=subprocess.CREATE_NO_WINDOW)
        if worker.returncode:
            raise RuntimeError(worker.stdout.decode(errors="replace") + worker.stderr.decode(errors="replace"))
        if offline():
            WhisperModel(whisper_source(whisper_cache()), device="cpu", compute_type="int8")
            from demucs.pretrained import get_model
            get_model("htdemucs", repo=local_demucs())
            languages = subprocess.run([_tesseract(), "--list-langs"], check=True, capture_output=True,
                                       creationflags=subprocess.CREATE_NO_WINDOW).stdout.decode(errors="replace")
            assert "chi_sim" in languages and "eng" in languages
        (data / "smoke-test.json").write_text(json.dumps({"ok": True, "offline": offline()}), encoding="utf-8")
    finally:
        stop_backend(process, job, log)


def main():
    data = configure()
    logging.basicConfig(filename=str(data / "desktop.log"), level=logging.INFO, encoding="utf-8")
    # windowed executables have no stdout/stderr; workers still need streams.
    for name in ("stdout", "stderr"):
        if getattr(sys, name) is None:
            setattr(sys, name, (data / "worker.log").open("a", encoding="utf-8"))
    if "--demucs" in sys.argv:
        from demucs.separate import main as separate
        separate(sys.argv[sys.argv.index("--demucs") + 1:])
        return
    if "--separate-vocals" in sys.argv:
        from backend.separation_worker import main as separate
        separate(sys.argv[sys.argv.index("--separate-vocals") + 1:])
        return
    if "--serve" in sys.argv:
        serve()
        return
    if "--smoke-test" in sys.argv:
        smoke_test(data)
        return
    import webview
    fixed_runtime = BUNDLE / "tools" / "webview2"
    if fixed_runtime.is_dir():
        webview.settings["WEBVIEW2_RUNTIME_PATH"] = str(fixed_runtime)
    webview.settings["ALLOW_DOWNLOADS"] = True
    process, job, log = start_backend(data)
    try:
        from desktop.updater import DesktopUpdater
        updater = DesktopUpdater(BUNDLE, ASSETS, data)
        updater.window = webview.create_window("谱间 · 歌谱同步工作台", f"http://127.0.0.1:{PORT}/",
                              width=1440, height=960, min_size=(1024, 700), js_api=updater)
        webview.start(gui="edgechromium", private_mode=False, storage_path=str(data / "webview"))
    finally:
        stop_backend(process, job, log)


if __name__ == "__main__":
    multiprocessing.freeze_support()
    if not getattr(sys, "frozen", False):
        sys.path.insert(0, str(SOURCE_ROOT))
    try:
        main()
    except Exception as error:
        logging.exception("Desktop startup failed")
        if not any(flag in sys.argv for flag in ("--serve", "--demucs", "--separate-vocals", "--smoke-test")):
            ctypes.windll.user32.MessageBoxW(None, f"{error}\n\n日志目录：{os.environ.get('PUJIAN_DATA_DIR', '')}",
                                            "谱间启动失败", 0x10)
        raise SystemExit(1)
