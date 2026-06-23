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

emulator = types.ModuleType("emulator")
emulator.WosError = RuntimeError
sys.modules.setdefault("emulator", emulator)

import dispatch

if sys.modules.get("navigation") is navigation:
    del sys.modules["navigation"]
if sys.modules.get("emulator") is emulator:
    del sys.modules["emulator"]


class DispatchHeroAssignmentTests(unittest.TestCase):
    def test_single_hero_uses_remaining_hero_scan_path(self) -> None:
        emulator = object()
        queried: list[tuple[str, ...]] = []
        assigned: list[str] = []

        def fake_find_visible(_emulator, hero_names):
            queried.append(tuple(hero_names))
            return "Molly", (101, 201)

        def fake_tap_assign(_emulator, hero_name, _coords):
            assigned.append(hero_name)

        with patch.object(dispatch, "_find_visible_requested_hero", side_effect=fake_find_visible), \
                patch.object(dispatch, "_tap_assign_for_visible_hero", side_effect=fake_tap_assign), \
                patch.object(dispatch, "_focus_hero_slot") as focus_slot, \
                patch.object(dispatch, "_scroll_hero_list") as scroll:
            dispatch._assign_heroes(emulator, ["Molly"], max_scrolls=3)

        self.assertEqual(assigned, ["Molly"])
        self.assertEqual(queried, [("Molly",)])
        focus_slot.assert_not_called()
        scroll.assert_not_called()

    def test_single_hero_keeps_direction_while_scroll_changes_screen(self) -> None:
        emulator = object()
        queried: list[tuple[str, ...]] = []
        assigned: list[str] = []

        def fake_find_visible(_emulator, hero_names):
            queried.append(tuple(hero_names))
            if len(queried) == 3:
                return "Molly", (101, 201)
            return None

        def fake_tap_assign(_emulator, hero_name, _coords):
            assigned.append(hero_name)

        with patch.object(dispatch, "_find_visible_requested_hero", side_effect=fake_find_visible), \
                patch.object(dispatch, "_tap_assign_for_visible_hero", side_effect=fake_tap_assign), \
                patch.object(dispatch, "_focus_hero_slot") as focus_slot, \
                patch.object(dispatch, "_scroll_hero_list") as scroll:
            dispatch._assign_heroes(emulator, ["Molly"], max_scrolls=1)

        self.assertEqual(assigned, ["Molly"])
        self.assertEqual(queried, [("Molly",), ("Molly",), ("Molly",)])
        focus_slot.assert_not_called()
        self.assertEqual(
            [call.args for call in scroll.call_args_list],
            [(emulator,), (emulator,)],
        )
        self.assertEqual(
            [call.kwargs for call in scroll.call_args_list],
            [{"direction": "down"}, {"direction": "down"}],
        )

    def test_single_hero_reverses_direction_when_scroll_area_is_unchanged(self) -> None:
        emulator = object()
        queried: list[tuple[str, ...]] = []
        assigned: list[str] = []

        def fake_find_visible(_emulator, hero_names):
            queried.append(tuple(hero_names))
            if len(queried) == 3:
                return "Molly", (101, 201)
            return None

        def fake_tap_assign(_emulator, hero_name, _coords):
            assigned.append(hero_name)

        with patch.object(dispatch, "_find_visible_requested_hero", side_effect=fake_find_visible), \
                patch.object(dispatch, "_tap_assign_for_visible_hero", side_effect=fake_tap_assign), \
                patch.object(dispatch, "_focus_hero_slot") as focus_slot, \
                patch.object(dispatch, "_scroll_hero_list", side_effect=[False, True]) as scroll:
            dispatch._assign_heroes(emulator, ["Molly"], max_scrolls=1)

        self.assertEqual(assigned, ["Molly"])
        self.assertEqual(queried, [("Molly",), ("Molly",), ("Molly",)])
        focus_slot.assert_not_called()
        self.assertEqual(
            [call.kwargs for call in scroll.call_args_list],
            [{"direction": "down"}, {"direction": "up"}],
        )

    def test_single_hero_refocuses_slot_when_both_scroll_directions_stall(self) -> None:
        emulator = object()
        queried: list[tuple[str, ...]] = []
        assigned: list[str] = []

        def fake_find_visible(_emulator, hero_names):
            queried.append(tuple(hero_names))
            if len(queried) == 4:
                return "Molly", (101, 201)
            return None

        def fake_tap_assign(_emulator, hero_name, _coords):
            assigned.append(hero_name)

        with patch.object(dispatch, "_find_visible_requested_hero", side_effect=fake_find_visible), \
                patch.object(dispatch, "_tap_assign_for_visible_hero", side_effect=fake_tap_assign), \
                patch.object(dispatch, "_focus_hero_slot") as focus_slot, \
                patch.object(dispatch, "_write_hero_picker_diagnostics") as diagnostics, \
                patch.object(dispatch, "_scroll_hero_list", side_effect=[False, False, True]) as scroll:
            dispatch._assign_heroes(emulator, ["Molly"], max_scrolls=1)

        self.assertEqual(assigned, ["Molly"])
        self.assertEqual(queried, [("Molly",), ("Molly",), ("Molly",), ("Molly",)])
        focus_slot.assert_called_once_with(emulator, 0)
        diagnostics.assert_called_once()
        self.assertEqual(diagnostics.call_args.args[0], emulator)
        self.assertEqual(diagnostics.call_args.args[2], "stalled_slot_1")
        self.assertEqual(
            [call.kwargs for call in scroll.call_args_list],
            [{"direction": "down"}, {"direction": "up"}, {"direction": "down"}],
        )

    def test_multi_hero_assigns_requested_heroes_in_spec_order(self) -> None:
        emulator = object()
        queried: list[tuple[str, ...]] = []
        assigned: list[str] = []

        def fake_find_visible(_emulator, hero_names):
            queried.append(tuple(hero_names))
            if tuple(hero_names) == ("Philly", "Bahiti"):
                return "Bahiti", (101, 201)
            if tuple(hero_names) == ("Philly",):
                return "Philly", (102, 202)
            if tuple(hero_names) == ("Bahiti",):
                return "Bahiti", (101, 201)
            return None

        def fake_tap_assign(_emulator, hero_name, _coords):
            assigned.append(hero_name)

        with patch.object(dispatch, "_find_visible_requested_hero", side_effect=fake_find_visible), \
                patch.object(dispatch, "_tap_assign_for_visible_hero", side_effect=fake_tap_assign), \
                patch.object(dispatch, "_focus_hero_slot") as focus_slot, \
                patch.object(dispatch, "_scroll_hero_list") as scroll:
            dispatch._assign_heroes(emulator, ["Philly", "Bahiti"], max_scrolls=3)

        self.assertEqual(assigned, ["Philly", "Bahiti"])
        self.assertEqual(queried, [("Philly",), ("Bahiti",)])
        focus_slot.assert_called_once_with(emulator, 1)
        scroll.assert_not_called()

    def test_multi_hero_scrolls_current_slot_before_next_requested_hero(self) -> None:
        emulator = object()
        queried: list[tuple[str, ...]] = []
        assigned: list[str] = []

        def fake_find_visible(_emulator, hero_names):
            queried.append(tuple(hero_names))
            if len(queried) == 1:
                return None
            return hero_names[0], (101, 201)

        def fake_tap_assign(_emulator, hero_name, _coords):
            assigned.append(hero_name)

        with patch.object(dispatch, "_find_visible_requested_hero", side_effect=fake_find_visible), \
                patch.object(dispatch, "_tap_assign_for_visible_hero", side_effect=fake_tap_assign), \
                patch.object(dispatch, "_focus_hero_slot") as focus_slot, \
                patch.object(dispatch, "_scroll_hero_list") as scroll:
            dispatch._assign_heroes(emulator, ["Philly", "Bahiti"], max_scrolls=3)

        self.assertEqual(assigned, ["Philly", "Bahiti"])
        self.assertEqual(queried, [("Philly",), ("Philly",), ("Bahiti",)])
        focus_slot.assert_called_once_with(emulator, 1)
        scroll.assert_called_once_with(emulator, direction="down")

    def test_hero_template_path_uses_picker_alias_for_sergey(self) -> None:
        self.assertEqual(
            Path(dispatch._hero_template_path("Sergey")).name,
            "Sergei.png",
        )

    def test_hero_picker_diagnostics_names_template_aliases(self) -> None:
        class FakeEmulator:
            def screencap_bgr(self):
                return np.full((1280, 720, 3), 12, dtype=np.uint8)

        messages: list[str] = []

        def fake_warning(message, *_args):
            messages.append(message % _args)

        with patch.object(dispatch, "_hero_template_path", return_value="/tmp/Sergei.png"), \
                patch.object(dispatch, "_template_score", return_value=0.995), \
                patch.object(dispatch.logger, "warning", side_effect=fake_warning), \
                patch.object(dispatch.cv2, "imwrite", return_value=True), \
                patch.object(dispatch.time, "strftime", return_value="20260101-000000"):
            dispatch._write_hero_picker_diagnostics(FakeEmulator(), ["Sergey"], "not_found")

        self.assertEqual(len(messages), 1)
        self.assertIn("Sergey(Sergei)=0.995", messages[0])

    def test_focus_hero_slot_taps_matching_slot_position(self) -> None:
        class FakeEmulator:
            def __init__(self) -> None:
                self.taps: list[tuple[int, int]] = []

            def tap(self, x: int, y: int) -> None:
                self.taps.append((x, y))

        emulator = FakeEmulator()

        with patch.object(dispatch.time, "sleep", return_value=None):
            dispatch._focus_hero_slot(emulator, 1)

        self.assertEqual(emulator.taps, [dispatch._HERO_SLOTS[1]])

    def test_scroll_hero_list_reports_unchanged_picker_area(self) -> None:
        class FakeEmulator:
            def __init__(self) -> None:
                self.screens = [
                    np.full((1280, 720, 3), 12, dtype=np.uint8),
                    np.full((1280, 720, 3), 12, dtype=np.uint8),
                ]
                self.shell_commands: list[str] = []

            def screencap_bgr(self):
                return self.screens.pop(0)

            def shell(self, command: str) -> None:
                self.shell_commands.append(command)

        emulator = FakeEmulator()

        with patch.object(dispatch.time, "sleep", return_value=None):
            changed = dispatch._scroll_hero_list(emulator, direction="down")

        self.assertFalse(changed)
        self.assertEqual(len(emulator.shell_commands), 1)

    def test_scroll_hero_list_reports_changed_picker_area(self) -> None:
        class FakeEmulator:
            def __init__(self) -> None:
                self.screens = [
                    np.full((1280, 720, 3), 12, dtype=np.uint8),
                    np.full((1280, 720, 3), 32, dtype=np.uint8),
                ]

            def screencap_bgr(self):
                return self.screens.pop(0)

            def shell(self, _command: str) -> None:
                pass

        emulator = FakeEmulator()

        with patch.object(dispatch.time, "sleep", return_value=None):
            changed = dispatch._scroll_hero_list(emulator, direction="up")

        self.assertTrue(changed)

    def test_find_visible_requested_hero_only_scans_picker_grid(self) -> None:
        class FakeEmulator:
            def screencap_bgr(self):
                return np.full((1280, 720, 3), 12, dtype=np.uint8)

        seen_shapes: list[tuple[int, int, int]] = []

        def fake_find_template(img, _template_path, threshold=0.85, anchor="center"):
            seen_shapes.append(img.shape)
            return True, (20, 30)

        x, y, _w, _h = dispatch._HERO_PICKER_AREA
        with patch.object(dispatch, "_hero_template_path", return_value="Molly.png"), \
                patch.object(dispatch, "find_template", side_effect=fake_find_template):
            match = dispatch._find_visible_requested_hero(FakeEmulator(), ["Molly"])

        self.assertEqual(match, ("Molly", (x + 20, y + 30)))
        self.assertEqual(seen_shapes, [(dispatch._HERO_PICKER_AREA[3], dispatch._HERO_PICKER_AREA[2], 3)])

    def test_find_hero_on_screen_returns_none_when_not_in_picker_grid(self) -> None:
        class FakeEmulator:
            def screencap_bgr(self):
                return np.full((1280, 720, 3), 12, dtype=np.uint8)

        seen_shapes: list[tuple[int, int, int]] = []

        def fake_find_template(img, _template_path, threshold=0.85, anchor="center"):
            seen_shapes.append(img.shape)
            return False, (0, 0)

        with patch.object(dispatch, "_hero_template_path", return_value="Molly.png"), \
                patch.object(dispatch, "find_template", side_effect=fake_find_template):
            match = dispatch._find_hero_on_screen(FakeEmulator(), "Molly")

        self.assertIsNone(match)
        self.assertEqual(seen_shapes, [(dispatch._HERO_PICKER_AREA[3], dispatch._HERO_PICKER_AREA[2], 3)])


if __name__ == "__main__":
    unittest.main()
