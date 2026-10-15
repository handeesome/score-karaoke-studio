from pathlib import Path
import unittest
from unittest.mock import patch

from backend.main import validate_project


class TimelineValidationTests(unittest.TestCase):
    def check(self, segments, flags):
        with patch('backend.main.resolve_audio', return_value=Path('test.mp3')), patch('backend.main.read_audio_duration', return_value=120):
            return validate_project({'source': {}, 'pages': [{'id': 'p1'}], 'segments': segments, 'flags': flags})

    def segment(self, id, start, end, timed):
        return {'id': id, 'pageId': 'p1', 'region': {'x': .1, 'y': .1, 'width': .8, 'height': .1},
                'startTime': start, 'endTime': end, 'timingSet': timed}

    def test_unassigned_score_boxes_are_not_validated_as_active_timeline_items(self):
        report = self.check([self.segment('s1', 0, 4, True), self.segment('s2', 4, 1000, False)], [])
        self.assertTrue(report['valid'], report)
        self.assertEqual(len(report['warnings']), 1)
        self.assertIn('1 条乐句未放入时间轴', report['warnings'][0])

    def test_assigned_out_of_range_time_still_blocks_export(self):
        report = self.check([self.segment('s1', 0, 1000, True)], [])
        self.assertFalse(report['valid'])
        self.assertTrue(any('超出音频时长' in error for error in report['errors']))

    def test_empty_timeline_reports_actionable_timing_error(self):
        report = self.check([self.segment('s1', 0, 4, False)], [])
        self.assertFalse(report['valid'])
        self.assertIn('第 1 句尚未设置时间，请先打点', report['errors'])
