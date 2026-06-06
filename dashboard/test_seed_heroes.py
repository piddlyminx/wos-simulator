"""Regression tests for dashboard.seed_heroes."""

import unittest
from pathlib import Path

from dashboard.ingest import open_db

REPO_ROOT = Path(__file__).parent.parent


class TestSeedHeroes(unittest.TestCase):
    def test_ling_generation_comes_from_simulator_definition(self):
        conn = open_db(":memory:")
        try:
            generation = conn.execute(
                "SELECT generation FROM heroes WHERE name = ?",
                ("Ling",),
            ).fetchone()[0]
        finally:
            conn.close()

        self.assertEqual(generation, "SR")

    def test_seed_heroes_has_no_hard_coded_generation_map(self):
        source = (REPO_ROOT / "dashboard" / "seed_heroes.py").read_text()

        self.assertNotIn("GEN_MAP", source)


if __name__ == "__main__":
    unittest.main()
