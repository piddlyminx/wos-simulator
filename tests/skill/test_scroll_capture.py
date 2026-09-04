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

import scroll_capture
from scroll_capture import (
    _swipe,
    capture_scrolling_screenshot,
    detect_content_bounds,
    estimate_signed_vertical_motion,
    stitch_scrolling_frames,
)


class FakeScrollingEmulator:
    def __init__(
        self,
        document: np.ndarray,
        *,
        viewport_height: int,
        initial_offset: int,
        step: int,
        header: np.ndarray,
        footer: np.ndarray,
    ) -> None:
        self.document = document
        self.viewport_height = viewport_height
        self.offset = initial_offset
        self.step = step
        self.header = header
        self.footer = footer
        self.swipes: list[tuple[int, int, int, int, int]] = []

    def screencap_bgr(self) -> np.ndarray:
        viewport = self.document[self.offset : self.offset + self.viewport_height]
        return np.concatenate([self.header, viewport, self.footer], axis=0)

    def swipe(self, x1: int, y1: int, x2: int, y2: int, dur_ms: int) -> None:
        self.swipes.append((x1, y1, x2, y2, dur_ms))
        maximum = len(self.document) - self.viewport_height
        if y2 > y1:
            self.offset = max(0, self.offset - self.step)
        else:
            self.offset = min(maximum, self.offset + self.step)


class AnimatedChromeEmulator(FakeScrollingEmulator):
    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self.capture_number = 0

    def screencap_bgr(self) -> np.ndarray:
        frame = super().screencap_bgr()
        self.capture_number += 1
        frame[:15] = 0 if self.capture_number % 2 else 255
        return frame


class BounceEmulator:
    def __init__(self, frames: list[np.ndarray]) -> None:
        self.frames = iter(frames)
        self.swipes: list[tuple[int, ...]] = []

    def swipe(self, *args: int) -> None:
        self.swipes.append(args)

    def screencap_bgr(self) -> np.ndarray:
        return next(self.frames)


class ScrollCaptureTests(unittest.TestCase):
    def setUp(self) -> None:
        rng = np.random.default_rng(812)
        self.header = np.full((20, 80, 3), 17, dtype=np.uint8)
        self.footer = np.full((20, 80, 3), 233, dtype=np.uint8)
        self.document = rng.integers(0, 256, size=(380, 80, 3), dtype=np.uint8)

    def test_detect_content_bounds_excludes_fixed_chrome(self) -> None:
        frames = [
            np.concatenate(
                [self.header, self.document[offset : offset + 160], self.footer]
            )
            for offset in (0, 100)
        ]

        top, bottom = detect_content_bounds(*frames)

        self.assertLessEqual(abs(top - 20), 2)
        self.assertLessEqual(abs(bottom - 180), 2)

    def test_stitch_scrolling_frames_has_no_missing_or_duplicate_rows(self) -> None:
        frames = [
            np.concatenate(
                [self.header, self.document[offset : offset + 160], self.footer]
            )
            for offset in (0, 100, 220)
        ]

        stitched = stitch_scrolling_frames(frames, content_bounds=(20, 180))

        np.testing.assert_array_equal(
            stitched,
            np.concatenate([self.header, self.document, self.footer]),
        )

    def test_text_anchors_disambiguate_repeated_list_rows(self) -> None:
        previous = self.document[:160]
        current = self.document[100:260]
        anchors = [
            {"unique-one": (40, 120), "unique-two": (40, 145)},
            {"unique-one": (40, 20), "unique-two": (40, 45)},
        ]

        with (
            patch.object(
                scroll_capture,
                "estimate_vertical_scroll",
                return_value=(20, 0.5),
            ),
            patch.object(
                scroll_capture,
                "_text_anchors",
                side_effect=anchors,
            ),
        ):
            shifts = scroll_capture._consistent_scroll_shifts([previous, current])

        self.assertEqual(shifts, [100])
        stitched = stitch_scrolling_frames(
            [previous, current],
            content_bounds=(0, 160),
            shifts=shifts,
        )
        np.testing.assert_array_equal(stitched, self.document[:260])

    def test_final_partial_scroll_can_be_less_than_three_percent(self) -> None:
        previous = self.document[:160]
        current = self.document[3:163]

        shifts = scroll_capture._consistent_scroll_shifts([previous, current])

        self.assertEqual(shifts, [3])

    def test_text_alignment_handles_fractional_scroll_rasterization(self) -> None:
        previous = self.document[:160]
        current = cv2.addWeighted(
            self.document[100:260],
            0.5,
            self.document[101:261],
            0.5,
            0,
        )
        anchors = [
            {
                "unique-one": (40, 115),
                "unique-two": (40, 125),
            },
            {
                "unique-one": (40, 15),
                "unique-two": (40, 25),
            },
        ]

        with (
            patch.object(
                scroll_capture,
                "estimate_vertical_scroll",
                return_value=(20, 2.0),
            ),
            patch.object(
                scroll_capture,
                "_text_anchors",
                side_effect=anchors,
            ),
        ):
            shifts = scroll_capture._consistent_scroll_shifts([previous, current])

        self.assertEqual(shifts, [101])

    def test_text_anchors_fall_back_when_tesseract_is_unavailable(self) -> None:
        fallback = {"anchor": (20.0, 30.0)}
        with (
            patch("pytesseract.image_to_data", side_effect=OSError),
            patch.object(
                scroll_capture,
                "_rapid_text_anchors",
                return_value=fallback,
            ) as rapid,
        ):
            anchors = scroll_capture._text_anchors(self.document[:160])

        self.assertEqual(anchors, fallback)
        rapid.assert_called_once()

    def test_alignment_reliability_combines_pixel_and_edge_evidence(self) -> None:
        reliable = scroll_capture._alignment_is_reliable
        diagnostic_cases = [
            (3.884, 0.447, True, True),
            (3.545, 0.513, True, True),
            (3.587, 0.549, True, True),
            (1.354, 0.511, False, True),
            (7.098, 0.488, True, True),
            (6.785, 0.451, True, True),
            (65.745, 0.967, False, False),
            (7.215, 0.465, True, True),
            (6.560, 0.421, True, True),
            (1.861, 0.516, False, True),
            (1.590, 0.534, False, True),
        ]
        for mean_error, edge_mismatch, text_supported, expected in diagnostic_cases:
            with self.subTest(
                mean_error=mean_error,
                edge_mismatch=edge_mismatch,
                text_supported=text_supported,
            ):
                self.assertEqual(
                    reliable(
                        mean_error,
                        edge_mismatch,
                        text_supported=text_supported,
                    ),
                    expected,
                )

        self.assertFalse(reliable(3.0, 0.534, text_supported=False))
        self.assertFalse(reliable(1.59, 0.70, text_supported=False))

    def test_unrelated_frames_are_rejected(self) -> None:
        rng = np.random.default_rng(814)
        previous = rng.integers(0, 256, size=(160, 80, 3), dtype=np.uint8)
        current = rng.integers(0, 256, size=(160, 80, 3), dtype=np.uint8)

        with self.assertRaises(RuntimeError):
            scroll_capture._consistent_scroll_shifts([previous, current])

    def test_featureless_frames_are_rejected(self) -> None:
        previous = np.full((160, 80, 3), 120, dtype=np.uint8)
        current = previous.copy()

        with self.assertRaises(RuntimeError):
            scroll_capture._consistent_scroll_shifts([previous, current])

    def test_saved_real_overlap_corpus(self) -> None:
        corpus_root = ROOT / "skill" / "tmp" / "wosctl_errors"
        cases = {
            "20260903T074412Z_1954499": 275,
            "20260903T081121Z_1973202": 275,
            "20260903T081708Z_1977165": 666,
            "20260903T085105Z_2014944": 0,
            "20260903T110905Z_2106423": 305,
            "20260903T130022Z_2210164": 316,
            "20260903T132404Z_2239086": None,
            "20260903T134722Z_2252833": 311,
            "20260903T150659Z_2299688": 311,
            "20260904T070212Z_2912995": 309,
            "20260904T070802Z_2925567": 265,
        }
        missing = [
            run
            for run in cases
            if not (corpus_root / run / "frame2_previous.png").exists()
            or not (corpus_root / run / "frame2_current.png").exists()
        ]
        if missing:
            self.skipTest("local scrolling diagnostic corpus is unavailable")

        for run, expected_shift in cases.items():
            with self.subTest(run=run):
                directory = corpus_root / run
                previous = cv2.imread(str(directory / "frame2_previous.png"))
                current = cv2.imread(str(directory / "frame2_current.png"))
                if expected_shift is None:
                    with self.assertRaises(RuntimeError):
                        scroll_capture._consistent_scroll_shifts([previous, current])
                elif expected_shift == 0:
                    self.assertEqual(
                        estimate_signed_vertical_motion(previous, current)[0],
                        0,
                    )
                else:
                    self.assertEqual(
                        scroll_capture._consistent_scroll_shifts([previous, current]),
                        [expected_shift],
                    )

    def test_saved_repeated_rows_align_without_tesseract(self) -> None:
        corpus_root = ROOT / "skill" / "tmp" / "wosctl_errors"
        cases = {
            "20260903T074412Z_1954499": 275,
            "20260903T150659Z_2299688": 311,
        }
        if any(
            not (corpus_root / run / "frame2_previous.png").exists()
            or not (corpus_root / run / "frame2_current.png").exists()
            for run in cases
        ):
            self.skipTest("local scrolling diagnostic corpus is unavailable")

        with patch.object(
            scroll_capture,
            "_tesseract_text_anchors",
            return_value={},
        ):
            for run, expected_shift in cases.items():
                with self.subTest(run=run):
                    directory = corpus_root / run
                    previous = cv2.imread(str(directory / "frame2_previous.png"))
                    current = cv2.imread(str(directory / "frame2_current.png"))
                    self.assertEqual(
                        scroll_capture._consistent_scroll_shifts([previous, current]),
                        [expected_shift],
                    )

    def test_position_delta_ignores_animation_without_scroll(self) -> None:
        first = self.document[:160].copy()
        second = first.copy()
        second[40:65] = np.clip(
            second[40:65].astype(np.int16) + 8,
            0,
            255,
        ).astype(np.uint8)

        delta = scroll_capture._content_position_delta(first, second, (0, 160))

        self.assertLessEqual(delta, scroll_capture._STABLE_MEAN_THRESHOLD)

    def test_capture_finds_both_ends_and_writes_full_document(self) -> None:
        emulator = FakeScrollingEmulator(
            self.document,
            viewport_height=160,
            initial_offset=100,
            step=100,
            header=self.header,
            footer=self.footer,
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            output = Path(tmpdir) / "full.png"
            result = capture_scrolling_screenshot(
                emulator,
                output,
                max_scrolls=10,
                settle_seconds=0,
            )
            captured = cv2.imread(str(output), cv2.IMREAD_COLOR)

        self.assertTrue(result["top_reached"])
        self.assertTrue(result["bottom_reached"])
        self.assertEqual(result["frame_count"], 4)
        np.testing.assert_array_equal(
            captured,
            np.concatenate([self.header, self.document, self.footer]),
        )

    def test_boundary_detection_ignores_animated_fixed_chrome(self) -> None:
        emulator = AnimatedChromeEmulator(
            self.document,
            viewport_height=160,
            initial_offset=0,
            step=100,
            header=self.header,
            footer=self.footer,
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            result = capture_scrolling_screenshot(
                emulator,
                Path(tmpdir) / "full.png",
                max_scrolls=10,
                content_bounds=(20, 180),
                settle_seconds=0,
            )

        self.assertTrue(result["top_reached"])
        self.assertTrue(result["bottom_reached"])

    def test_swipe_waits_for_elastic_edge_bounce_to_settle(self) -> None:
        original = np.concatenate([self.header, self.document[:160], self.footer])
        bounce_one = np.roll(original, 12, axis=0)
        bounce_two = np.roll(original, 5, axis=0)
        emulator = BounceEmulator(
            [
                bounce_one,
                bounce_two,
                original,
                original,
                original,
                original,
            ]
        )

        with patch("scroll_capture.time.sleep"):
            settled = _swipe(
                emulator,
                original,
                toward_start=True,
                settle_seconds=0.25,
            )

        np.testing.assert_array_equal(settled, original)

    def test_swipe_returns_post_release_frame_without_pressed_highlight(self) -> None:
        clean = np.concatenate([self.header, self.document[:160], self.footer])
        highlighted = clean.copy()
        highlighted[70:120] = np.array([30, 80, 160], dtype=np.uint8)
        emulator = BounceEmulator(
            [
                highlighted,
                highlighted,
                highlighted,
                clean,
            ]
        )

        with patch("scroll_capture.time.sleep") as sleep:
            settled = _swipe(
                emulator,
                clean,
                toward_start=True,
                settle_seconds=0.25,
            )

        self.assertEqual(sleep.call_args_list[-1].args, (0.25,))
        np.testing.assert_array_equal(settled, clean)

    def test_signed_motion_distinguishes_progress_rebound_and_rest(self) -> None:
        def at(offset: int) -> np.ndarray:
            return np.concatenate(
                [
                    self.header,
                    self.document[offset : offset + 160],
                    self.footer,
                ]
            )

        forward, _ = estimate_signed_vertical_motion(
            at(0),
            at(65),
            content_bounds=(20, 180),
        )
        rebound, _ = estimate_signed_vertical_motion(
            at(65),
            at(0),
            content_bounds=(20, 180),
        )
        stationary, _ = estimate_signed_vertical_motion(
            at(0),
            at(0),
            content_bounds=(20, 180),
        )

        self.assertGreater(forward, 0)
        self.assertLess(rebound, 0)
        self.assertEqual(stationary, 0)

    def test_downward_swipe_uses_calibrated_overlap_gesture_and_timing(self) -> None:
        original = np.concatenate([self.header, self.document[:160], self.footer])
        following = np.concatenate([self.header, self.document[100:260], self.footer])
        emulator = BounceEmulator([following])

        with patch("scroll_capture.time.sleep") as sleep:
            captured = _swipe(
                emulator,
                original,
                toward_start=False,
                settle_seconds=0.25,
                wait_until_settled=False,
            )

        self.assertEqual(emulator.swipes, [(40, 144, 40, 112, 1000)])
        sleep.assert_called_once_with(0.2)
        np.testing.assert_array_equal(captured, following)

    def test_bottom_detection_does_not_confuse_repeated_rows_with_no_scroll(
        self,
    ) -> None:
        rng = np.random.default_rng(813)
        document = np.full((380, 80, 3), 120, dtype=np.uint8)
        for y in range(0, len(document), 40):
            document[y : y + 10] = rng.integers(
                0,
                256,
                size=(min(10, len(document) - y), 80, 3),
                dtype=np.uint8,
            )
        emulator = FakeScrollingEmulator(
            document,
            viewport_height=160,
            initial_offset=0,
            step=40,
            header=self.header,
            footer=self.footer,
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            output = Path(tmpdir) / "full.png"
            result = capture_scrolling_screenshot(
                emulator,
                output,
                max_scrolls=12,
                content_bounds=(20, 180),
                settle_seconds=0,
            )
            captured = cv2.imread(str(output), cv2.IMREAD_COLOR)

        self.assertGreater(result["frame_count"], 1)
        np.testing.assert_array_equal(
            captured,
            np.concatenate([self.header, document, self.footer]),
        )

    def test_capture_keeps_settled_frames_and_discards_bottom_bounce(self) -> None:
        def at(offset: int) -> np.ndarray:
            return np.concatenate(
                [
                    self.header,
                    self.document[offset : offset + 160],
                    self.footer,
                ]
            )

        top = at(0)
        bottom = at(220)
        emulator = FakeScrollingEmulator(
            self.document,
            viewport_height=160,
            initial_offset=0,
            step=100,
            header=self.header,
            footer=self.footer,
        )

        with (
            tempfile.TemporaryDirectory() as tmpdir,
            patch.object(
                scroll_capture,
                "_scroll_to_start",
                return_value=(top, 1),
            ),
            patch.object(
                scroll_capture,
                "_capture_until_settled",
                side_effect=[
                    [at(100), at(100), at(100)],
                    [bottom, bottom, bottom],
                    [bottom, bottom, bottom],
                    [bottom, bottom, bottom],
                ],
            ),
            patch(
                "scroll_capture.time.sleep",
            ),
        ):
            output = Path(tmpdir) / "full.png"
            result = capture_scrolling_screenshot(
                emulator,
                output,
                max_scrolls=6,
                content_bounds=(20, 180),
                settle_seconds=0.25,
            )
            captured = cv2.imread(str(output), cv2.IMREAD_COLOR)

        self.assertEqual(result["bottom_swipes"], 4)
        np.testing.assert_array_equal(
            captured,
            np.concatenate([self.header, self.document, self.footer]),
        )


if __name__ == "__main__":
    unittest.main()
