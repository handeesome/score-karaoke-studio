import unittest
from backend.models.project import ProjectDocument


class PartitionDocumentTests(unittest.TestCase):
    def test_saved_project_retains_guides_cuts_and_skipped_cells_for_reopening(self):
        document = ProjectDocument.model_validate({
            'source': {}, 'pages': [{'id': 'page1'}],
            'segments': [{'id': 's1', 'pageId': 'page1', 'region': {'x': .1, 'y': .2, 'width': .8, 'height': .1},
                          'startTime': 0, 'endTime': 4, 'partitionKey': 'page1:t:b:l:r'}],
            'partitions': [{'pageId': 'page1', 'horizontal': [{'id': 't', 'position': .2}, {'id': 'b', 'position': .3}],
                            'vertical': [{'id': 'l', 'position': .1}, {'id': 'r', 'position': .9}],
                            'cuts': [], 'excluded': ['skipped']}],
            'highlight': {'mode': 'full', 'opacity': .32},
        })
        restored = ProjectDocument.model_validate_json(document.model_dump_json())
        self.assertEqual(restored.segments[0].partitionKey, 'page1:t:b:l:r')
        self.assertEqual(restored.partitions, document.partitions)
        self.assertEqual(restored.highlight['mode'], 'full')

    def test_older_projects_do_not_require_guides(self):
        document = ProjectDocument.model_validate({'source': {}, 'pages': [], 'segments': []})
        self.assertEqual(document.partitions, [])

    def test_merge_spare_times_and_intentionally_removed_timing_survive_save(self):
        document = ProjectDocument.model_validate({
            'source': {}, 'pages': [{'id': 'p1'}],
            'segments': [{'id': 's7', 'pageId': 'p1', 'region': {'x': .1, 'y': .2, 'width': .8, 'height': .1},
                          'startTime': 24, 'endTime': 28, 'timingSet': False}],
            'flags': [], 'spareTimings': [{'startTime': 116, 'endTime': 120}],
        })
        restored = ProjectDocument.model_validate_json(document.model_dump_json())
        self.assertFalse(restored.segments[0].timingSet)
        self.assertEqual(restored.segments[0].startTime, 24)
        self.assertEqual(restored.spareTimings[0].startTime, 116)
        self.assertEqual(restored.spareTimings[0].endTime, 120)
