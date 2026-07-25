from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import os
import shutil
import sys
import tempfile
import types
import unittest
from importlib.machinery import SourceFileLoader
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
WOSCTL = ROOT / "skill" / "scripts" / "wosctl"


def _install_wosctl_import_stubs() -> dict[str, types.ModuleType | None]:
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

    previous: dict[str, types.ModuleType | None] = {}
    for name, module in modules.items():
        previous[name] = sys.modules.get(name)
        sys.modules[name] = module
    return previous


class WosctlErrorHandlingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._old_bootstrap = os.environ.get("WOSCTL_UV_BOOTSTRAPPED")
        os.environ["WOSCTL_UV_BOOTSTRAPPED"] = "1"
        cls._previous_stubbed_modules = _install_wosctl_import_stubs()
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
        for name, module in cls._previous_stubbed_modules.items():
            if module is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = module
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

    def test_run_testcase_repeat_uses_save_then_load_presets(self) -> None:
        @contextlib.contextmanager
        def unlocked() -> object:
            yield

        fake_run_testcase = types.ModuleType("run_testcase")
        preset_modes: list[str | None] = []
        preferred_coords: list[dict[str, int] | None] = []

        def fake_run_testcase_func(
            spec: str,
            dry_run: bool = False,
            debug: bool = False,
            preset_mode: str | None = None,
            preferred_world_coord: dict[str, int] | None = None,
        ) -> dict:
            preset_modes.append(preset_mode)
            preferred_coords.append(preferred_world_coord)
            return {
                "ok": True,
                "spec": spec,
                "dry_run": dry_run,
                "debug": debug,
                "world_coord": preferred_world_coord or {"x": 700, "y": 500},
            }

        fake_run_testcase.run_testcase = fake_run_testcase_func
        old_module = sys.modules.get("run_testcase")
        sys.modules["run_testcase"] = fake_run_testcase
        stdout = io.StringIO()

        try:
            with patch.object(self.wosctl, "testcase_instance_names", return_value=["WIP", "minxxx"]), \
                    patch.object(self.wosctl, "lock_instances", return_value=unlocked()) as lock_instances, \
                    contextlib.redirect_stdout(stdout):
                exit_code = self.wosctl.cmd_run_testcase("spec.json", dry_run=True, repeat=3, debug=True)
        finally:
            if old_module is None:
                sys.modules.pop("run_testcase", None)
            else:
                sys.modules["run_testcase"] = old_module

        self.assertEqual(exit_code, 0)
        self.assertEqual(preset_modes, ["save", "load", "load"])
        self.assertEqual(
            preferred_coords,
            [None, {"x": 700, "y": 500}, {"x": 700, "y": 500}],
        )
        lock_instances.assert_called_once()
        self.assertEqual(lock_instances.call_args.args[0], ["WIP", "minxxx"])

        payload = json.loads(stdout.getvalue())
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["repeat"], 3)
        self.assertEqual(payload["completed"], 3)
        self.assertEqual([result["run_number"] for result in payload["results"]], [1, 2, 3])

    def test_run_battle_repeat_uses_presets_without_capturing_reports(self) -> None:
        @contextlib.contextmanager
        def unlocked() -> object:
            yield

        fake_run_testcase = types.ModuleType("run_testcase")
        calls: list[tuple[str | None, dict[str, int] | None]] = []

        def fake_run_battle(
            _spec: str,
            dry_run: bool = False,
            preset_mode: str | None = None,
            preferred_world_coord: dict[str, int] | None = None,
        ) -> dict:
            calls.append((preset_mode, preferred_world_coord))
            return {
                "ok": True,
                "dry_run": dry_run,
                "world_coord": preferred_world_coord or {"x": 701, "y": 501},
                "report_timestamp": 1234 + len(calls),
            }

        fake_run_testcase.run_battle = fake_run_battle
        old_module = sys.modules.get("run_testcase")
        sys.modules["run_testcase"] = fake_run_testcase
        stdout = io.StringIO()

        try:
            with patch.object(self.wosctl, "testcase_instance_names", return_value=["WIP", "minxxx"]), \
                    patch.object(self.wosctl, "lock_instances", return_value=unlocked()), \
                    contextlib.redirect_stdout(stdout):
                exit_code = self.wosctl.cmd_run_battle("spec.json", repeat=3)
        finally:
            if old_module is None:
                sys.modules.pop("run_testcase", None)
            else:
                sys.modules["run_testcase"] = old_module

        self.assertEqual(exit_code, 0)
        self.assertEqual(calls, [
            ("save", None),
            ("load", {"x": 701, "y": 501}),
            ("load", {"x": 701, "y": 501}),
        ])
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["command"], "run-battle")
        self.assertEqual(payload["completed"], 3)

    def test_create_testcase_consumes_saved_report_json(self) -> None:
        @contextlib.contextmanager
        def unlocked() -> object:
            yield

        fake_report_reader = types.ModuleType("report_reader")
        fake_report_reader.normalize_mail_tab = lambda tab: tab
        fake_run_testcase = types.ModuleType("run_testcase")
        received: list[tuple[str, dict]] = []

        def create_from_report(spec: str, report: dict) -> dict:
            received.append((spec, report))
            return {"ok": True, "saved_to": "/tmp/testcase.json"}

        fake_run_testcase.create_testcase_from_report = create_from_report
        fake_run_testcase.capture_existing_report = lambda *_args, **_kwargs: None
        old_report_reader = sys.modules.get("report_reader")
        old_run_testcase = sys.modules.get("run_testcase")
        sys.modules["report_reader"] = fake_report_reader
        sys.modules["run_testcase"] = fake_run_testcase
        stdout = io.StringIO()

        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                report_path = Path(tmpdir) / "report.json"
                report_path.write_text(json.dumps({"result": "victory"}))
                with patch.object(self.wosctl, "testcase_instance_names", return_value=["WIP", "minxxx"]), \
                        patch.object(self.wosctl, "lock_instances", return_value=unlocked()) as lock_instances, \
                        contextlib.redirect_stdout(stdout):
                    exit_code = self.wosctl.cmd_create_testcase(
                        "spec.json",
                        report_path=str(report_path),
                    )
        finally:
            if old_report_reader is None:
                sys.modules.pop("report_reader", None)
            else:
                sys.modules["report_reader"] = old_report_reader
            if old_run_testcase is None:
                sys.modules.pop("run_testcase", None)
            else:
                sys.modules["run_testcase"] = old_run_testcase

        self.assertEqual(exit_code, 0)
        self.assertEqual(received, [("spec.json", {"result": "victory"})])
        lock_instances.assert_not_called()
        payload = json.loads(stdout.getvalue())
        self.assertTrue(payload["ok"])
        self.assertTrue(payload["report_source"].endswith("report.json"))

    def test_create_testcase_can_capture_existing_inbox_report(self) -> None:
        @contextlib.contextmanager
        def unlocked() -> object:
            yield

        fake_report_reader = types.ModuleType("report_reader")
        fake_report_reader.normalize_mail_tab = lambda tab: "starred" if tab == "star" else tab
        fake_run_testcase = types.ModuleType("run_testcase")
        received: list[tuple[str, str, int, bool]] = []
        captured_report = {"result": "victory"}

        def capture_existing(
            spec: str,
            *,
            tab: str,
            index: int,
            debug: bool,
        ) -> dict:
            received.append((spec, tab, index, debug))
            return captured_report

        fake_run_testcase.capture_existing_report = capture_existing
        fake_run_testcase.create_testcase_from_report = (
            lambda _spec, report: {
                "ok": report is captured_report,
                "saved_to": "/tmp/testcase.json",
            }
        )
        old_report_reader = sys.modules.get("report_reader")
        old_run_testcase = sys.modules.get("run_testcase")
        sys.modules["report_reader"] = fake_report_reader
        sys.modules["run_testcase"] = fake_run_testcase
        stdout = io.StringIO()

        try:
            with patch.object(self.wosctl, "testcase_instance_names", return_value=["WIP", "minxxx"]), \
                    patch.object(self.wosctl, "lock_instances", return_value=unlocked()), \
                    contextlib.redirect_stdout(stdout):
                exit_code = self.wosctl.cmd_create_testcase(
                    "spec.json",
                    tab="star",
                    index=3,
                    debug=True,
                )
        finally:
            if old_report_reader is None:
                sys.modules.pop("report_reader", None)
            else:
                sys.modules["report_reader"] = old_report_reader
            if old_run_testcase is None:
                sys.modules.pop("run_testcase", None)
            else:
                sys.modules["run_testcase"] = old_run_testcase

        self.assertEqual(exit_code, 0)
        self.assertEqual(received, [("spec.json", "starred", 3, True)])
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["report_source"], {"tab": "starred", "index": 3})

    def test_create_testcase_can_parse_saved_images_without_emulator_lock(self) -> None:
        fake_report_reader = types.ModuleType("report_reader")
        parsed_report = {"result": "victory"}
        fake_report_reader.normalize_mail_tab = lambda tab: tab
        fake_report_reader.parse_saved_report_images = lambda path, debug=False: {
            **parsed_report,
            "image_dir": path,
            "debug": debug,
        }
        fake_run_testcase = types.ModuleType("run_testcase")
        received: list[dict] = []

        def create_from_report(_spec: str, report: dict) -> dict:
            received.append(report)
            return {"ok": True, "saved_to": "/tmp/testcase.json"}

        fake_run_testcase.create_testcase_from_report = create_from_report
        fake_run_testcase.capture_existing_report = lambda *_args, **_kwargs: None
        old_report_reader = sys.modules.get("report_reader")
        old_run_testcase = sys.modules.get("run_testcase")
        sys.modules["report_reader"] = fake_report_reader
        sys.modules["run_testcase"] = fake_run_testcase
        stdout = io.StringIO()

        try:
            with patch.object(self.wosctl, "testcase_instance_names", return_value=["WIP", "minxxx"]), \
                    patch.object(self.wosctl, "lock_instances") as lock_instances, \
                    contextlib.redirect_stdout(stdout):
                exit_code = self.wosctl.cmd_create_testcase(
                    "spec.json",
                    image_dir="/tmp/saved-images",
                    debug=True,
                )
        finally:
            if old_report_reader is None:
                sys.modules.pop("report_reader", None)
            else:
                sys.modules["report_reader"] = old_report_reader
            if old_run_testcase is None:
                sys.modules.pop("run_testcase", None)
            else:
                sys.modules["run_testcase"] = old_run_testcase

        self.assertEqual(exit_code, 0)
        lock_instances.assert_not_called()
        self.assertEqual(received, [{
            "result": "victory",
            "image_dir": "/tmp/saved-images",
            "debug": True,
        }])
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["report_source"], {"images": "/tmp/saved-images"})

    def test_report_output_saves_reusable_parsed_json(self) -> None:
        fake_report_reader = types.ModuleType("report_reader")
        parsed_report = {"result": "victory", "left": {}, "right": {}}
        fake_report_reader.normalize_mail_tab = lambda tab: tab
        fake_report_reader.read_battle_report = lambda *_args, **_kwargs: parsed_report

        def save_report(report: dict, path: Path) -> Path:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(report))
            return path

        fake_report_reader._save_report_json = save_report
        old_report_reader = sys.modules.get("report_reader")
        sys.modules["report_reader"] = fake_report_reader
        stdout = io.StringIO()

        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                output_path = Path(tmpdir) / "captured" / "report.json"
                with contextlib.redirect_stdout(stdout):
                    exit_code = self.wosctl.cmd_report(
                        "WIP",
                        "war",
                        1,
                        output=str(output_path),
                    )
                saved = json.loads(output_path.read_text())
        finally:
            if old_report_reader is None:
                sys.modules.pop("report_reader", None)
            else:
                sys.modules["report_reader"] = old_report_reader

        self.assertEqual(exit_code, 0)
        self.assertEqual(saved, parsed_report)
        response = json.loads(stdout.getvalue())
        self.assertEqual(response["result"], "victory")
        self.assertTrue(response["saved_to"].endswith("report.json"))


if __name__ == "__main__":
    unittest.main()
