from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "skill" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from capture_report_top_bottom import (
    ReportBottomNotReachedError,
    _inspect_stats_frame,
    contains_report_end,
    scroll_to_bottom,
)
from report_reader import (
    _extract_report_timestamp,
    _parse_captured_report,
    resolve_saved_report_images,
)
import report_reader
import parse_battle_details
from parse_battle_details import _full_pass_is_complete
import parse_report
from parse_report import _names_from_ocr_lines


class FakeEmulator:
    def __init__(self, frames: list[np.ndarray]):
        self.frames = frames
        self.index = 0
        self.swipes: list[tuple[int, int, int, int, int]] = []

    def screencap_bgr(self) -> np.ndarray:
        frame = self.frames[min(self.index, len(self.frames) - 1)]
        self.index += 1
        return frame

    def swipe(self, x1: int, y1: int, x2: int, y2: int, dur_ms: int) -> None:
        self.swipes.append((x1, y1, x2, y2, dur_ms))


def frame(value: int) -> np.ndarray:
    return np.full((1280, 720, 3), value, dtype=np.uint8)


class ReportCaptureContractTests(unittest.TestCase):
    def test_saved_report_bundle_accepts_standard_webp_names(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            directory = Path(tmpdir)
            for stem in ("report_top", "report_stats", "bd_top", "bd_bot"):
                (directory / f"{stem}.webp").touch()

            resolved = resolve_saved_report_images(directory)

        self.assertEqual(set(resolved), {"report_top", "report_stats", "bd_top", "bd_bot"})
        self.assertTrue(all(path.endswith(".webp") for path in resolved.values()))

    def test_battle_details_can_require_visible_summary_boundary(self) -> None:
        image = np.zeros((1280, 720, 3), dtype=np.uint8)
        with patch.object(parse_battle_details.cv2, "imread", return_value=image), \
                patch.object(
                    parse_battle_details,
                    "_extract_heroes_from_image_with_meta",
                    return_value=([{"left_hero": "Gatot", "right_hero": "Gatot"}], False),
                ):
            with self.assertRaisesRegex(RuntimeError, "partial hero list"):
                parse_battle_details.parse_battle_details(
                    "top.webp",
                    "bottom.webp",
                    require_complete=True,
                )

    def test_outcome_ocr_falls_back_when_troop_totals_do_not_balance(self) -> None:
        top = np.zeros((1280, 720, 3), dtype=np.uint8)
        template = np.zeros((20, 100, 3), dtype=np.uint8)
        crnn_values = iter(["9000", "10", "0", "0", "9", "494", "41", "8", "14", ""])
        fallback_values = iter([
            ("5,000", 5000), ("0", 0), ("150", 150), ("277", 277), ("4,573", 4573),
            ("1,010", 1010), ("0", 0), ("354", 354), ("656", 656), ("0", 0),
        ])

        with patch.object(parse_report.cv2, "imread", side_effect=[top, template]), \
                patch.object(parse_report, "_require_template_anchor", return_value=(0, 100)), \
                patch.object(parse_report, "_detect_roles", return_value=("attacker", "defender")), \
                patch.object(parse_report, "_read_names", return_value=("Left", "Right")), \
                patch.object(parse_report, "_ocr_crnn", side_effect=lambda _gray: next(crnn_values)), \
                patch.object(
                    parse_report,
                    "_ocr_integer_tesseract",
                    side_effect=lambda _gray: next(fallback_values),
                ):
            parsed = parse_report.parse_battle_report("top.webp")

        self.assertEqual(parsed["left"]["troops"], 5000)
        self.assertEqual(parsed["left"]["survivors"], 4573)
        self.assertEqual(parsed["right"]["troops"], 1010)
        self.assertEqual(parsed["right"]["injured"], 354)

    def test_fast_name_ocr_assigns_lines_by_screen_side(self) -> None:
        lines = [
            ([[10, 0], [200, 0], [200, 20], [10, 20]], "[RAM]XxWIPxX", 0.98),
            ([[390, 0], [650, 0], [650, 20], [390, 20]], "[BBQ]Piddlyminxxx", 0.99),
        ]

        self.assertEqual(
            _names_from_ocr_lines(lines, 670),
            ("[RAM]XxWIPxX", "[BBQ]Piddlyminxxx"),
        )

    def test_fast_hero_pass_requires_every_visible_row_to_be_paired(self) -> None:
        raw_items = [
            {"text": "Lancer Hero:", "x": 150, "y": 100},
            {"text": "Marksman Hero:", "x": 150, "y": 200},
        ]
        complete_pairs = [
            {"left_hero": "Vacant", "right_hero": "Norah"},
            {"left_hero": "Vacant", "right_hero": "Alonso"},
        ]

        self.assertTrue(_full_pass_is_complete(raw_items, complete_pairs))
        self.assertFalse(_full_pass_is_complete(raw_items, complete_pairs[:1]))
        self.assertFalse(
            _full_pass_is_complete(
                raw_items[:1],
                [{"right_hero": "Norah"}],
            )
        )

    def test_scroll_to_bottom_succeeds_only_when_detector_confirms_end(self) -> None:
        emulator = FakeEmulator([frame(10), frame(20), frame(30)])
        calls = 0

        def detect(_img: np.ndarray) -> tuple[bool, str]:
            nonlocal calls
            calls += 1
            return calls == 3, "Battle Details" if calls == 3 else "not there"

        events: list[dict[str, object]] = []
        self.assertTrue(scroll_to_bottom(emulator, detect, diagnostic_events=events))
        self.assertEqual(calls, 3)
        self.assertEqual(len(emulator.swipes), 2)

    def test_scroll_to_bottom_keeps_swiping_down_until_marker_or_limit(self) -> None:
        emulator = FakeEmulator([frame(10), frame(10), frame(10), frame(10), frame(10)])

        def detect(_img: np.ndarray) -> tuple[bool, str]:
            return False, "footer text without marker"

        events: list[dict[str, object]] = []
        self.assertFalse(scroll_to_bottom(emulator, detect, max_steps=4, diagnostic_events=events))
        self.assertEqual(
            emulator.swipes,
            [(360, 1120, 360, 120, 450)] * 4,
        )
        self.assertEqual([event["event"] for event in events], ["detect"] * 5)

    def test_scroll_to_bottom_uses_expensive_fallback_periodically(self) -> None:
        emulator = FakeEmulator([frame(10)] * 6)
        fallback_calls = 0

        def fast(_img: np.ndarray) -> tuple[bool, str]:
            return False, "template miss"

        def fallback(_img: np.ndarray) -> tuple[bool, str]:
            nonlocal fallback_calls
            fallback_calls += 1
            return True, "OCR Battle Details"

        self.assertTrue(
            scroll_to_bottom(
                emulator,
                fast,
                max_steps=8,
                fallback_detect_fn=fallback,
                fallback_every=4,
            )
        )
        self.assertEqual(fallback_calls, 1)
        self.assertEqual(len(emulator.swipes), 4)

    def test_parse_captured_report_refuses_unconfirmed_bottom(self) -> None:
        with self.assertRaisesRegex(
            ReportBottomNotReachedError,
            "report_bottom_reached is false",
        ):
            _parse_captured_report(
                {
                    "report_top": "top.png",
                    "report_stats": "stats.png",
                    "bd_top": "bd_top.png",
                    "bd_bot": "bd_bot.png",
                    "report_bottom_reached": False,
                },
                debug_dir=Path("/tmp/wos-debug"),
            )

    def test_report_timestamp_can_span_ocr_boxes(self) -> None:
        candidates = [
            {"text": "We", "x": 194, "y": 242},
            {"text": "were", "x": 242, "y": 243},
            {"text": "defeated", "x": 318, "y": 242},
            {"text": "by", "x": 380, "y": 244},
            {"text": "[ARK]Piddlyminxxx!", "x": 495, "y": 243},
            {"text": "2026-04-29", "x": 242, "y": 273},
            {"text": "20:57:28", "x": 361, "y": 273},
            {"text": "Attacker", "x": 229, "y": 352},
            {"text": "Victory", "x": 333, "y": 354},
        ]

        self.assertEqual(
            _extract_report_timestamp(candidates),
            ("2026-04-29 20:57:28", 1777496248),
        )

    def test_report_timestamp_accepts_split_second_ocr_dot(self) -> None:
        candidates = [
            {"text": "We", "x": 193, "y": 241},
            {"text": "were", "x": 242, "y": 242},
            {"text": "victorious", "x": 324, "y": 242},
            {"text": "against", "x": 416, "y": 243},
            {"text": "[BBQ]XxWIPxX!", "x": 537, "y": 242},
            {"text": "2026-05-05", "x": 241, "y": 272},
            {"text": "17:53:4.5", "x": 356, "y": 273},
            {"text": "Attacker", "x": 230, "y": 352},
            {"text": "Defeat", "x": 331, "y": 352},
        ]

        self.assertEqual(
            _extract_report_timestamp(candidates),
            ("2026-05-05 17:53:45", 1778003625),
        )

    def test_report_timestamp_discards_stray_leading_hour_digit(self) -> None:
        candidates = [
            {"text": "2026-07-18", "x": 238, "y": 273},
            {"text": "303:19:05", "x": 343, "y": 272},
        ]

        self.assertEqual(
            _extract_report_timestamp(candidates),
            ("2026-07-18 03:19:05", 1784344745),
        )

    def test_latest_report_timestamp_fails_closed_when_ocr_is_unreadable(self) -> None:
        emulator = FakeEmulator([frame(0)])
        with patch.object(report_reader, "_open_mail_inbox"), \
                patch.object(report_reader, "_select_mail_tab"), \
                patch.object(report_reader, "_ocr_text_items", return_value=[]), \
                patch.object(report_reader, "_ocr_timestamp_tesseract", return_value=[]):
            with self.assertRaisesRegex(
                report_reader.WosNavigationError,
                "refusing to risk capturing a stale report",
            ):
                report_reader.get_latest_report_timestamp(emulator, "war")

    def test_latest_report_timestamp_uses_targeted_fallback(self) -> None:
        emulator = FakeEmulator([frame(0)])
        with patch.object(report_reader, "_open_mail_inbox"), \
                patch.object(report_reader, "_select_mail_tab"), \
                patch.object(report_reader, "_ocr_text_items", return_value=[]), \
                patch.object(report_reader, "_ocr_timestamp_tesseract", return_value=[
                    {"text": "2026-07-18 03:19:05", "x": 300, "y": 275},
                ]):
            timestamp = report_reader.get_latest_report_timestamp(emulator, "war")

        self.assertEqual(timestamp, 1784344745)

    def test_wait_for_new_report_returns_timestamp_and_leaves_inbox_open(self) -> None:
        emulator = FakeEmulator([frame(0)])
        timestamp = 1784344745.0
        with patch.object(report_reader, "_open_mail_inbox") as open_inbox, \
                patch.object(report_reader, "_select_mail_tab") as select_tab, \
                patch.object(report_reader, "_ocr_text_items", return_value=[
                    {"text": "2026-07-18 03:19:05", "x": 300, "y": 270},
                ]):
            found = report_reader.wait_for_new_report(
                emulator,
                "war",
                after=timestamp - 1,
                timeout_sec=1,
                poll_sec=0,
            )

        self.assertEqual(found, timestamp)
        open_inbox.assert_called_once_with(emulator)
        select_tab.assert_called_once_with(emulator, "war")

    def test_report_end_detects_battle_details_button_template(self) -> None:
        template = cv2.imread(str(ROOT / "skill" / "templates" / "battle_details_button.png"), cv2.IMREAD_COLOR)
        self.assertIsNotNone(template)
        img = frame(0)
        th, tw = template.shape[:2]
        img[900:900 + th, 220:220 + tw] = template

        found, detail = contains_report_end(img)

        self.assertTrue(found, detail)
        self.assertIn("battle_details_button found", detail)

    def test_stats_frame_accepts_complete_live_layout_with_high_header(self) -> None:
        template = cv2.imread(str(ROOT / "skill" / "templates" / "tpl_stat_bonuses.png"), cv2.IMREAD_COLOR)
        self.assertIsNotNone(template)
        img = frame(0)
        th, tw = template.shape[:2]
        img[228:228 + th, 270:270 + tw] = template

        state = _inspect_stats_frame(img)

        self.assertEqual(state["sb_top"], 216)
        self.assertTrue(state["parseable"])

    def test_reference_stats_frames_are_inside_capture_band(self) -> None:
        paths = [
            Path("/mnt/c/Users/ppamm/Documents/MuMuSharedFolder/Screenshots/MuMu-20260429-075620-144.png"),
            Path("/mnt/c/Users/ppamm/Documents/MuMuSharedFolder/Screenshots/MuMu-20260429-075710-792.png"),
        ]
        for path in paths:
            if not path.exists():
                self.skipTest(f"reference screenshot not available: {path}")
            img = cv2.imread(str(path))
            state = _inspect_stats_frame(img)
            self.assertTrue(state["parseable"], f"{path}: {state}")


if __name__ == "__main__":
    unittest.main()
