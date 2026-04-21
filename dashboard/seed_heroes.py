"""Seed heroes and hero_skills tables from assets/hero_skills/*.json — WOS-173."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Optional

GEN_MAP = {
    # Gen 7
    "Edith": "Gen 7", "Gordon": "Gen 7", "Bradley": "Gen 7", "Ling": "Gen 7",
    # Gen 6
    "WuMing": "Gen 6", "Renee": "Gen 6", "Wayne": "Gen 6",
    # Gen 5
    "Hector": "Gen 5", "Norah": "Gen 5", "Gwen": "Gen 5",
    # Gen 4
    "Ahmose": "Gen 4", "Reina": "Gen 4", "Lynn": "Gen 4",
    # Gen 3
    "Logan": "Gen 3", "Mia": "Gen 3", "Greg": "Gen 3",
    # Gen 2
    "Flint": "Gen 2", "Philly": "Gen 2", "Alonso": "Gen 2",
    # Gen 1
    "Jeronimo": "Gen 1", "Natalia": "Gen 1", "Zinman": "Gen 1", "Molly": "Gen 1",
    # SR
    "Patrick": "SR", "Seo-yoon": "SR", "Jasser": "SR", "Jessie": "SR",
    "Lumak": "SR", "Bahiti": "SR", "Sergey": "SR",
}


def seed_heroes(conn: sqlite3.Connection, repo_root: Optional[Path] = None) -> None:
    """Idempotently seed heroes and hero_skills tables."""
    root = Path(repo_root) if repo_root else Path(__file__).parent.parent
    hero_skills_dir = root / "assets" / "hero_skills"

    with conn:
        for json_file in sorted(hero_skills_dir.glob("*.json")):
            hero_name = json_file.stem
            entries = json.loads(json_file.read_text())

            # Collect unique troop types for this hero
            troop_types = list(dict.fromkeys(
                e["skill_troop_type"] for e in entries if e.get("skill_troop_type")
            ))
            classes_json = json.dumps(troop_types)
            generation = GEN_MAP.get(hero_name)
            json_path = f"assets/hero_skills/{json_file.name}"

            conn.execute(
                "INSERT OR REPLACE INTO heroes (name, classes, generation) VALUES (?, ?, ?)",
                (hero_name, classes_json, generation),
            )

            for entry in entries:
                skill_id = str(entry["skill_num"])
                skill_name = entry.get("skill_name", "")
                conn.execute(
                    """
                    INSERT OR IGNORE INTO hero_skills (hero, skill_id, name, json_path)
                    VALUES (?, ?, ?, ?)
                    """,
                    (hero_name, skill_id, skill_name, json_path),
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
