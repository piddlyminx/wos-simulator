"""Backfill script — WOS-164.

Reads all existing test_results/runs/*.json files in chronological (filename)
order and inserts them into the dashboard SQLite database via record_run().

Usage
-----
    python dashboard/backfill.py

Old runs have no dirty-state blob data, so dirty_state is always None here.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Resolve repo root relative to this file so the script works regardless of
# the working directory it is launched from.
_REPO_ROOT = Path(__file__).parent.parent
_RUNS_DIR = _REPO_ROOT / "test_results" / "runs"

# Ensure repo root is on the Python path so dashboard imports work.
sys.path.insert(0, str(_REPO_ROOT))

from dashboard.ingest import open_db, record_run  # noqa: E402


def main() -> int:
    run_files = sorted(_RUNS_DIR.glob("*.json"))
    total = len(run_files)

    if total == 0:
        print("No run JSON files found in", _RUNS_DIR)
        return 0

    conn = open_db()

    inserted = 0
    skipped = 0

    for i, run_file in enumerate(run_files, start=1):
        try:
            with run_file.open() as fh:
                run_doc = json.load(fh)
        except (json.JSONDecodeError, OSError) as exc:
            print(f"[{i}/{total}] {run_file.name} — ERROR reading file: {exc}")
            continue

        result = record_run(run_doc, _REPO_ROOT, dirty_state=None, conn=conn)

        if result is None:
            skipped += 1
            print(f"[{i}/{total}] {run_file.name} — skipped: already exists")
        else:
            inserted += 1
            print(f"[{i}/{total}] {run_file.name} — inserted")

    conn.close()

    print(f"\nDone. Inserted: {inserted}  Skipped (already existed): {skipped}  Total files: {total}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
