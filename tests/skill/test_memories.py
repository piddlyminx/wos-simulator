from __future__ import annotations

import importlib
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import numpy as np


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "skill" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))


class MemoriesTests(unittest.TestCase):
    def setUp(self) -> None:
        sys.modules.pop("memories", None)

        emulator = types.ModuleType("emulator")
        emulator.adb_screencap_bgr = Mock()
        emulator.adb_tap = Mock()
        sys.modules["emulator"] = emulator

    def tearDown(self) -> None:
        sys.modules.pop("memories", None)

    def test_rapidocr_uses_v5_mobile_and_disables_classifier(self) -> None:
        rapidocr = types.ModuleType("rapidocr")
        rapidocr.EngineType = types.SimpleNamespace(ONNXRUNTIME="onnxruntime")
        rapidocr.LangDet = types.SimpleNamespace(CH="ch")
        rapidocr.LangRec = types.SimpleNamespace(EN="en")
        rapidocr.ModelType = types.SimpleNamespace(MOBILE="mobile")
        rapidocr.OCRVersion = types.SimpleNamespace(PPOCRV5="ppocrv5")

        created: dict[str, object] = {}

        class FakeRapidOCR:
            def __init__(self, *args, **kwargs) -> None:
                created["args"] = args
                created["kwargs"] = kwargs

        ocr = types.ModuleType("ocr")
        ocr.RapidOCR = FakeRapidOCR

        with patch.dict(sys.modules, {"rapidocr": rapidocr, "ocr": ocr}):
            memories = importlib.import_module("memories")
            engine = memories._get_rapid()

        self.assertIsInstance(engine, FakeRapidOCR)
        self.assertEqual(created["kwargs"]["use_angle_cls"], False)
        params = created["kwargs"]["params"]
        self.assertEqual(params["Global.use_cls"], False)
        self.assertEqual(params["Det.use_dilation"], True)
        self.assertEqual(params["Det.model_type"], "mobile")
        self.assertEqual(params["Det.ocr_version"], "ppocrv5")
        self.assertEqual(params["Rec.model_type"], "mobile")
        self.assertEqual(params["Rec.ocr_version"], "ppocrv5")

    def test_tesseract_tsv_items_scale_back_to_strip_coordinates(self) -> None:
        memories = importlib.import_module("memories")
        tsv = "\n".join([
            "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
            "5\t1\t1\t1\t1\t1\t160\t80\t64\t32\t96.5\tStreetlight",
            "5\t1\t1\t1\t1\t2\t240\t80\t64\t32\t94.0\t",
            "4\t1\t1\t1\t1\t0\t160\t80\t64\t32\t-1\tignored",
        ])

        items = memories._ocr_items_from_tesseract_tsv(tsv)

        self.assertEqual(items, [{
            "text": "Streetlight",
            "x": 120,
            "y": 60,
            "conf": 96.5,
        }])

    def test_ocr_preprocess_thresholds_red_channel(self) -> None:
        memories = importlib.import_module("memories")
        crop = np.zeros((1, 2, 3), dtype=np.uint8)
        crop[0, 0, 2] = 161
        crop[0, 1, 2] = 159

        processed = memories._ocr_text(crop)

        self.assertEqual(processed[0, 0], 0)
        self.assertEqual(processed[0, -1], 255)

    def test_team_room_start_visible_detects_purple_start_button(self) -> None:
        memories = importlib.import_module("memories")
        screen = np.zeros((1280, 720, 3), dtype=np.uint8)
        x1, y1, x2, y2 = memories.TEAM_ROOM_START_REGION
        screen[y1:y2, x1:x2] = [245, 120, 220]

        self.assertTrue(memories._team_room_start_visible(screen))

        screen[y1:y2, x1:x2] = [180, 200, 210]
        self.assertFalse(memories._team_room_start_visible(screen))

    def test_solo_start_visible_detects_bottom_right_start_button(self) -> None:
        memories = importlib.import_module("memories")
        screen = np.zeros((1280, 720, 3), dtype=np.uint8)
        x1, y1, x2, y2 = memories.SOLO_START_REGION
        screen[y1:y2, x1:x2] = [245, 120, 220]

        self.assertTrue(memories._solo_start_visible(screen))
        self.assertEqual(memories._visible_start_tap(screen), memories.SOLO_START_TAP)

        screen[y1:y2, x1:x2] = [180, 200, 210]
        self.assertFalse(memories._solo_start_visible(screen))

    def test_solo_start_visible_detects_reference_screenshot_if_available(self) -> None:
        screenshot = Path("/mnt/c/Users/ppamm/Documents/MuMuSharedFolder/Screenshots/MuMu-20260508-184020-280.png")
        if not screenshot.exists():
            self.skipTest("reference MuMu screenshot is not available")

        import cv2

        memories = importlib.import_module("memories")
        screen = cv2.imread(str(screenshot))

        self.assertIsNotNone(screen)
        self.assertTrue(memories._solo_start_visible(screen))
        self.assertEqual(memories._visible_start_tap(screen), memories.SOLO_START_TAP)

    def test_prepared_label_index_matches_without_renormalizing_labels(self) -> None:
        memories = importlib.import_module("memories")
        labels = {"Crystal Hammer": (100, 200)}
        label_index = memories._prepare_label_index(labels)

        with patch.object(memories, "_normalize_label", side_effect=memories._normalize_label) as normalize:
            match = memories._best_match("CrystalHammer", label_index)

        self.assertEqual(match, ("Crystal Hammer", (100, 200), 1.0))
        normalize.assert_called_once_with("CrystalHammer")

    def test_single_character_label_requires_exact_match(self) -> None:
        memories = importlib.import_module("memories")
        label_index = memories._prepare_label_index({
            "M": (10, 20),
            "mop": (30, 40),
        })

        self.assertEqual(memories._best_match("M", label_index), ("M", (10, 20), 1.0))
        self.assertEqual(memories._best_match("Mop", label_index), ("mop", (30, 40), 1.0))
        self.assertIsNone(memories._best_match("A", label_index))
        self.assertIsNone(memories._best_match("Mop", [("M", "m", (10, 20))]))

    def test_tap_worker_records_clicks_after_spaced_taps(self) -> None:
        memories = importlib.import_module("memories")
        clicked: list[dict] = []
        timing = {"tap_sec": 0.0}
        first = {"matched_label": "Key", "coords": (10, 20)}
        second = {"matched_label": "Flag", "coords": (30, 40)}

        with (
            patch.object(memories, "adb_tap") as tap,
            patch.object(memories.time, "sleep") as sleep,
        ):
            worker = memories._TapWorker("serial-1", clicked, timing, memories.time.monotonic())
            worker.submit(first)
            worker.submit(second)
            worker.close()

        self.assertEqual([item["matched_label"] for item in clicked], ["Key", "Flag"])
        self.assertIn("tapped_at_sec", clicked[0])
        self.assertIn("tapped_at_sec", clicked[1])
        self.assertEqual(tap.call_args_list[0].args, ("serial-1", 10, 20))
        self.assertEqual(tap.call_args_list[1].args, ("serial-1", 30, 40))
        self.assertEqual(sleep.call_count, 2)
        self.assertGreaterEqual(timing["tap_sec"], 0.0)

    def test_tap_worker_tracks_pending_labels_until_tap_finishes(self) -> None:
        memories = importlib.import_module("memories")
        clicked: list[dict] = []
        timing = {"tap_sec": 0.0}
        started = memories.time.monotonic()
        tap_started = memories.threading.Event()
        release_tap = memories.threading.Event()

        def block_tap(*args) -> None:
            tap_started.set()
            release_tap.wait(timeout=2)

        with (
            patch.object(memories, "adb_tap", side_effect=block_tap),
            patch.object(memories.time, "sleep"),
        ):
            worker = memories._TapWorker("serial-1", clicked, timing, started)
            worker.submit({"matched_label": "Key", "coords": (10, 20)})
            self.assertTrue(tap_started.wait(timeout=2))
            self.assertTrue(worker.is_pending("Key"))
            release_tap.set()
            worker.close()

        self.assertFalse(worker.is_pending("Key"))
        self.assertEqual([item["matched_label"] for item in clicked], ["Key"])


if __name__ == "__main__":
    unittest.main()
