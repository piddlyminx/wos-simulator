#!/usr/bin/env python3
"""
Background runner for the dashboard "Check now" action.

This wrapper executes check_testcases.py with optional --matching filters and
persists status to a JSON file so the Next.js UI can poll progress without
holding an HTTP request open.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
CHECK_TESTCASES_PATH = REPO_ROOT / "check_testcases.py"
DB_PATH = REPO_ROOT / "test_results" / "dashboard.sqlite"


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def write_status(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(
        json.dumps(payload, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    tmp_path.replace(path)


def tail(text: str, limit: int = 4000) -> str:
    if len(text) <= limit:
        return text
    return text[-limit:]


def latest_run() -> dict[str, Any] | None:
    if not DB_PATH.exists():
        return None

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute(
            """
            SELECT id, started_at, finished_at, overall_avg_error_pct, bh_sig_count
            FROM runs
            ORDER BY
              CASE WHEN started_at IS NULL THEN 1 ELSE 0 END,
              started_at DESC,
              rowid DESC
            LIMIT 1
            """
        ).fetchone()
    finally:
        conn.close()

    if row is None:
        return None

    return {
        "id": row["id"],
        "started_at": row["started_at"],
        "finished_at": row["finished_at"],
        "overall_avg_error_pct": row["overall_avg_error_pct"],
        "bh_sig_count": row["bh_sig_count"],
    }


def build_command(matching: list[str]) -> list[str]:
    command = [sys.executable, str(CHECK_TESTCASES_PATH)]
    if matching:
        command.extend(["--matching", *matching])
    return command


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--status-file", required=True)
    parser.add_argument("--matching", nargs="*", default=[])
    args = parser.parse_args()

    status_path = Path(args.status_file).expanduser()
    matching = [value.strip() for value in args.matching if value.strip()]
    started_at = now_iso()

    running_status = {
        "state": "running",
        "started_at": started_at,
        "matching": matching,
        "runner_pid": os.getpid(),
        "command": build_command(matching),
    }
    write_status(status_path, running_status)

    if not CHECK_TESTCASES_PATH.exists():
        finished_at = now_iso()
        write_status(
            status_path,
            {
                **running_status,
                "state": "failed",
                "finished_at": finished_at,
                "duration_ms": 0,
                "error": f"Missing check_testcases.py at {CHECK_TESTCASES_PATH}",
            },
        )
        return 1

    started_monotonic = dt.datetime.now(dt.timezone.utc)

    try:
        completed = subprocess.run(
            build_command(matching),
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
    except Exception as exc:  # pragma: no cover - defensive path
        finished_at = now_iso()
        duration_ms = int(
            (dt.datetime.now(dt.timezone.utc) - started_monotonic).total_seconds()
            * 1000
        )
        write_status(
            status_path,
            {
                **running_status,
                "state": "failed",
                "finished_at": finished_at,
                "duration_ms": duration_ms,
                "error": f"Failed to launch check_testcases.py: {exc}",
            },
        )
        return 1

    finished_at = now_iso()
    duration_ms = int(
        (dt.datetime.now(dt.timezone.utc) - started_monotonic).total_seconds() * 1000
    )
    latest = latest_run() if completed.returncode == 0 else None
    final_status: dict[str, Any] = {
        **running_status,
        "state": "succeeded" if completed.returncode == 0 else "failed",
        "finished_at": finished_at,
        "duration_ms": duration_ms,
        "exit_code": completed.returncode,
        "stdout_tail": tail(completed.stdout or ""),
        "stderr_tail": tail(completed.stderr or ""),
        "latest_run": latest,
    }
    if completed.returncode != 0:
        final_status["error"] = (
            f"check_testcases.py exited with code {completed.returncode}"
        )
    write_status(status_path, final_status)
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
