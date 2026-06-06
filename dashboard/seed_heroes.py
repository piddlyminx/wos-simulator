"""Seed heroes and hero_skills tables from simulator config."""
from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path
from typing import Optional


def _dashboard_generation(raw_generation: Optional[str]) -> Optional[str]:
    """Convert simulator generation keys to dashboard display values."""
    if raw_generation is None:
        return None
    if raw_generation == "SR":
        return "SR"
    match = re.match(r"^S(\d+)", raw_generation)
    if match:
        return f"Gen {match.group(1)}"
    return raw_generation


def _normalise_troop_type(raw_troop_type: object) -> Optional[str]:
    if not isinstance(raw_troop_type, str) or not raw_troop_type:
        return None
    if raw_troop_type == "marksmen":
        return "marksman"
    return raw_troop_type


def _skill_name(skill_id: str, skill: dict) -> str:
    raw_name = skill.get("name")
    if isinstance(raw_name, str) and raw_name:
        return raw_name
    return skill_id


def _hero_definitions_dir(root: Path) -> Path:
    return root / "simulator" / "config" / "hero_definitions"


def seed_heroes(conn: sqlite3.Connection, repo_root: Optional[Path] = None) -> None:
    """Idempotently seed heroes and hero_skills tables."""
    root = Path(repo_root) if repo_root else Path(__file__).parent.parent
    hero_definitions_dir = _hero_definitions_dir(root)

    with conn:
        conn.execute("DELETE FROM hero_skills")
        for json_file in sorted(hero_definitions_dir.glob("*.json")):
            hero_name = json_file.stem
            definition = json.loads(json_file.read_text())
            skills = definition.get("skills", {})
            troop_type = _normalise_troop_type(definition.get("troop_type"))
            troop_types = [troop_type] if troop_type else []
            classes_json = json.dumps(troop_types)
            generation = _dashboard_generation(definition.get("hero_generation"))
            json_path = f"simulator/config/hero_definitions/{json_file.name}"

            conn.execute(
                "INSERT OR REPLACE INTO heroes (name, classes, generation) VALUES (?, ?, ?)",
                (hero_name, classes_json, generation),
            )

            for skill_num, (skill_id, skill) in enumerate(skills.items(), start=1):
                skill_name = _skill_name(skill_id, skill if isinstance(skill, dict) else {})
                conn.execute(
                    """
                    INSERT OR IGNORE INTO hero_skills (hero, skill_id, name, json_path)
                    VALUES (?, ?, ?, ?)
                    """,
                    (hero_name, str(skill_num), skill_name, json_path),
                )


if __name__ == "__main__":
    from pathlib import Path as _Path
    import sys

    repo_root = _Path(__file__).parent.parent
    db_path = repo_root / "test_results" / "dashboard.sqlite"

    if not db_path.exists():
        print(f"ERROR: database not found at {db_path}", file=sys.stderr)
        sys.exit(1)

    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        seed_heroes(conn, repo_root)
        hero_count = conn.execute("SELECT COUNT(*) FROM heroes").fetchone()[0]
        skill_count = conn.execute("SELECT COUNT(*) FROM hero_skills").fetchone()[0]
        print(f"Seeded {hero_count} heroes, {skill_count} hero_skills rows.")
    finally:
        conn.close()
