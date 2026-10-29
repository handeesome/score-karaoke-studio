from pathlib import Path
import tempfile
import unittest
from urllib.parse import parse_qs, urlsplit

from fastapi import FastAPI
from fastapi.testclient import TestClient

from desktop.app import DesktopStaticFiles, PORT, frontend_url
from desktop.version import VERSION


class DesktopFrontendTests(unittest.TestCase):
    def test_start_url_bypasses_old_cache_without_changing_storage_origin(self):
        url = urlsplit(frontend_url())
        self.assertEqual((url.scheme, url.hostname, url.port, url.path), ('http', '127.0.0.1', PORT, '/'))
        self.assertEqual(parse_qs(url.query), {'v': [VERSION]})

    def test_index_and_assets_revalidate_including_conditional_responses(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'index.html').write_text('<h1>new</h1>', encoding='utf-8')
            (root / 'app.js').write_text('window.version = "new"', encoding='utf-8')
            app = FastAPI()
            app.mount('/', DesktopStaticFiles(directory=root, html=True))
            with TestClient(app) as client:
                for path in ('/', '/index.html', '/?v=' + VERSION, '/app.js'):
                    with self.subTest(path=path):
                        response = client.get(path)
                        self.assertEqual(response.status_code, 200)
                        self.assertEqual(response.headers['cache-control'], 'no-cache')
                        cached = client.get(path, headers={'If-None-Match': response.headers['etag']})
                        self.assertEqual(cached.status_code, 304)
                        self.assertEqual(cached.headers['cache-control'], 'no-cache')


if __name__ == '__main__':
    unittest.main()
