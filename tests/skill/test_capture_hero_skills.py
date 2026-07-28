from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np


ROOT = Path(__file__).resolve().parents[2]
SKILL = ROOT / "skill"
SCRIPTS = SKILL / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import capture_hero_skills


class CaptureHeroSkillsTests(unittest.TestCase):
    def test_canonical_hero_names_include_gen8_without_model_sidecars(self) -> None:
        names = capture_hero_skills._load_hero_names()

        self.assertTrue({"Gatot", "Hendrik", "Sonya"}.issubset(names))
        self.assertFalse((SKILL / "models" / "hero_name.onnx").exists())
        self.assertFalse((SKILL / "models" / "hero_name_labels.json").exists())

    def test_hero_name_ocr_uses_canonical_text_matcher_directly(self) -> None:
        image = np.zeros((1280, 720, 3), dtype=np.uint8)

        with patch.object(
            capture_hero_skills,
            "_ocr_hero_name_tesseract",
            return_value="Gatot",
        ) as text_ocr:
            name = capture_hero_skills._ocr_hero_name(
                image,
                ["Gatot", "Hendrik", "Sonya"],
            )

        self.assertEqual(name, "Gatot")
        text_ocr.assert_called_once()

    def test_duplicate_identity_retries_same_frame_against_unseen_names(self) -> None:
        image = np.zeros((1280, 720, 3), dtype=np.uint8)
        skills = {"skill_1": 1, "skill_2": 3, "skill_3": 1}

        with patch.object(
            capture_hero_skills,
            "_read_hero_frame",
            return_value=("Gatot", skills),
        ) as read_frame:
            parsed = capture_hero_skills._reidentify_duplicate_hero_frame(
                image,
                ["Edith", "Gatot", "Hendrik"],
                {"Edith"},
            )

        self.assertEqual(parsed, ("Gatot", skills))
        self.assertEqual(read_frame.call_args.args[1], ["Gatot", "Hendrik"])


if __name__ == "__main__":
    unittest.main()
