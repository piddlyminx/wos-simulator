"""Hero x skill coverage analytics — WOS-165.

Public API
----------
snapshot_coverage(run_id, conn, repo_root) -> int
    Compute coverage and insert into coverage_snapshots. Returns rows inserted.

print_gaps(repo_root, db_path=None) -> None
    Print heroes/skills with covered_bool=0 for the most recent run.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path
from typing import Optional


def _load_hero_skills(repo_root: Path) -> list[tuple[str, int, str]]:
    """Return list of (hero, skill_num, skill_name) from simulator hero definitions."""
    skills: list[tuple[str, int, str]] = []
    hero_definitions_dir = repo_root / "simulator" / "config" / "hero_definitions"
    for path in sorted(hero_definitions_dir.glob("*.json")):
        definition = json.loads(path.read_text())
        hero = path.stem
        for skill_num, (skill_id, raw_skill) in enumerate(
            definition.get("skills", {}).items(),
            start=1,
        ):
            skill_name = (
                raw_skill.get("name")
                if isinstance(raw_skill, dict) and isinstance(raw_skill.get("name"), str)
                else skill_id
            )
            skills.append((hero, skill_num, skill_name))
    return skills


def _active_testcase_files(repo_root: Path) -> list[Path]:
    """Return active testcase files (*.json, not .json.disabled or .json.stale_troops)."""
    tc_dir = repo_root / "testcases"
    if not tc_dir.is_dir():
        return []
    return [
        p for p in sorted(tc_dir.rglob("*.json"))
        if p.name.endswith(".json") and p.is_file()
    ]


def _hero_in_entry(entry: dict, hero: str) -> bool:
    for key in ("heroes", "joiner_heroes"):
        for side in ("attacker", "defender"):
            if hero in entry.get(side, {}).get(key, {}):
                return True
    return False


def _skill_covered_in_entry(entry: dict, hero: str, skill_num: int) -> bool:
    skill_key = f"skill_{skill_num}"
    for key in ("heroes", "joiner_heroes"):
        for side in ("attacker", "defender"):
            hero_dict = entry.get(side, {}).get(key, {}).get(hero)
            if hero_dict and hero_dict.get(skill_key, 0) > 0:
                return True
    return False


def snapshot_coverage(run_id: str, conn: sqlite3.Connection, repo_root: Path) -> int:
    """Compute coverage and insert into coverage_snapshots. Returns number of rows inserted."""
    repo_root = Path(repo_root)
    skills = _load_hero_skills(repo_root)
    tc_files = _active_testcase_files(repo_root)

    hero_skill_pairs = {(hero, skill_num): skill_name for hero, skill_num, skill_name in skills}
    heroes = sorted({hero for hero, _, _ in skills})

    skill_testcase_count: dict[tuple[str, int], int] = {
        (hero, skill_num): 0 for hero, skill_num, _ in skills
    }
    skill_outcome_count: dict[tuple[str, int], int] = {
        (hero, skill_num): 0 for hero, skill_num, _ in skills
    }

    for tc_file in tc_files:
        try:
            entries = json.loads(tc_file.read_text())
        except (json.JSONDecodeError, OSError):
            continue

        if not isinstance(entries, list):
            entries = [entries]

        for entry in entries:
            if not isinstance(entry, dict):
                continue
            game_result = entry.get("game_report_result")
            outcome_count = (
                len(game_result)
                if isinstance(game_result, list)
                else 1 if isinstance(game_result, dict) else 0
            )
            for hero in heroes:
                if _hero_in_entry(entry, hero):
                    for skill_num in {sn for h, sn in skill_testcase_count if h == hero}:
                        if _skill_covered_in_entry(entry, hero, skill_num):
                            key = (hero, skill_num)
                            skill_testcase_count[key] += 1
                            skill_outcome_count[key] += outcome_count

    rows = 0
    with conn:
        for (hero, skill_num), skill_name in sorted(hero_skill_pairs.items()):
            conn.execute(
                """
                INSERT INTO coverage_snapshots
                    (run_id, hero, skill_num, skill_name, skill_id,
                     testcase_count, battle_outcome_count, covered_bool)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    run_id,
                    hero,
                    skill_num,
                    skill_name,
                    str(skill_num),
                    skill_testcase_count[(hero, skill_num)],
                    skill_outcome_count[(hero, skill_num)],
                    1 if skill_testcase_count[(hero, skill_num)] > 0 else 0,
                ),
            )
            rows += 1
    return rows


def print_gaps(repo_root: Path, db_path: Optional[Path] = None) -> None:
    """Print heroes/skills with covered_bool=0 for the most recent run."""
    from dashboard.ingest import open_db, DB_PATH

    path = db_path if db_path is not None else DB_PATH
    conn = open_db(path)
    try:
        row = conn.execute(
            "SELECT id FROM runs ORDER BY finished_at DESC LIMIT 1"
        ).fetchone()
        if row is None:
            print("No runs found in database.")
            return
        run_id = row[0]
        gaps = conn.execute(
            """
            SELECT hero, skill_num, skill_name, testcase_count, battle_outcome_count
            FROM coverage_snapshots
            WHERE run_id = ? AND covered_bool = 0
            ORDER BY hero, skill_num
            """,
            (run_id,),
        ).fetchall()
        if not gaps:
            print(f"No coverage gaps for run {run_id}.")
            return
        print(f"Coverage gaps for run {run_id}:")
        print(f"{'Hero':<20} {'Skill':>5}  {'Skill Name':<35} {'TC Files':>8} {'Outcomes':>8}")
        print("-" * 82)
        for hero, skill_num, skill_name, tc_count, outcome_count in gaps:
            print(f"{hero:<20} {skill_num:>5}  {skill_name:<35} {tc_count:>8} {outcome_count:>8}")
    finally:
        conn.close()


def backfill_coverage(repo_root: Path, db_path: Optional[Path] = None) -> None:
    """Insert coverage snapshots for all runs that don't have one yet."""
    from dashboard.ingest import open_db, DB_PATH

    path = db_path if db_path is not None else DB_PATH
    conn = open_db(path)
    try:
        runs = conn.execute(
            """
            SELECT r.id FROM runs r
            WHERE NOT EXISTS (
                SELECT 1 FROM coverage_snapshots c WHERE c.run_id = r.id
            )
            ORDER BY r.finished_at
            """
        ).fetchall()
        total = len(runs)
        if total == 0:
            print("All runs already have coverage snapshots.")
            return
        print(f"Backfilling {total} runs...")
        for i, (run_id,) in enumerate(runs, 1):
            rows = snapshot_coverage(run_id, conn, repo_root)
            print(f"  [{i}/{total}] {run_id[:8]} — {rows} rows")
        print("Done.")
    finally:
        conn.close()


def _main() -> None:
    parser = argparse.ArgumentParser(description="Hero x skill coverage analytics")
    parser.add_argument("--print-gaps", action="store_true", help="Print uncovered skills")
    parser.add_argument("--backfill", action="store_true", help="Backfill coverage for all existing runs")
    parser.add_argument("--db", type=Path, default=None, help="Override DB path")
    args = parser.parse_args()

    repo_root = Path(__file__).parent.parent
    if args.print_gaps:
        print_gaps(repo_root, db_path=args.db)
    elif args.backfill:
        backfill_coverage(repo_root, db_path=args.db)
    else:
        parser.print_help()


if __name__ == "__main__":
    _main()
