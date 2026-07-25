from __future__ import annotations

import sys
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "skill" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import run_testcase


class RunTestcaseStatsTests(unittest.TestCase):
    def test_map_stats_rejects_empty_stat_bonuses(self) -> None:
        with self.assertRaisesRegex(ValueError, "stat_bonuses empty for attacker"):
            run_testcase._map_stats({}, side="attacker")

    def test_map_stats_rejects_missing_stat_bonuses_value(self) -> None:
        with self.assertRaisesRegex(ValueError, "stats OCR produced no output"):
            run_testcase._map_stats(None, side="defender")

    def test_explicit_spec_hero_skills_keep_saved_image_flow_offline(self) -> None:
        explicit = {"Gatot": {"skill_1": 3, "skill_2": 2, "skill_3": 1}}
        with patch.object(run_testcase, "_enrich_heroes") as enrich:
            resolved = run_testcase._resolve_report_heroes(
                ["Gatot", "Vacant"],
                explicit,
                "external-account",
                "Attacker",
            )

        self.assertEqual(resolved, explicit)
        enrich.assert_not_called()

    def test_unexpected_report_hero_fails_before_live_enrichment(self) -> None:
        with patch.object(run_testcase, "_enrich_heroes") as enrich:
            with self.assertRaisesRegex(RuntimeError, "unexpected on report"):
                run_testcase._resolve_report_heroes(
                    ["Gatot"],
                    {},
                    "external-account",
                    "Attacker",
                )

        enrich.assert_not_called()


class CreateTestcaseFromReportTests(unittest.TestCase):
    def _write_spec(self, root: Path) -> Path:
        spec_path = root / "spec.json"
        spec_path.write_text(json.dumps({
            "test_id": "captured_report_case",
            "description": "materialized from an existing report",
            "emulator": {
                "attacker": {"instance": "WIP"},
                "defender": {"instance": "minxxx"},
            },
            "attacker": {"heroes": {}, "troops": {"infantry_t6": 100}},
            "defender": {"heroes": {}, "troops": {"lancer_t6": 80}},
        }))
        return spec_path

    def _report(self) -> dict:
        stats = {
            "infantry_attack": 1.0,
            "lancer_attack": 2.0,
            "marksman_attack": 3.0,
        }
        return {
            "result": "victory",
            "left": {
                "role": "attacker",
                "name": "Attacker",
                "survivors": 70,
                "heroes": [],
                "stat_bonuses": stats,
                "troops_detail": [{"type": "infantry", "tier": 6, "count": 100}],
            },
            "right": {
                "role": "defender",
                "name": "Defender",
                "survivors": 20,
                "heroes": [],
                "stat_bonuses": stats,
                "troops_detail": [{"type": "lancer", "tier": 6, "count": 80}],
            },
        }

    def test_materializes_saved_report_without_running_battle(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            spec_path = self._write_spec(root)
            output_dir = root / "testcases"

            with patch.object(run_testcase, "_TESTCASES", output_dir), \
                    patch.object(run_testcase, "_enrich_heroes", return_value={}):
                result = run_testcase.create_testcase_from_report(
                    str(spec_path),
                    self._report(),
                )

            self.assertTrue(result["ok"])
            saved = json.loads((output_dir / "captured_report_case.json").read_text())
            self.assertEqual(len(saved), 1)
            self.assertEqual(saved[0]["attacker"]["troops"], {"infantry_t6": 100})
            self.assertEqual(saved[0]["defender"]["troops"], {"lancer_t6": 80})
            self.assertEqual(
                saved[0]["game_report_result"],
                [{"attacker": 70, "defender": 20}],
            )

    def test_rejects_mismatched_report_troops_without_writing_testcase(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            spec_path = self._write_spec(root)
            output_dir = root / "testcases"
            report = self._report()
            report["left"]["troops_detail"][0]["count"] = 99

            with patch.object(run_testcase, "_TESTCASES", output_dir), \
                    patch.object(run_testcase, "_enrich_heroes", return_value={}):
                with self.assertRaisesRegex(RuntimeError, "Troop count mismatch"):
                    run_testcase.create_testcase_from_report(str(spec_path), report)

            self.assertFalse((output_dir / "captured_report_case.json").exists())

    def test_rejects_report_without_one_attacker_and_one_defender(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            spec_path = self._write_spec(root)
            report = self._report()
            report["right"]["role"] = "attacker"

            with self.assertRaisesRegex(RuntimeError, "one attacker and one defender"):
                run_testcase.create_testcase_from_report(str(spec_path), report)

    def test_rejects_report_with_missing_survivor_result(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            spec_path = self._write_spec(root)
            report = self._report()
            del report["left"]["survivors"]

            with self.assertRaisesRegex(RuntimeError, "missing attacker survivors"):
                run_testcase.create_testcase_from_report(str(spec_path), report)


class TestcaseOperationCompositionTests(unittest.TestCase):
    def _execution(self, spec_path: str) -> run_testcase.BattleExecution:
        return run_testcase.BattleExecution(
            spec_path=spec_path,
            spec={"test_id": "split_case"},
            attacker_instance="WIP",
            defender_instance="minxxx",
            attacker_emulator=object(),
            defender_emulator=object(),
            world_coord={"x": 700, "y": 500},
            report_timestamp=1234.0,
        )

    def test_run_battle_does_not_capture_or_materialize_report(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            spec_path = Path(tmpdir) / "spec.json"
            spec_path.write_text(json.dumps({"test_id": "split_case"}))
            execution = self._execution(str(spec_path))

            with patch.object(run_testcase, "execute_battle", return_value=execution), \
                    patch.object(run_testcase, "_recall_after_battle") as recall, \
                    patch.object(run_testcase, "_capture_war_report") as capture, \
                    patch.object(run_testcase, "create_testcase_from_report") as materialize:
                result = run_testcase.run_battle(str(spec_path))

            recall.assert_called_once_with(execution)
            capture.assert_not_called()
            materialize.assert_not_called()
            self.assertEqual(result["report_timestamp"], 1234.0)
            self.assertEqual(result["report"], {"instance": "WIP", "tab": "war", "index": 1})

    def test_run_testcase_composes_capture_before_materialization(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            spec_path = Path(tmpdir) / "spec.json"
            spec_path.write_text(json.dumps({"test_id": "split_case"}))
            execution = self._execution(str(spec_path))
            parsed_report = {"result": "victory"}

            with patch.object(run_testcase, "execute_battle", return_value=execution), \
                    patch.object(run_testcase, "_capture_war_report", return_value=parsed_report) as capture, \
                    patch.object(run_testcase, "_recall_after_battle") as recall, \
                    patch.object(
                        run_testcase,
                        "create_testcase_from_report",
                        return_value={"ok": True},
                    ) as materialize:
                result = run_testcase.run_testcase(str(spec_path), debug=True)

            capture.assert_called_once_with(execution.attacker_emulator, debug=True, inbox_open=True)
            recall.assert_called_once_with(execution)
            materialize.assert_called_once_with(
                str(spec_path),
                parsed_report,
                world_coord={"x": 700, "y": 500},
            )
            self.assertEqual(result, {"ok": True})

    def test_run_testcase_recalls_armies_when_capture_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            spec_path = Path(tmpdir) / "spec.json"
            spec_path.write_text(json.dumps({"test_id": "split_case"}))
            execution = self._execution(str(spec_path))

            with patch.object(run_testcase, "execute_battle", return_value=execution), \
                    patch.object(run_testcase, "_capture_war_report", side_effect=RuntimeError("OCR failed")), \
                    patch.object(run_testcase, "_recall_after_battle") as recall:
                with self.assertRaisesRegex(RuntimeError, "OCR failed"):
                    run_testcase.run_testcase(str(spec_path))

            recall.assert_called_once_with(execution)


if __name__ == "__main__":
    unittest.main()
