"""Dashboard ingestion layer — WOS-164.

Public API
----------
open_db(db_path=None) -> sqlite3.Connection
    Opens (creating if needed) the dashboard SQLite database and applies any
    pending migrations.  Returns the open connection with WAL mode enabled.

record_run(run_doc, repo_root, dirty_state=None) -> str | None
    Inserts a run document into the database.  Returns the run UUID on
    insertion, or None if the run was already present (idempotent on
    finished_at).  Everything is wrapped in a single transaction.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from pathlib import Path
from typing import Optional

try:
    from check_testcases import waiver_for
except ImportError:
    def waiver_for(file_path: str, testcase_id: str):  # type: ignore[misc]
        return None

_REPO_ROOT = Path(__file__).parent.parent
DB_PATH = _REPO_ROOT / "test_results" / "dashboard.sqlite"
_MIGRATIONS_DIR = Path(__file__).parent / "migrations"

_ENSURE_MIGRATIONS_TABLE = """
CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT
)
"""


def _apply_migrations(conn: sqlite3.Connection) -> None:
    conn.execute(_ENSURE_MIGRATIONS_TABLE)
    conn.commit()

    applied: set[str] = {
        row[0] for row in conn.execute("SELECT name FROM _migrations")
    }

    for mf in sorted(_MIGRATIONS_DIR.glob("*.sql")):
        if mf.name in applied:
            continue
        with conn:
            for statement in _split_sql(mf.read_text()):
                conn.execute(statement)
            conn.execute(
                "INSERT INTO _migrations(name, applied_at) VALUES (?, datetime('now'))",
                (mf.name,),
            )


def _split_sql(sql: str) -> list[str]:
    return [s.strip() for s in sql.split(";") if s.strip()]


def open_db(db_path: Optional[Path | str] = None) -> sqlite3.Connection:
    """Open the dashboard SQLite DB, apply pending migrations, return connection.

    Parameters
    ----------
    db_path:
        Override the default ``test_results/dashboard.sqlite`` location.
        Useful for tests.
    """
    path = Path(db_path) if db_path is not None else DB_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    _apply_migrations(conn)
    return conn


def _sha256_file(path: Path) -> Optional[str]:
    try:
        data = path.read_bytes()
    except (FileNotFoundError, IsADirectoryError, PermissionError):
        return None
    return hashlib.sha256(data).hexdigest()


def record_run(
    run_doc: dict,
    repo_root: Path | str,
    dirty_state=None,
    conn: Optional[sqlite3.Connection] = None,
) -> Optional[str]:
    """Insert one run (+ testcases + file hashes + optional blobs) into the DB.

    Parameters
    ----------
    run_doc:
        The JSON document as produced by ``check_testcases.py``.
    repo_root:
        Absolute path to the repository root, used to resolve testcase file
        paths for SHA-256 hashing.
    dirty_state:
        Optional ``CapturedDirtyState`` TypedDict from ``state_capture.py``.
        When provided and non-None blob content is present, blobs are inserted
        into the ``blobs`` table before the run row.
    conn:
        Optional open connection; if None, ``open_db()`` is called.

    Returns
    -------
    str | None
        The UUID of the inserted run, or None if it already existed.
    """
    own_conn = conn is None
    if own_conn:
        conn = open_db()

    try:
        finished_at = run_doc.get("finished_at")
        if not finished_at:
            raise ValueError("run_doc missing 'finished_at'")

        existing = conn.execute(
            "SELECT id FROM runs WHERE finished_at = ?", (finished_at,)
        ).fetchone()
        if existing:
            return None

        root = Path(repo_root).resolve()
        testcases = run_doc.get("testcases", {})

        abs_bias_sum = 0.0
        abs_bias_count = 0
        bh_sig_count = 0
        passing = 0
        failing = 0
        waived = 0
        distinct_files: set[str] = set()
        waived_flags: dict[str, bool] = {}

        for key, tc in testcases.items():
            bias_pct = tc.get("bias_pct")
            if bias_pct is not None:
                abs_bias_sum += abs(bias_pct)
                abs_bias_count += 1

            q = tc.get("q")
            if q is not None and q <= 0.05:
                bh_sig_count += 1

            file_path = tc.get("file", "")
            testcase_id = tc.get("testcase_id", "")
            waiver = waiver_for(file_path, testcase_id)
            is_waived = (
                waiver is not None
                and bias_pct is not None
                and abs(bias_pct - waiver["expected_bias_pct"]) <= waiver["tolerance_pct"]
            )
            waived_flags[key] = is_waived

            if is_waived:
                waived += 1
            elif tc.get("passes"):
                passing += 1
            else:
                failing += 1

            if file_path:
                distinct_files.add(file_path)

        overall_avg_error_pct = abs_bias_sum / abs_bias_count if abs_bias_count else None

        skipped = run_doc.get("skipped", [])
        summary = {
            "total": len(testcases),
            "passing": passing,
            "failing": failing,
            "waived": waived,
            "skipped_count": len(skipped),
            "skipped": skipped,
        }

        run_id = str(uuid.uuid4())

        with conn:
            patch_blob_id: Optional[str] = None
            untracked_blob_id: Optional[str] = None

            if dirty_state is not None:
                patch_blob_id = dirty_state.get("patch_blob_id")
                untracked_blob_id = dirty_state.get("untracked_blob_id")
                patch_gzip = dirty_state.get("patch_content_gzip")
                untracked_gzip = dirty_state.get("untracked_content_gzip")

                if patch_blob_id and patch_gzip:
                    conn.execute(
                        "INSERT OR IGNORE INTO blobs(id, kind, content_gzip) VALUES (?, ?, ?)",
                        (patch_blob_id, "patch", patch_gzip),
                    )
                if untracked_blob_id and untracked_gzip:
                    conn.execute(
                        "INSERT OR IGNORE INTO blobs(id, kind, content_gzip) VALUES (?, ?, ?)",
                        (untracked_blob_id, "untracked_manifest", untracked_gzip),
                    )

            conn.execute(
                """
                INSERT INTO runs (
                    id, started_at, finished_at, git_sha, dirty,
                    baseline_git_sha, cli_args_json, thresholds_json,
                    overall_avg_error_pct, bh_sig_count, summary_json,
                    patch_blob_id, untracked_blob_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    run_id,
                    run_doc.get("started_at"),
                    finished_at,
                    run_doc.get("git_sha", ""),
                    1 if run_doc.get("dirty") else 0,
                    run_doc.get("baseline_git_sha"),
                    json.dumps(run_doc.get("cli_args", {})),
                    json.dumps(run_doc.get("thresholds", {})),
                    overall_avg_error_pct,
                    bh_sig_count,
                    json.dumps(summary),
                    patch_blob_id,
                    untracked_blob_id,
                ),
            )

            for key, tc in testcases.items():
                conn.execute(
                    """
                    INSERT INTO run_testcases (
                        run_id, file, testcase_id, idx,
                        n_sim, n_game, mu_sim, mu_game, bias_pct,
                        t, q, passes, stat_type, waived_bool
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        run_id,
                        tc.get("file", ""),
                        tc.get("testcase_id", ""),
                        tc.get("idx", 0),
                        tc.get("n_sim", 0),
                        tc.get("n_game", 0),
                        tc.get("mu_sim"),
                        tc.get("mu_game"),
                        tc.get("bias_pct"),
                        tc.get("stat"),
                        tc.get("q"),
                        1 if tc.get("passes") else 0,
                        tc.get("stat_type", ""),
                        1 if waived_flags.get(key) else 0,
                    ),
                )

            for file_path in sorted(distinct_files):
                sha = _sha256_file(root / file_path)
                if sha is None:
                    continue
                conn.execute(
                    "INSERT INTO run_testcase_files(run_id, file_path, sha256) VALUES (?, ?, ?)",
                    (run_id, file_path, sha),
                )

        return run_id

    finally:
        if own_conn:
            conn.close()
