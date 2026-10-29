import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import imageio_ffmpeg
from PIL import Image, ImageDraw

from backend.rendering.frame_renderer import render_frame
from backend.rendering.video_renderer import encode_video


class DesktopExportTests(unittest.TestCase):
    def test_inverted_black_score_tints_letters_and_preserves_paper_in_both_modes(self):
        with tempfile.TemporaryDirectory() as folder:
            data = Path(folder)
            project = self.fixture(data)
            path = data / 'media/test-project/pages/page-001.png'
            original = Image.new('RGB', (320, 440), 'black')
            ImageDraw.Draw(original).rectangle((64, 48, 255, 79), fill='white')
            original.save(path)
            project['pages'][0]['inverted'] = True
            project['segments'][0].update(startTime=1, endTime=3)
            def frame(at):
                return render_frame(project, at, 320, 440, media_dir=data / 'media')
            before = frame(0)
            self.assertEqual(before.getpixel((100, 60)), (0, 0, 0))
            self.assertEqual(before.getpixel((40, 60)), (255, 255, 255))
            full = frame(2)
            self.assertEqual(full.getpixel((100, 60)), (222, 75, 45))
            self.assertEqual(full.getpixel((200, 60)), (222, 75, 45))
            self.assertEqual(full.getpixel((40, 60)), (255, 255, 255))
            project['highlight']['mode'] = 'wipe'
            wipe = frame(2)
            self.assertEqual(wipe.getpixel((100, 60)), (222, 75, 45))
            self.assertEqual(wipe.getpixel((200, 60)), (0, 0, 0))
            project['highlight']['color'] = '#1967d2'
            self.assertEqual(frame(2).getpixel((100, 60)), (25, 103, 210))
            project['highlight']['color'] = 'invalid'
            self.assertEqual(frame(2).getpixel((100, 60)), (222, 75, 45))
            project['pages'][0]['inverted'] = False
            restored = frame(0)
            self.assertEqual(restored.getpixel((100, 60)), (255, 255, 255))
            self.assertEqual(restored.getpixel((40, 60)), (0, 0, 0))
            with Image.open(path) as source:
                self.assertEqual(source.tobytes(), original.tobytes())

    def fixture(self, data):
        image = data / 'media' / 'test-project' / 'pages' / 'page-001.png'
        image.parent.mkdir(parents=True)
        Image.new('RGB', (320, 440), (32, 96, 160)).save(image)
        return {'pages': [{'id': 'p1', 'image': '/media/test-project/pages/page-001.png'}],
                'segments': [{'id': 's1', 'pageId': 'p1', 'startTime': 0, 'endTime': .2, 'timingSet': True,
                              'region': {'x': .1, 'y': .1, 'width': .8, 'height': .1}}],
                'flags': [], 'highlight': {'mode': 'full'}}

    def test_full_highlighting_selects_the_phrase_before_during_and_after_transitions(self):
        with tempfile.TemporaryDirectory() as folder:
            data = Path(folder)
            project = self.fixture(data)
            project['segments'][0].update(startTime=.1, endTime=.4)
            project['segments'].append({'id': 's2', 'pageId': 'p1', 'startTime': .4, 'endTime': .6,
                                        'timingSet': True, 'region': {'x': .1, 'y': .3, 'width': .8, 'height': .1}})
            with patch.dict(os.environ, {'PUJIAN_DATA_DIR': str(data)}):
                before = render_frame(project, 0, 320, 320)
                first = render_frame(project, .3, 320, 320)
                second = render_frame(project, .4, 320, 320)
                after = render_frame(project, .7, 320, 320)
            blue, red = (32, 96, 160), (222, 75, 45)
            self.assertEqual(before.getpixel((160, 60)), blue)
            self.assertEqual(first.getpixel((160, 60)), red)
            self.assertEqual(first.getpixel((160, 150)), blue)
            self.assertEqual(second.getpixel((160, 60)), blue)
            self.assertEqual(second.getpixel((160, 150)), red)
            self.assertEqual(after.getpixel((160, 150)), blue)

    def test_preview_uses_desktop_data_directory_outside_program(self):
        with tempfile.TemporaryDirectory() as folder:
            data = Path(folder) / 'user-data'
            project = self.fixture(data)
            with patch.dict(os.environ, {'PUJIAN_DATA_DIR': str(data)}):
                frame = render_frame(project, 0, 320, 320)
            self.assertEqual(frame.getpixel((160, 160)), (32, 96, 160))

    def test_explicit_media_directory_still_takes_precedence(self):
        with tempfile.TemporaryDirectory() as folder:
            data = Path(folder)
            project = self.fixture(data)
            with patch.dict(os.environ, {'PUJIAN_DATA_DIR': str(data / 'unused-root')}):
                frame = render_frame(project, 0, 320, 320, media_dir=data / 'media')
            self.assertEqual(frame.getpixel((160, 160)), (32, 96, 160))

    def test_real_video_export_reads_desktop_image_and_keeps_audio_packets(self):
        with tempfile.TemporaryDirectory() as folder:
            data = Path(folder) / 'user-data'
            project = self.fixture(data)
            audio = data / 'media' / 'original.mp3'
            output = data / 'export.mp4'
            ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
            subprocess.run([ffmpeg, '-y', '-v', 'error', '-f', 'lavfi', '-i',
                            'sine=frequency=997:duration=0.3', '-c:a', 'libmp3lame', str(audio)],
                           check=True, capture_output=True)
            with patch.dict(os.environ, {'PUJIAN_DATA_DIR': str(data)}):
                duration = encode_video(project, audio, output, 320, 320)
            self.assertGreater(duration, 0)
            self.assertGreater(output.stat().st_size, 0)
            def packet_hash(path):
                return subprocess.run([ffmpeg, '-v', 'error', '-i', str(path), '-map', '0:a:0',
                                       '-c:a', 'copy', '-f', 'hash', '-hash', 'sha256', '-'],
                                      check=True, capture_output=True).stdout
            self.assertEqual(packet_hash(audio), packet_hash(output))


if __name__ == '__main__':
    unittest.main()
