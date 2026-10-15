import hashlib
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import imageio_ffmpeg
from PIL import Image

from backend.rendering.video_renderer import encode_video


class AudioPassthroughTests(unittest.TestCase):
    def test_export_preserves_every_original_encoded_audio_packet(self):
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        fixtures = [('.mp3', ['-c:a', 'libmp3lame', '-b:a', '320k']),
                    ('.mp3', ['-c:a', 'libmp3lame', '-q:a', '2']),
                    ('.m4a', ['-c:a', 'aac', '-b:a', '256k']),
                    ('.wav', ['-c:a', 'pcm_s16le']),
                    ('.ogg', ['-c:a', 'libvorbis', '-q:a', '4'])]
        for suffix, options in fixtures:
            with self.subTest(options=options), tempfile.TemporaryDirectory() as directory:
                source = Path(directory) / ('original' + suffix)
                result = Path(directory) / 'video.mp4'
                subprocess.run([ffmpeg, '-y', '-v', 'error', '-f', 'lavfi', '-i',
                                'sine=frequency=997:duration=1.013', '-ar', '44100', '-ac', '2',
                                *options, str(source)], check=True, capture_output=True)
                original_file_hash = hashlib.sha256(source.read_bytes()).digest()
                with patch('backend.rendering.video_renderer.render_frame', return_value=Image.new('RGB', (64, 64), 'white')):
                    encode_video({}, source, result, 64, 64, fps=7)
                def packet_hash(path):
                    # Hash audio packet payloads, not the container or decoded samples.
                    return subprocess.run([ffmpeg, '-v', 'error', '-i', str(path), '-map', '0:a:0',
                                           '-c:a', 'copy', '-f', 'hash', '-hash', 'sha256', '-'],
                                          check=True, capture_output=True).stdout.strip()
                self.assertEqual(packet_hash(source), packet_hash(result))
                self.assertEqual(hashlib.sha256(source.read_bytes()).digest(), original_file_hash)


if __name__ == '__main__':
    unittest.main()
