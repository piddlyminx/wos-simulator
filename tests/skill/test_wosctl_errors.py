from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import os
import shutil
import sys
import types
import unittest
from importlib.machinery import SourceFileLoader
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
WOSCTL = ROOT / "skill" / "scripts" / "wosctl"


def _install_wosctl_import_stubs() -> list[str]:
    modules: dict[str, types.ModuleType] = {}

    logging_setup = types.ModuleType("logging_setup")
    logging_setup.add_stderr_logging = lambda: None
    logging_setup.configure_daily_file_logging = lambda *_args, **_kwargs: None
    modules["logging_setup"] = logging_setup

    emulator = types.ModuleType("emulator")

    class WosError(Exception):
        pass

    class WosEmulator:
        pass

    emulator.WosError = WosError
    emulator.WosEmulator = WosEmulator
    emulator.adb_ping = lambda *_args, **_kwargs: (False, False, None)
    emulator.is_instance_disabled = lambda *_args, **_kwargs: False
    emulator.list_instances = lambda: []
    emulator.wos_is_foreground = lambda *_args, **_kwargs: False
    emulator.resolve_instance = lambda *_args, **_kwargs: WosEmulator()
    modules["emulator"] = emulator

    navigation = types.ModuleType("navigation")

    class WosReconnectError(WosError):
        pass

    class WosNavigationError(WosError):
        pass

    navigation.get_screen_state = lambda *_args, **_kwargs: "unknown"
    navigation.goto_city = lambda *_args, **_kwargs: None
    navigation.goto_world_map = lambda *_args, **_kwargs: None
    navigation.goto_coord = lambda *_args, **_kwargs: None
    navigation.goto_pets = lambda *_args, **_kwargs: None
    navigation.goto_beast_cage = lambda *_args, **_kwargs: None
    navigation.goto_pet = lambda *_args, **_kwargs: None
    navigation.goto_pet_refine = lambda *_args, **_kwargs: None
    navigation.WosReconnectError = WosReconnectError
    navigation.WosNavigationError = WosNavigationError
    modules["navigation"] = navigation

    dispatch = types.ModuleType("dispatch")

    class WosDispatchError(WosError):
        pass

    dispatch.recall_camp = lambda *_args, **_kwargs: None
    dispatch.WosDispatchError = WosDispatchError
    dispatch.TROOP_DISPLAY_NAMES = {}
    modules["dispatch"] = dispatch

    heal = types.ModuleType("heal")

    class WosHealError(WosError):
        pass

    heal.heal_troops = lambda *_args, **_kwargs: {}
    heal.WosHealError = WosHealError
    modules["heal"] = heal

    alliance = types.ModuleType("alliance")

    class WosAllianceError(WosError):
        pass

    alliance.ensure_in_alliance = lambda *_args, **_kwargs: None
    alliance.get_current_alliance_tag = lambda *_args, **_kwargs: None
    alliance.WosAllianceError = WosAllianceError
    modules["alliance"] = alliance

    installed: list[str] = []
    for name, module in modules.items():
        if name not in sys.modules:
            sys.modules[name] = module
            installed.append(name)
    return installed


class WosctlErrorHandlingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._old_bootstrap = os.environ.get("WOSCTL_UV_BOOTSTRAPPED")
        os.environ["WOSCTL_UV_BOOTSTRAPPED"] = "1"
        cls._installed_stubs = _install_wosctl_import_stubs()
        loader = SourceFileLoader("wosctl_for_tests", str(WOSCTL))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        if spec is None:
            raise RuntimeError("could not load wosctl test module spec")
        module = importlib.util.module_from_spec(spec)
        sys.modules[loader.name] = module
        loader.exec_module(module)
        cls.wosctl = module

    @classmethod
    def tearDownClass(cls) -> None:
        for name in cls._installed_stubs:
            sys.modules.pop(name, None)
        if cls._old_bootstrap is None:
            os.environ.pop("WOSCTL_UV_BOOTSTRAPPED", None)
        else:
            os.environ["WOSCTL_UV_BOOTSTRAPPED"] = cls._old_bootstrap

    def test_cli_main_returns_json_for_unhandled_exception(self) -> None:
        stdout = io.StringIO()
        with patch.object(self.wosctl, "main", side_effect=RuntimeError("boom")), \
                patch.object(self.wosctl.logger, "error") as log_error, \
                patch.object(
                    self.wosctl,
                    "_exception_diagnostics_or_error",
                    return_value={"diagnostic_path": "/tmp/wosctl-test/exception.json"},
                ), \
                contextlib.redirect_stdout(stdout):
            exit_code = self.wosctl.cli_main()

        self.assertEqual(exit_code, 1)
        payload = json.loads(stdout.getvalue())
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["error_type"], "internal_error")
        self.assertEqual(payload["error"], "Unexpected error: boom")
        self.assertEqual(payload["diagnostic_path"], "/tmp/wosctl-test/exception.json")
        self.assertTrue(log_error.called)

    def test_cli_main_returns_json_for_keyboard_interrupt(self) -> None:
        stdout = io.StringIO()
        with patch.object(self.wosctl, "main", side_effect=KeyboardInterrupt), \
                contextlib.redirect_stdout(stdout):
            exit_code = self.wosctl.cli_main()

        self.assertEqual(exit_code, 130)
        payload = json.loads(stdout.getvalue())
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["error_type"], "interrupted")

    def test_exception_diagnostics_include_traceback_locals_and_emulator_screenshot(self) -> None:
        class FakeEmulator:
            def screencap(self, path: str) -> None:
                Path(path).write_bytes(b"fake png")

        def raise_with_locals() -> None:
            emulator = FakeEmulator()
            local_marker = "visible in diagnostics"
            raise RuntimeError(f"boom: {local_marker}")

        try:
            raise_with_locals()
        except RuntimeError as exc:
            diagnostics = self.wosctl._write_exception_diagnostics(exc)

        debug_dir = Path(diagnostics["debug_dir"])
        try:
            diagnostic_path = Path(diagnostics["diagnostic_path"])
            payload = json.loads(diagnostic_path.read_text())
            self.assertEqual(payload["error_type"], "RuntimeError")
            self.assertIn("boom: visible in diagnostics", payload["traceback"])
            self.assertTrue(
                any(
                    frame["locals"].get("local_marker") == "'visible in diagnostics'"
                    for frame in payload["frames"]
                )
            )
            screenshot_path = debug_dir / "emulator_screenshot.png"
            self.assertTrue(screenshot_path.exists())
            self.assertIn(str(screenshot_path), payload["saved_images"])
        finally:
            shutil.rmtree(debug_dir, ignore_errors=True)

    def test_run_testcase_repeat_failure_includes_diagnostics(self) -> None:
        @contextlib.contextmanager
        def unlocked() -> object:
            yield

        fake_run_testcase = types.ModuleType("run_testcase")

        def fail_run_testcase(*_args: object, **_kwargs: object) -> None:
            raise RuntimeError("Deploy: template not found")

        fake_run_testcase.run_testcase = fail_run_testcase
        old_module = sys.modules.get("run_testcase")
        sys.modules["run_testcase"] = fake_run_testcase
        stdout = io.StringIO()

        try:
            with patch.object(self.wosctl, "testcase_instance_names", return_value=[]), \
                    patch.object(self.wosctl, "lock_instances", return_value=unlocked()), \
                    patch.object(
                        self.wosctl,
                        "_exception_diagnostics_or_error",
                        return_value={"diagnostic_path": "/tmp/wosctl-test/repeat-exception.json"},
                    ), \
                    patch.object(self.wosctl.logger, "error") as log_error, \
                    contextlib.redirect_stdout(stdout):
                exit_code = self.wosctl.cmd_run_testcase("spec.json", repeat=3)
        finally:
            if old_module is None:
                sys.modules.pop("run_testcase", None)
            else:
                sys.modules["run_testcase"] = old_module

        self.assertEqual(exit_code, 1)
        payload = json.loads(stdout.getvalue())
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["command"], "run-testcase")
        self.assertEqual(payload["repeat"], 3)
        self.assertEqual(payload["completed"], 0)
        self.assertEqual(payload["error"], "Deploy: template not found")
        self.assertEqual(payload["diagnostic_path"], "/tmp/wosctl-test/repeat-exception.json")
        self.assertTrue(log_error.called)


if __name__ == "__main__":
    unittest.main()
