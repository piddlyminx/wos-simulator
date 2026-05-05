from __future__ import annotations

import sys
import unittest
from pathlib import Path

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
from report_reader import _extract_report_timestamp, _parse_captured_report


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

    def test_scroll_to_bottom_does_not_treat_stable_image_as_success(self) -> None:
        emulator = FakeEmulator([frame(10), frame(10), frame(10), frame(10), frame(10)])

        def detect(_img: np.ndarray) -> tuple[bool, str]:
            return False, "footer text without marker"

        events: list[dict[str, object]] = []
        self.assertFalse(scroll_to_bottom(emulator, detect, diagnostic_events=events))
        self.assertTrue(any(event["event"] == "scroll_stopped" for event in events))
        self.assertEqual(
            sum(1 for event in events if event["event"] == "confirm_retry"),
            3,
        )

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

    def test_report_end_detects_battle_details_button_template(self) -> None:
        template = cv2.imread(str(ROOT / "skill" / "templates" / "battle_details_button.png"), cv2.IMREAD_COLOR)
        self.assertIsNotNone(template)
        img = frame(0)
        th, tw = template.shape[:2]
        img[900:900 + th, 220:220 + tw] = template

        found, detail = contains_report_end(img)

        self.assertTrue(found, detail)
        self.assertIn("battle_details_button found", detail)

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
