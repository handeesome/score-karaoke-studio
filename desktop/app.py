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

from fastapi.staticfiles import StaticFiles

SOURCE_ROOT = Path(__file__).resolve().parent.parent
# PyInstaller embeds resources under _internal; user-supplied models live beside the exe.
ASSETS = Path(getattr(sys, "_MEIPASS", SOURCE_ROOT))
BUNDLE = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else SOURCE_ROOT
PORT = int(os.environ.get('PUJIAN_TEST_PORT', '18765'))  # Tests use an isolated port; normal origin stays stable.


class DesktopStaticFiles(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        # A persistent WebView can otherwise reuse yesterday's index after an update.
        response.headers['Cache-Control'] = 'no-cache'
        return response


def frontend_url():
    from desktop.version import VERSION
    # The query bypasses an old index cached before revalidation headers existed.
    # Keep the origin stable so saved projects and display preferences survive.
    return f'http://127.0.0.1:{PORT}/?v={VERSION}'


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
    from backend.main import app
    frontend = ASSETS / "dist"
    if not (frontend / "index.html").is_file():
        raise RuntimeError("缺少网页构建文件，请先执行 npm run build")

    @app.get("/api/desktop/health")
    def health():
        from desktop.version import VERSION
        return {"token": os.environ.get("PUJIAN_START_TOKEN"), "desktop": True, "version": VERSION}

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

    app.mount("/", DesktopStaticFiles(directory=frontend, html=True), name="desktop-ui")
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
        from backend.runtime import local_fast_vocals
        fast_models = local_fast_vocals()
        if fast_models:
            import numpy as np
            from backend.fast_vocals import load_sessions, separate_audio, validate_models
            validate_models(fast_models)
            sample = separate_audio(np.zeros((2, 4410), dtype=np.float32), load_sessions(fast_models))
            assert sample.shape == (2, 4410) and np.isfinite(sample).all()
        # Use the actual JS API and a real native window. Importing Python.NET alone
        # does not exercise recursive API exposure or catch initialization deadlocks.
        from desktop.updater import DesktopUpdater
        updater = DesktopUpdater(BUNDLE, ASSETS, data)
        updater._window = webview.create_window('Pujian bridge self-test', html='<html><body>Bridge self-test</body></html>',
                                                 hidden=True, js_api=updater)
        bridge = {}
        def loaded():
            try:
                methods = updater._window.evaluate_js('Object.keys(window.pywebview.api).sort()')
                bridge['ok'] = methods == ['check_update', 'choose_export_directory', 'choose_export_file', 'install_update', 'open_export', 'update_status']
            finally:
                updater._window.destroy()
        updater._window.events.loaded += loaded
        fixed_runtime = BUNDLE / 'tools/webview2'
        if fixed_runtime.is_dir():
            webview.settings['WEBVIEW2_RUNTIME_PATH'] = str(fixed_runtime)
        webview.start(gui='edgechromium', private_mode=True)
        if not bridge.get('ok'):
            raise RuntimeError('桌面更新接口自检失败')
        (data / "smoke-test.json").write_text(json.dumps({"ok": True, "offline": offline(), 'desktopBridge': True}), encoding="utf-8")
    finally:
        stop_backend(process, job, log)


def fit_window_to_work_area(window):
    """Fit the outer window to its monitor after WinForms has applied DPI scaling."""
    from System.Drawing import Rectangle, Size
    from System.Windows.Forms import FormStartPosition, Screen

    native = window.native
    area = Screen.FromControl(native).WorkingArea
    margin = min(round(12 * native.DeviceDpi / 96), area.Width // 4, area.Height // 4)
    width = min(native.Width, area.Width - 2 * margin)
    height = min(native.Height, area.Height - 2 * margin)
    # A fixed minimum must not force the window beyond a smaller work area.
    native.MinimumSize = Size(min(native.MinimumSize.Width, width), min(native.MinimumSize.Height, height))
    native.StartPosition = FormStartPosition.Manual
    native.Bounds = Rectangle(area.X + (area.Width - width) // 2,
                              area.Y + (area.Height - height) // 2, width, height)
    logging.info("Window fitted to work area: bounds=%s; work_area=%s; dpi=%s",
                 native.Bounds, area, native.DeviceDpi)


def reveal_desktop_window(window):
    """Old updaters use STARTUPINFO(SW_HIDE); explicitly show after the first ShowWindow."""
    from ctypes import wintypes
    from System import Action
    from System.Windows.Forms import Screen

    def show():
        native = window.native
        handle = native.Handle.ToInt64()
        user32 = ctypes.windll.user32
        user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
        user32.IsWindowVisible.argtypes = [wintypes.HWND]
        user32.ShowWindow(handle, 5)  # SW_SHOW preserves the size chosen for the work area.
        native.Activate()
        logging.info('Desktop window shown: visible=%s; within_work_area=%s',
                     bool(user32.IsWindowVisible(handle)), bool(Screen.FromControl(native).WorkingArea.Contains(native.Bounds)))
    window.native.Invoke(Action(show))


def main():
    data = configure()
    logging.basicConfig(filename=str(data / "desktop.log"), level=logging.INFO, encoding="utf-8")
    from desktop.version import VERSION
    logging.info("Pujian %s starting; data=%s; vocal_cache=%s", VERSION, data, os.environ.get('PUJIAN_VOCAL_CACHE'))
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
        updater._window = webview.create_window("谱间 · 歌谱同步工作台", frontend_url(),
                              width=1440, height=960, min_size=(1024, 700), js_api=updater)
        updater._window.events.before_show += lambda: fit_window_to_work_area(updater._window)
        updater._window.events.shown += lambda: reveal_desktop_window(updater._window)
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
