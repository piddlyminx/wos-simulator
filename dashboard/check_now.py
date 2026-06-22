#!/usr/bin/env python3
"""
Background runner for the dashboard "Check now" action.

This wrapper executes the TypeScript simulator testcase runner with an optional
--matching filter and persists status to a JSON file so the Next.js UI can poll
progress without holding an HTTP request open.
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
SIMULATOR_DIR = REPO_ROOT / "simulator"
SIMULATOR_REPORT_DIR = SIMULATOR_DIR / "testcase_results"
DB_PATH = REPO_ROOT / "test_results" / "dashboard.sqlite"
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from dashboard.ingest import open_db, record_run  # noqa: E402
from dashboard.state_capture import capture_dirty_state  # noqa: E402


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


def latest_parity_report() -> dict[str, Any] | None:
    reports = sorted(
        SIMULATOR_REPORT_DIR.glob("simulator_parity_*.json"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    if not reports:
        return None
    report = reports[0]
    try:
        payload = json.loads(report.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        payload = {}
    counts = payload.get("counts") if isinstance(payload, dict) else None
    return {
        "absolute_path": str(report),
        "path": str(report.relative_to(REPO_ROOT)),
        "created_at": payload.get("createdAt") if isinstance(payload, dict) else None,
        "counts": counts if isinstance(counts, dict) else None,
    }


def git_sha() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            cwd=REPO_ROOT,
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return ""


def git_dirty() -> bool:
    try:
        status = subprocess.check_output(
            ["git", "status", "--porcelain"],
            cwd=REPO_ROOT,
            text=True,
            stderr=subprocess.DEVNULL,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False
    return bool(status.strip())


def ingest_report(report_path: Path, repo_root: Path = REPO_ROOT) -> dict[str, Any] | None:
    payload = json.loads(report_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"Report at {report_path} is not a JSON object")
    payload.setdefault("git_sha", git_sha())
    payload.setdefault("dirty", git_dirty())
    payload.setdefault("report_file", report_path.name)
    try:
        payload.setdefault("report_path", str(report_path.relative_to(repo_root)))
    except ValueError:
        payload.setdefault("report_path", str(report_path))

    try:
        dirty_state = capture_dirty_state(repo_root)
    except (subprocess.CalledProcessError, FileNotFoundError):
        dirty_state = None

    conn = open_db(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        run_id = record_run(
            payload,
            repo_root,
            dirty_state=dirty_state,
            conn=conn,
        )
        if run_id is None:
            return latest_run()
        row = conn.execute(
            """
            SELECT id, started_at, finished_at, overall_avg_error_pct,
                   bh_sig_count, summary_json, report_file, report_path
            FROM runs
            WHERE id = ?
            """,
            (run_id,),
        ).fetchone()
    finally:
        conn.close()

    if row is None:
        return None
    summary = json.loads(row["summary_json"] or "{}")
    return {
        "id": row["id"],
        "started_at": row["started_at"],
        "finished_at": row["finished_at"],
        "overall_avg_error_pct": row["overall_avg_error_pct"],
        "bh_sig_count": row["bh_sig_count"],
        "total": summary.get("total"),
        "passing": summary.get("passing"),
        "failing": summary.get("failing"),
        "report_file": row["report_file"],
        "report_path": row["report_path"],
    }


def build_command(matching: list[str]) -> list[str]:
    command = [
        "npx",
        "--yes",
        "tsx",
        "scripts/run_testcases.ts",
        "--output-dir",
        str(SIMULATOR_REPORT_DIR),
        "--workers",
        str(max(os.cpu_count() // 2, 1)),
    ]
    if matching:
        command.extend(["--matching", " ".join(matching)])
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

    if not SIMULATOR_DIR.exists():
        finished_at = now_iso()
        write_status(
            status_path,
            {
                **running_status,
                "state": "failed",
                "finished_at": finished_at,
                "duration_ms": 0,
                "error": f"Missing simulator package at {SIMULATOR_DIR}",
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
                "error": f"Failed to launch TypeScript simulator testcase runner: {exc}",
            },
        )
        return 1

    finished_at = now_iso()
    duration_ms = int(
        (dt.datetime.now(dt.timezone.utc) - started_monotonic).total_seconds() * 1000
    )
    latest_report = latest_parity_report() if completed.returncode == 0 else None
    latest = None
    if latest_report is not None:
        latest = ingest_report(Path(latest_report["absolute_path"]))
    final_status: dict[str, Any] = {
        **running_status,
        "state": "succeeded" if completed.returncode == 0 else "failed",
        "finished_at": finished_at,
        "duration_ms": duration_ms,
        "exit_code": completed.returncode,
        "stdout_tail": tail(completed.stdout or ""),
        "stderr_tail": tail(completed.stderr or ""),
        "latest_run": latest,
        "latest_report": latest_report,
    }
    if completed.returncode != 0:
        final_status["error"] = (
            f"TypeScript simulator testcase runner exited with code {completed.returncode}"
        )
    write_status(status_path, final_status)
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
