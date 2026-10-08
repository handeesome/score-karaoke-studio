import unittest

from backend.rendering.scrolling import calculate_camera_target, calculate_progress, ease_in_out


class KaraokeProgressTests(unittest.TestCase):
    def test_linear_progress_without_anchors(self):
        self.assertEqual(calculate_progress(2.0, 6.0, [], 0.0), 0.0)
        self.assertAlmostEqual(calculate_progress(2.0, 6.0, [], 4.0), 0.5)
        self.assertEqual(calculate_progress(2.0, 6.0, [], 7.0), 1.0)

    def test_progress_interpolates_between_anchors(self):
        anchors = [{"time": 2.0, "progress": 0.0}, {"time": 4.0, "progress": 0.2}, {"time": 8.0, "progress": 1.0}]
        self.assertAlmostEqual(calculate_progress(2.0, 8.0, anchors, 3.0), 0.1)
        self.assertAlmostEqual(calculate_progress(2.0, 8.0, anchors, 6.0), 0.6)

    def test_camera_holds_in_safe_zone_and_moves_outside_it(self):
        self.assertEqual(calculate_camera_target(580, 1400, 1000, 0), 0)
        self.assertAlmostEqual(calculate_camera_target(900, 1400, 1000, 0), 320)

    def test_camera_stays_inside_page_and_easing_is_clamped(self):
        self.assertEqual(calculate_camera_target(2000, 1800, 1000, 0), 800)
        self.assertEqual(ease_in_out(-1), 0)
        self.assertEqual(ease_in_out(2), 1)


if __name__ == "__main__":
    unittest.main()
