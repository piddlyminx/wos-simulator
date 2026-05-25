from __future__ import annotations

import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "skill" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

navigation = types.ModuleType("navigation")
navigation.find_template = lambda *_args, **_kwargs: (False, (0, 0))
navigation.goto_world_map = lambda *_args, **_kwargs: None
navigation.goto_coord = lambda *_args, **_kwargs: None
navigation.TEMPLATE_COORD_SEARCH_ICON = "world_coord_search_icon.png"
navigation.WosNavigationError = RuntimeError
sys.modules.setdefault("navigation", navigation)

import dispatch

if sys.modules.get("navigation") is navigation:
    del sys.modules["navigation"]


class FakeEmulator:
    def __init__(self) -> None:
        self.taps: list[tuple[int, int]] = []

    def screencap_bgr(self):
        return np.zeros((1280, 720, 3), dtype=np.uint8)

    def tap(self, x: int, y: int) -> None:
        self.taps.append((x, y))


class DispatchPreset7Tests(unittest.TestCase):
    def test_find_and_tap_retries_transient_template_miss(self) -> None:
        calls = 0

        def fake_find_template(_img, _template_path, threshold=0.85):
            nonlocal calls
            calls += 1
            if calls == 1:
                return False, (0, 0)
            return True, (111, 222)

        emulator = FakeEmulator()

        with patch.object(dispatch, "find_template", side_effect=fake_find_template), \
                patch.object(dispatch.time, "sleep", return_value=None):
            result = dispatch._find_and_tap(emulator, dispatch.TPL_DEPLOY_BTN, "Deploy")

        self.assertEqual(result, (111, 222))
        self.assertEqual(calls, 2)
        self.assertEqual(emulator.taps, [(111, 222)])

    def test_find_and_tap_failure_includes_score_and_screenshot(self) -> None:
        emulator = FakeEmulator()

        with patch.object(dispatch, "find_template", return_value=(False, (0, 0))), \
                patch.object(dispatch, "_template_score", return_value=0.42), \
                patch.object(dispatch.cv2, "imwrite") as imwrite, \
                patch.object(dispatch.time, "sleep", return_value=None):
            with self.assertRaises(dispatch.WosDispatchError) as ctx:
                dispatch._find_and_tap(emulator, dispatch.TPL_SAVE_FLAG, "SaveFlag")

        message = str(ctx.exception)
        self.assertIn("SaveFlag: template not found after 3 attempts", message)
        self.assertIn("score=0.420", message)
        self.assertIn("threshold=0.850", message)
        self.assertIn("screenshot=", message)
        imwrite.assert_called_once()

    def test_load_preset7_selects_slot_verifies_and_deploys(self) -> None:
        calls: list[str] = []

        def fake_find_template(_img, template_path, threshold=0.85):
            calls.append(Path(template_path).name)
            if Path(template_path).name == "flag_7_alert.png":
                return False, (0, 0)
            return True, (111, 222)

        emulator = FakeEmulator()
        army_spec = {"heroes": {"Molly": {}}, "troops": {"infantry_t6": 100}}

        with patch.object(dispatch, "find_template", side_effect=fake_find_template), \
                patch.object(dispatch.time, "sleep", return_value=None), \
                patch.object(dispatch, "_assign_hero") as assign_hero, \
                patch.object(dispatch, "_ocr_troop_rows") as ocr_rows:
            result = dispatch.deploy_army(emulator, army_spec, preset_mode="load")

        self.assertTrue(result["ok"])
        self.assertEqual(result["preset"], 7)
        self.assertEqual(
            calls,
            ["flag_7_alert.png", "flag_7.png", "flag_7_selected.png", "deploy_button.png"],
        )
        self.assertEqual(emulator.taps, [(111, 222), (111, 222)])
        assign_hero.assert_not_called()
        ocr_rows.assert_not_called()

    def test_load_preset7_accepts_already_selected_slot(self) -> None:
        calls: list[str] = []

        def fake_find_template(_img, template_path, threshold=0.85):
            calls.append(Path(template_path).name)
            if Path(template_path).name == "flag_7_selected.png":
                return True, (333, 444)
            if Path(template_path).name == "deploy_button.png":
                return True, (555, 666)
            return False, (0, 0)

        emulator = FakeEmulator()
        army_spec = {"heroes": {"Molly": {}}, "troops": {"infantry_t6": 100}}

        with patch.object(dispatch, "find_template", side_effect=fake_find_template), \
                patch.object(dispatch.time, "sleep", return_value=None), \
                patch.object(dispatch, "_assign_hero") as assign_hero, \
                patch.object(dispatch, "_ocr_troop_rows") as ocr_rows:
            result = dispatch.deploy_army(emulator, army_spec, preset_mode="load")

        self.assertTrue(result["ok"])
        self.assertEqual(result["preset"], 7)
        self.assertEqual(calls, ["flag_7_alert.png", "flag_7.png", "flag_7_selected.png", "deploy_button.png"])
        self.assertEqual(emulator.taps, [(555, 666)])
        assign_hero.assert_not_called()
        ocr_rows.assert_not_called()

    def test_load_preset7_error_includes_scores_and_screenshot(self) -> None:
        def fake_find_template(_img, _template_path, threshold=0.85):
            return False, (0, 0)

        emulator = FakeEmulator()
        army_spec = {"heroes": {"Molly": {}}, "troops": {"infantry_t6": 100}}

        with patch.object(dispatch, "find_template", side_effect=fake_find_template), \
                patch.object(dispatch, "_template_score", side_effect=[0.42, 0.12, 0.51]), \
                patch.object(dispatch.cv2, "imwrite") as imwrite:
            with self.assertRaises(dispatch.WosDispatchError) as ctx:
                dispatch.deploy_army(emulator, army_spec, preset_mode="load")

        message = str(ctx.exception)
        self.assertIn("flag_7 score=0.420", message)
        self.assertIn("flag_7_alert score=0.120", message)
        self.assertIn("selected score=0.510", message)
        self.assertIn("screenshot=/tmp/wosctl_LoadPreset7_preset7_not_found.png", message)
        imwrite.assert_called_once()


if __name__ == "__main__":
    unittest.main()
