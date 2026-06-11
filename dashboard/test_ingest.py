"""Regression tests for dashboard.ingest."""

import unittest
from pathlib import Path

from dashboard.ingest import open_db, record_run

REPO_ROOT = Path(__file__).parent.parent


class TestRecordRun(unittest.TestCase):
    def test_current_parity_summary_game_metrics_are_flattened(self):
        conn = open_db(":memory:")
        try:
            run_doc = {
                "createdAt": "2026-06-10T00:00:00.000Z",
                "options": {"repeat": 100},
                "counts": {"executed": 1},
                "testcases": {
                    "testcases/example.json#0": {
                        "file": "testcases/example.json",
                        "testcase_id": "example",
                        "idx": 0,
                        "game": {
                            "n_candidate": 100,
                            "mu_candidate": 88.98,
                            "n_reference": 4,
                            "mu_reference": 98.5,
                            "bias_pct": -0.58,
                            "stat_type": "t",
                            "stat": -3.14,
                            "q": 0.025898,
                            "passes": False,
                        },
                        "gameStatAdjustment": {
                            "value": 0.05,
                            "mode": "deterministic_exact",
                            "unadjusted": {
                                "n_candidate": 1,
                                "mu_candidate": 505,
                                "n_reference": 1,
                                "mu_reference": 507,
                                "bias_pct": -0.11,
                                "stat_type": "deterministic",
                                "stat": None,
                                "q": None,
                                "passes": False,
                            },
                        },
                    }
                },
            }

            run_id = record_run(run_doc, REPO_ROOT, conn=conn)

            row = conn.execute(
                """
                SELECT started_at, finished_at, n_sim, n_game, mu_sim, mu_game,
                       bias_pct, t, q, passes, stat_type,
                       stat_adjustment_value, stat_adjustment_mode,
                       stat_adjustment_unadjusted_json
                FROM runs JOIN run_testcases ON runs.id = run_testcases.run_id
                WHERE runs.id = ?
                """,
                (run_id,),
            ).fetchone()
        finally:
            conn.close()

        self.assertIsNotNone(row)
        self.assertEqual(row[0], "2026-06-10T00:00:00.000Z")
        self.assertEqual(row[1], "2026-06-10T00:00:00.000Z")
        self.assertEqual(row[2], 100)
        self.assertEqual(row[3], 4)
        self.assertEqual(row[4], 88.98)
        self.assertEqual(row[5], 98.5)
        self.assertEqual(row[6], -0.58)
        self.assertEqual(row[7], -3.14)
        self.assertEqual(row[8], 0.025898)
        self.assertEqual(row[9], 0)
        self.assertEqual(row[10], "t")
        self.assertEqual(row[11], 0.05)
        self.assertEqual(row[12], "deterministic_exact")
        self.assertIn('"mu_candidate": 505', row[13])


if __name__ == "__main__":
    unittest.main()
