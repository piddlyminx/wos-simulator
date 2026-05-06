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
        self.assertEqual(params["Det.model_type"], "mobile")
        self.assertEqual(params["Det.ocr_version"], "ppocrv5")
        self.assertEqual(params["Rec.model_type"], "mobile")
        self.assertEqual(params["Rec.ocr_version"], "ppocrv5")

    def test_ocr_call_keeps_classifier_disabled(self) -> None:
        memories = importlib.import_module("memories")
        fake_engine = Mock(return_value=([], 0.01))

        with patch.object(memories, "_get_rapid", return_value=fake_engine):
            strip = np.zeros((20, 60, 3), dtype=np.uint8)
            self.assertEqual(memories._ocr_strip_items(strip), [])

        fake_engine.assert_called_once()
        self.assertEqual(fake_engine.call_args.kwargs["use_cls"], False)

    def test_prepared_label_index_matches_without_renormalizing_labels(self) -> None:
        memories = importlib.import_module("memories")
        labels = {"Crystal Hammer": (100, 200)}
        label_index = memories._prepare_label_index(labels)

        with patch.object(memories, "_normalize_label", side_effect=memories._normalize_label) as normalize:
            match = memories._best_match("CrystalHammer", label_index)

        self.assertEqual(match, ("Crystal Hammer", (100, 200), 1.0))
        normalize.assert_called_once_with("CrystalHammer")


if __name__ == "__main__":
    unittest.main()
