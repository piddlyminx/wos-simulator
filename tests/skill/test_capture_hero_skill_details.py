from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np


SCRIPTS = Path(__file__).resolve().parents[2] / "skill" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import capture_hero_skill_details as skill_details


class CaptureHeroSkillDetailsTests(unittest.TestCase):
    def setUp(self):
        self.image = np.zeros((1280, 720, 3), dtype=np.uint8)
        self.levels = {"skill_1": 3, "skill_2": 1, "skill_3": 1}
        self.emulator = MagicMock()
        self.emulator.screencap_bgr.return_value = self.image

    def test_captures_each_icon_and_hashes_primary_images_without_upgrading(self):
        panels = [{"title": f"Skill {i} Lv.{level}", "displayed_level": level} for i, level in enumerate([3, 1, 1])]
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(skill_details.levels, "capture_hero_skills", return_value={"Gwen": self.levels}) as navigate, \
                patch.object(skill_details.levels, "_read_hero_frame", return_value=("Gwen", self.levels)), \
                patch.object(skill_details.levels, "save_hero_skills") as save_levels, \
                patch.object(skill_details, "_read_panel", side_effect=panels), \
                patch.object(skill_details.time, "sleep"):
            result = skill_details.capture_hero_skill_details(self.emulator, "minxxx", "gWeN", directory)
            manifest = json.loads(Path(result["manifest"]).read_text())
            self.assertTrue(manifest["complete"])
            self.assertEqual(manifest["current_skill_levels"], self.levels)
            self.assertEqual(len(manifest["skills"]), 3)
            for row in manifest["skills"]:
                for key in ("screenshot", "panel_crop"):
                    artifact = row[key]
                    self.assertEqual(hashlib.sha256(Path(artifact["path"]).read_bytes()).hexdigest(), artifact["sha256"])
            self.assertEqual(navigate.call_args.kwargs["target_hero"], "Gwen")
            save_levels.assert_not_called()
        self.assertEqual([call.args for call in self.emulator.tap.call_args_list], [(585, 275), (640, 435), (585, 610)])

    def test_two_skill_hero_uses_bottom_icon_for_second_skill(self):
        levels = {"skill_1": 1, "skill_2": 1}
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(skill_details.levels, "capture_hero_skills", return_value={"Gwen": levels}), \
                patch.object(skill_details.levels, "_read_hero_frame", return_value=("Gwen", levels)), \
                patch.object(skill_details, "_read_panel", side_effect=[{"title": title, "displayed_level": 1} for title in ("First Lv.1", "Second Lv.1")]), \
                patch.object(skill_details.time, "sleep"):
            result = skill_details.capture_hero_skill_details(self.emulator, "minxxx", "Gwen", directory)
            self.assertEqual(result["skills_captured"], 2)
        self.assertEqual([call.args for call in self.emulator.tap.call_args_list], [(585, 275), (585, 610)])

    def test_identity_change_stops_before_further_taps_and_keeps_partial_manifest(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(skill_details.levels, "capture_hero_skills", return_value={"Gwen": self.levels}), \
                patch.object(skill_details.levels, "_read_hero_frame", side_effect=[("Gwen", self.levels), ("Reina", self.levels)]), \
                patch.object(skill_details.time, "sleep"):
            with self.assertRaisesRegex(RuntimeError, "identity or current levels changed"):
                skill_details.capture_hero_skill_details(self.emulator, "minxxx", "Gwen", directory)
            self.assertFalse(json.loads((Path(directory) / "skill-details.json").read_text())["complete"])
            self.assertTrue((Path(directory) / "skill_1-unexpected-state.png").exists())
        self.emulator.tap.assert_called_once_with(585, 275)

    def test_level_mismatch_stops_before_further_taps(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(skill_details.levels, "capture_hero_skills", return_value={"Gwen": self.levels}), \
                patch.object(skill_details.levels, "_read_hero_frame", return_value=("Gwen", self.levels)), \
                patch.object(skill_details, "_read_panel", return_value={"title": "Wrong Lv.4", "displayed_level": 4}), \
                patch.object(skill_details.time, "sleep"):
            with self.assertRaisesRegex(RuntimeError, "skill details level differs"):
                skill_details.capture_hero_skill_details(self.emulator, "minxxx", "Gwen", directory)
        self.emulator.tap.assert_called_once_with(585, 275)

    def test_existing_artifact_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(skill_details.levels, "capture_hero_skills") as navigate:
            artifact = Path(directory) / "skill-details.json"
            artifact.write_text("original")
            with self.assertRaisesRegex(ValueError, "not empty"):
                skill_details.capture_hero_skill_details(self.emulator, "minxxx", "Gwen", directory)
            self.assertEqual(artifact.read_text(), "original")
            navigate.assert_not_called()
        self.emulator.tap.assert_not_called()

    def test_current_level_is_separate_from_preview_values(self):
        texts = ["Shadow Blade Lv.1", "25% chance to deal 120% damage", "Upgrade Preview", "120% / 140% / 160% / 180% / 200%"]
        lines = [([[0, y * 30], [500, y * 30], [500, y * 30 + 15], [0, y * 30 + 15]], text, 0.99) for y, text in enumerate(texts, 1)]
        ocr = types.ModuleType("ocr")
        ocr.RapidOCR = MagicMock(return_value=MagicMock(return_value=(lines, 0.01)))
        with patch.dict(sys.modules, {"ocr": ocr}):
            panel = skill_details._read_panel(self.image)
        self.assertEqual(panel["displayed_level"], 1)
        self.assertEqual(panel["description_text"], texts[1])
        self.assertEqual(panel["upgrade_preview_text"], texts[3])
        self.assertEqual(panel["raw_lines"][0]["box"][0], [25.0, 760.0])

    def test_split_ocr_title_and_preview_words_are_grouped_by_row(self):
        words = [("Blade", 95, 12), ("Lv. 1", 165, 10), ("Shadow", 0, 10), ("Preview", 100, 82), ("Upgrade", 0, 80), ("120%/140%/160%/180%/200%", 0, 120)]
        lines = [([[x, y], [x + 60, y], [x + 60, y + 20], [x, y + 20]], text, 0.99) for text, x, y in words]
        ocr = types.ModuleType("ocr")
        ocr.RapidOCR = MagicMock(return_value=MagicMock(return_value=(lines, 0.01)))
        with patch.dict(sys.modules, {"ocr": ocr}):
            panel = skill_details._read_panel(self.image)
        self.assertEqual(panel["title"], "Shadow Blade Lv. 1")
        self.assertEqual(panel["upgrade_preview_status"], "visible_in_ocr")
        self.assertEqual(panel["upgrade_preview_text"], "120%/140%/160%/180%/200%")


if __name__ == "__main__":
    unittest.main()
