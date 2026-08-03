"""Regression tests for dashboard.coverage — WOS-165."""

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from dashboard.ingest import open_db
from dashboard.coverage import snapshot_coverage, _active_testcase_files, _load_hero_skills

REPO_ROOT = Path(__file__).parent.parent

TIER1_HEROES = {
    "Gwen", "Hector", "Norah", "Mia", "Lynn", "Logan",
    "Reina", "Greg", "Alonso", "Philly", "Flint", "Zinman", "Molly",
}

FAKE_RUN_ID = "00000000-0000-0000-0000-000000000001"


class TestSnapshotCoverage(unittest.TestCase):

    def test_active_testcases_are_discovered_recursively(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            nested = repo_root / "testcases" / "gatot_verified"
            nested.mkdir(parents=True)
            active = nested / "gatot.json"
            active.write_text("[]")
            (nested / "gatot.json.disabled").write_text("[]")

            self.assertEqual(_active_testcase_files(repo_root), [active])

    def test_coverage_counts_testcases_per_skill(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            hero_dir = repo_root / "simulator" / "config" / "hero_definitions"
            hero_dir.mkdir(parents=True)
            (hero_dir / "TestHero.json").write_text(json.dumps({
                "skills": {
                    "one": {"name": "One"},
                    "two": {"name": "Two"},
                    "three": {"name": "Three"},
                }
            }))
            testcase_dir = repo_root / "testcases" / "nested"
            testcase_dir.mkdir(parents=True)
            (testcase_dir / "cases.json").write_text(json.dumps([
                {
                    "attacker": {"heroes": {"TestHero": {"skill_1": 1, "skill_3": 1}}},
                    "defender": {"heroes": {}},
                    "game_report_result": [{"attacker": 1, "defender": 0}],
                },
                {
                    "attacker": {"heroes": {"TestHero": {"skill_1": 1}}},
                    "defender": {"heroes": {}},
                    "game_report_result": [
                        {"attacker": 1, "defender": 0},
                        {"attacker": 1, "defender": 0},
                    ],
                },
            ]))

            snapshot_coverage(FAKE_RUN_ID, self.conn, repo_root)
            rows = self.conn.execute(
                """
                SELECT skill_num, testcase_count, battle_outcome_count, covered_bool
                FROM coverage_snapshots
                WHERE run_id = ? AND hero = 'TestHero'
                ORDER BY skill_num
                """,
                (FAKE_RUN_ID,),
            ).fetchall()
            self.assertEqual(rows, [
                (1, 2, 3, 1),
                (2, 0, 0, 0),
                (3, 1, 1, 1),
            ])

    def setUp(self):
        self.conn = open_db(":memory:")
        self.conn.execute(
            """
            INSERT INTO runs (
                id, finished_at, git_sha, dirty,
                cli_args_json, thresholds_json, summary_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (FAKE_RUN_ID, "2026-01-01T00:00:00", "abc123", 0, "{}", "{}", "{}"),
        )
        self.conn.commit()

    def tearDown(self):
        self.conn.close()

    def test_row_count_matches_hero_skills(self):
        skills = _load_hero_skills(REPO_ROOT)
        expected = len(skills)
        inserted = snapshot_coverage(FAKE_RUN_ID, self.conn, REPO_ROOT)
        self.assertEqual(inserted, expected)

    def test_row_count_in_db(self):
        skills = _load_hero_skills(REPO_ROOT)
        snapshot_coverage(FAKE_RUN_ID, self.conn, REPO_ROOT)
        count = self.conn.execute(
            "SELECT COUNT(*) FROM coverage_snapshots WHERE run_id = ?",
            (FAKE_RUN_ID,),
        ).fetchone()[0]
        self.assertEqual(count, len(skills))

    def test_tier1_heroes_have_testcase_coverage(self):
        snapshot_coverage(FAKE_RUN_ID, self.conn, REPO_ROOT)
        rows = self.conn.execute(
            """
            SELECT hero, MAX(testcase_count) as max_tc
            FROM coverage_snapshots
            WHERE run_id = ?
            GROUP BY hero
            """,
            (FAKE_RUN_ID,),
        ).fetchall()
        covered = {hero for hero, max_tc in rows if max_tc > 0}
        missing = TIER1_HEROES - covered
        self.assertFalse(
            missing,
            f"Tier 1 heroes with no testcase coverage: {sorted(missing)}",
        )


if __name__ == "__main__":
    unittest.main()
