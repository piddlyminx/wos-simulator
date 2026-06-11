"""Regression tests for dashboard.check_now."""

import json
import tempfile
import unittest
from pathlib import Path

import dashboard.check_now as check_now
from dashboard.ingest import open_db


class TestCheckNow(unittest.TestCase):
    def test_ingests_specific_report_path(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            temp = Path(temp_dir)
            report_dir = temp / "reports"
            report_dir.mkdir()
            db_path = temp / "dashboard.sqlite"
            report_path = report_dir / "simulator_parity_current.json"
            report_path.write_text(
                json.dumps(
                    {
                        "createdAt": "2026-06-10T01:00:00.000Z",
                        "testcases": {
                            "testcases/current.json#0": {
                                "file": "testcases/current.json",
                                "testcase_id": "current",
                                "idx": 0,
                                "game": {
                                    "n_candidate": 1,
                                    "mu_candidate": 10,
                                    "n_reference": 1,
                                    "mu_reference": 10,
                                    "bias_pct": 0,
                                    "stat_type": "deterministic",
                                    "stat": None,
                                    "q": None,
                                    "passes": True,
                                },
                            }
                        },
                    }
                ),
                encoding="utf-8",
            )

            original_db_path = check_now.DB_PATH
            try:
                check_now.DB_PATH = db_path
                run = check_now.ingest_report(report_path, temp)
            finally:
                check_now.DB_PATH = original_db_path

            self.assertIsNotNone(run)
            self.assertEqual(run["started_at"], "2026-06-10T01:00:00.000Z")
            self.assertEqual(run["passing"], 1)

            conn = open_db(db_path)
            try:
                count = conn.execute("SELECT COUNT(*) FROM runs").fetchone()[0]
            finally:
                conn.close()

            self.assertEqual(count, 1)


if __name__ == "__main__":
    unittest.main()
