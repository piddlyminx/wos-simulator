from __future__ import annotations

import sys
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "skill" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

navigation = types.ModuleType("navigation")
navigation.find_template = lambda *_args, **_kwargs: (False, (0, 0))
navigation.goto_city = lambda *_args, **_kwargs: None
navigation.goto_world_map = lambda *_args, **_kwargs: None
navigation.goto_coord = lambda *_args, **_kwargs: None
navigation.TEMPLATE_COORD_SEARCH_ICON = "world_coord_search_icon.png"
navigation.WosNavigationError = RuntimeError
sys.modules.setdefault("navigation", navigation)

import dispatch


class DispatchRelocationTests(unittest.TestCase):
    def test_parse_world_coords_from_same_line(self) -> None:
        self.assertEqual(
            dispatch._parse_world_coords_from_text("#2487 X:836  Y:842"),
            (836, 842),
        )

    def test_parse_world_coords_accepts_fullwidth_colon(self) -> None:
        self.assertEqual(
            dispatch._parse_world_coords_from_text("#2487 X：781 Y：523"),
            (781, 523),
        )

    def test_parse_world_coords_rejects_implausible_values(self) -> None:
        self.assertIsNone(dispatch._parse_world_coords_from_text("X:5 Y:842"))

    def test_near_target_does_not_teleport(self) -> None:
        emulator = Mock()

        with patch.object(dispatch, "_ocr_current_world_coords", return_value=(800, 800)), \
                patch.object(dispatch, "_try_teleport_near_target") as teleport, \
                patch("navigation.goto_world_map", return_value=None), \
                patch.object(dispatch.time, "sleep", return_value=None):
            relocated = dispatch._ensure_attacker_near_target(emulator, 806, 804)

        self.assertFalse(relocated)
        teleport.assert_not_called()

    def test_far_target_navigates_and_teleports(self) -> None:
        emulator = Mock()
        calls: list[tuple[int, int]] = []

        def fake_goto_coord(_emulator, x, y):
            calls.append((x, y))

        with patch.object(dispatch, "_ocr_current_world_coords", return_value=(700, 700)), \
                patch.object(dispatch, "_try_teleport_near_target", return_value=True), \
                patch("navigation.goto_world_map", return_value=None), \
                patch("navigation.goto_coord", side_effect=fake_goto_coord), \
                patch.object(dispatch.time, "sleep", return_value=None):
            relocated = dispatch._ensure_attacker_near_target(emulator, 760, 760)

        self.assertTrue(relocated)
        self.assertEqual(calls, [(760, 760)])


if __name__ == "__main__":
    unittest.main()
