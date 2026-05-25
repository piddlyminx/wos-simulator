from __future__ import annotations

import sys
import types
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "skill" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

navigation = types.ModuleType("navigation")
navigation.find_template = lambda *_args, **_kwargs: (False, (0, 0))
navigation.goto_city = lambda *_args, **_kwargs: None
navigation.goto_world_map = lambda *_args, **_kwargs: None
navigation.WosNavigationError = RuntimeError
sys.modules.setdefault("navigation", navigation)

from dispatch import _troop_rows_from_ocr_lines


def ocr_line(text: str, x: int, y: int):
    box = [[x - 10, y - 5], [x + 10, y - 5], [x + 10, y + 5], [x - 10, y + 5]]
    return box, text, 0.99


class DispatchTroopRowsTests(unittest.TestCase):
    def test_reconstructs_split_troop_rows_without_partial_matches(self) -> None:
        rows = _troop_rows_from_ocr_lines(
            [
                ocr_line("I", 90, 336),
                ocr_line("Lancer", 240, 281),
                ocr_line("/7,955", 520, 281),
                ocr_line("Elite", 170, 418),
                ocr_line("Marksman", 260, 419),
                ocr_line("/692", 520, 419),
                ocr_line("Heroic", 170, 504),
                ocr_line("Infantry", 280, 504),
                ocr_line("/1,923", 520, 504),
            ],
            y_offset=520,
        )

        self.assertNotIn("I", rows)
        self.assertNotIn("Lancer", rows)
        self.assertLessEqual(abs(rows["Elite Marksman"] - 939), 1)
        self.assertEqual(rows["Heroic Infantry"], 1024)
        self.assertEqual(rows["__avail__939"], 692)
        self.assertEqual(rows["__avail__1024"], 1923)


if __name__ == "__main__":
    unittest.main()
