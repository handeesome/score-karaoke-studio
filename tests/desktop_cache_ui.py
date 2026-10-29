"""Reproduce an update across native WebView2 restarts with one isolated profile."""
import argparse
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def view(url, profile, output):
    import webview
    window = webview.create_window('Update cache regression', url, hidden=True)
    result = {}

    def loaded():
        try:
            result.update(window.evaluate_js('''(() => {
                const previous = localStorage.getItem('cache-test-project');
                localStorage.setItem('cache-test-project', 'preserved');
                return {heading: document.querySelector('h1').textContent, previous};
            })()'''))
        finally:
            window.destroy()

    window.events.loaded += loaded
    timer = threading.Timer(30, window.destroy)
    timer.start()
    try:
        webview.start(gui='edgechromium', private_mode=False, storage_path=profile)
    finally:
        timer.cancel()
    Path(output).write_text(json.dumps(result), encoding='utf-8')
    assert result, 'WebView did not load'


def main():
    from fastapi import FastAPI
    from fastapi.staticfiles import StaticFiles
    import uvicorn
    from desktop import app as desktop_app

    with tempfile.TemporaryDirectory(prefix='desktop-cache-', dir=ROOT / 'build') as folder:
        data = Path(folder)
        frontend = data / 'dist'
        frontend.mkdir()
        index = frontend / 'index.html'
        index.write_text('<html><body><h1>old</h1></body></html>', encoding='utf-8')
        os.utime(index, (time.time() - 86400, time.time() - 86400))
        app = FastAPI()
        app.mount('/', StaticFiles(directory=frontend, html=True))
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            port = probe.getsockname()[1]
        desktop_app.PORT = port
        updated_url = desktop_app.frontend_url()
        server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=port, log_level='error'))
        threading.Thread(target=server.run, daemon=True).start()
        deadline = time.monotonic() + 10
        while not server.started:
            assert time.monotonic() < deadline
            time.sleep(.05)
        results = []
        try:
            for phase, url in enumerate((f'http://127.0.0.1:{port}/', f'http://127.0.0.1:{port}/', updated_url, updated_url)):
                output = data / f'{phase}.json'
                subprocess.run([sys.executable, __file__, '--view', url,
                                '--profile', str(data / 'profile'), '--output', str(output)],
                               check=True, timeout=45, creationflags=subprocess.CREATE_NO_WINDOW)
                results.append(json.loads(output.read_text(encoding='utf-8')))
                if phase == 0:
                    index.write_text('<html><body><h1>new</h1></body></html>', encoding='utf-8')
                if phase == 1:
                    app.routes[-1].app = desktop_app.DesktopStaticFiles(directory=frontend, html=True)
                if phase == 2:
                    index.write_text('<html><body><h1>newer</h1></body></html>', encoding='utf-8')
            assert results[0]['heading'] == 'old'
            assert results[2]['heading'] == 'new'
            assert results[3]['heading'] == 'newer'
            assert all(item['previous'] == 'preserved' for item in results[1:])
            print(json.dumps({'firstLaunch': results[0], 'restartSameURL': results[1],
                              'restartVersionedURL': results[2], 'restartRevalidates': results[3]}, ensure_ascii=True), flush=True)
        finally:
            server.should_exit = True


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--view')
    parser.add_argument('--profile')
    parser.add_argument('--output')
    args = parser.parse_args()
    if args.view:
        view(args.view, args.profile, args.output)
    else:
        main()
