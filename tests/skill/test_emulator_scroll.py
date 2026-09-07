from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[2] / "skill" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from emulator import WosEmulator, WosError


class EmulatorScrollTests(unittest.TestCase):
    def test_mouse_source_precedes_the_wos_display_argument(self) -> None:
        emulator = WosEmulator("test", 2, "test-device", logical_display_id=2)
        with patch(
            "emulator._adb", return_value=subprocess.CompletedProcess([], 0, "", "")
        ) as adb:
            self.assertTrue(emulator.scroll(360, 700, -8.5))

        args = adb.call_args.args
        self.assertEqual(
            args[:7], ("test-device", "shell", "input", "mouse", "-d", "2", "scroll")
        )
        self.assertEqual(args[-2:], ("--axis", "VSCROLL,-8.500"))

    def test_unsupported_scroll_command_allows_touch_fallback(self) -> None:
        emulator = WosEmulator("test", 2, "test-device")
        with patch(
            "emulator._adb",
            return_value=subprocess.CompletedProcess(
                [], 0, "Unknown command: scroll", ""
            ),
        ):
            self.assertFalse(emulator.scroll(360, 700, -3))

    def test_transport_failure_is_not_reported_as_a_successful_scroll(self) -> None:
        emulator = WosEmulator("test", 2, "test-device")
        with (
            patch(
                "emulator._adb",
                return_value=subprocess.CompletedProcess([], 1, "", "device offline"),
            ),
            self.assertRaisesRegex(WosError, "device offline"),
        ):
            emulator.scroll(360, 700, -3)


if __name__ == "__main__":
    unittest.main()
