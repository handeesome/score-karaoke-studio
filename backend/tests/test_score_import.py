import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import fitz
from PIL import Image
from fastapi import HTTPException, UploadFile
from backend import main


class ScoreImportTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        self.projects = self.root / 'projects'
        self.media = self.root / 'media'
        self.projects.mkdir()
        self.media.mkdir()
        for name, value in [('PROJECTS', self.projects), ('MEDIA', self.media)]:
            patched = patch.object(main, name, value)
            patched.start()
            self.addCleanup(patched.stop)

    def image(self, name, width=20):
        data = io.BytesIO()
        Image.new('RGB', (width, 30), 'white').save(data, format='PNG')
        return UploadFile(filename=name, file=io.BytesIO(data.getvalue()))

    def pdf(self, name, count=1):
        with fitz.open() as document:
            for _ in range(count):
                document.new_page(width=30, height=40)
            return UploadFile(filename=name, file=io.BytesIO(document.tobytes()))

    async def test_multiple_images_follow_numeric_filename_order(self):
        result = await main.import_score([self.image('page10.png', 10), self.image('page2.png', 2), self.image('page1.png', 1)])
        self.assertEqual([p['width'] for p in result['pages']], [1, 2, 10])
        self.assertEqual([p['id'] for p in result['pages']], ['page-001', 'page-002', 'page-003'])
        self.assertTrue(all((self.media / result['projectId'] / 'pages' / Path(p['image']).name).is_file() for p in result['pages']))

    async def test_pdf_and_images_can_be_imported_together(self):
        result = await main.import_score([self.image('02.png'), self.pdf('01.pdf', 2), self.pdf('03.pdf')])
        self.assertEqual(len(result['pages']), 4)
        self.assertEqual([p.get('pdfWidth') for p in result['pages']], [30, 30, None, 30])
        self.assertEqual(len({p['image'] for p in result['pages']}), 4)

    async def test_total_page_limit_counts_every_pdf_and_cleans_failed_import(self):
        with self.assertRaises(HTTPException) as raised:
            await main.import_score([self.pdf('01.pdf', 100), self.image('02.png')])
        self.assertIn('100', raised.exception.detail)
        self.assertFalse(list(self.projects.iterdir()))
        self.assertFalse(list(self.media.iterdir()))

    async def test_corrupt_later_file_never_returns_a_partial_import(self):
        corrupt = UploadFile(filename='02.pdf', file=io.BytesIO(b'broken'))
        with self.assertRaises(HTTPException):
            await main.import_score([self.image('01.png'), corrupt])
        self.assertFalse(list(self.projects.iterdir()))
        self.assertFalse(list(self.media.iterdir()))

    async def test_single_pdf_keeps_legacy_source_and_resolution(self):
        result = await main.import_score([self.pdf('score.pdf')])
        self.assertTrue((self.projects / result['projectId'] / 'source.pdf').is_file())
        self.assertEqual(result['renderDpi'], 240)


if __name__ == '__main__':
    unittest.main()
