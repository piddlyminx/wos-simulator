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

KNOWN_ISSUE_WAIVERS = {
    "testcases/heroes_unittests/Alonso_tc.json::daut_viper_1": {
        "issue": "WOS-136",
        "expected_bias_pct": -1.67,
        "tolerance_pct": 0.75,
        "note": "Structural Alonso level-branching; no fix without schema extension (WOS-144).",
    },
    "testcases/heroes_unittests/Alonso_tc.json::daut_viper_2": {
        "issue": "WOS-136",
        "expected_bias_pct": 0.88,
        "tolerance_pct": 0.75,
        "note": "Structural Alonso level-branching; no fix without schema extension (WOS-144).",
    },
}


def waiver_for(file_path: str, testcase_id: str):
    return KNOWN_ISSUE_WAIVERS.get(f"{file_path}::{testcase_id}")

try:
    from dashboard.coverage import snapshot_coverage as _snapshot_coverage
except ImportError:
    _snapshot_coverage = None  # type: ignore[assignment]

try:
    from dashboard.seed_heroes import seed_heroes as _seed_heroes
except ImportError:
    _seed_heroes = None  # type: ignore[assignment]

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
        # Foreign keys must be OFF around migrations that rebuild referenced
        # tables (e.g. via CREATE…INSERT…DROP…RENAME to modify CHECK). Toggling
        # FKs inside a transaction is a no-op in SQLite, so commit first, flip,
        # run the migration in its own transaction, then restore.
        conn.commit()
        conn.execute("PRAGMA foreign_keys = OFF")
        try:
            with conn:
                for statement in _split_sql(mf.read_text()):
                    conn.execute(statement)
                conn.execute(
                    "INSERT INTO _migrations(name, applied_at) VALUES (?, datetime('now'))",
                    (mf.name,),
                )
        finally:
            conn.execute("PRAGMA foreign_keys = ON")


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
    # The dashboard DB is a git-committed artifact. WAL mode leaves recent
    # writes in ignored sidecar files, so keep on-disk DBs self-contained.
    if path != Path(":memory:"):
        conn.execute("PRAGMA journal_mode=DELETE")
    conn.execute("PRAGMA foreign_keys=ON")
    _apply_migrations(conn)
    if _seed_heroes is not None:
        _seed_heroes(conn)
    return conn


def _sha256_file(path: Path) -> Optional[str]:
    try:
        data = path.read_bytes()
    except (FileNotFoundError, IsADirectoryError, PermissionError):
        return None
    return hashlib.sha256(data).hexdigest()


def _run_started_at(run_doc: dict) -> Optional[str]:
    return run_doc.get("started_at") or run_doc.get("createdAt")


def _run_finished_at(run_doc: dict) -> Optional[str]:
    return run_doc.get("finished_at") or run_doc.get("createdAt")


def _run_cli_args(run_doc: dict) -> dict:
    cli_args = run_doc.get("cli_args")
    if isinstance(cli_args, dict):
        return cli_args
    options = run_doc.get("options")
    return options if isinstance(options, dict) else {}


def _game_metric(tc: dict) -> dict:
    game = tc.get("game")
    return game if isinstance(game, dict) else tc


def _metric_value(metric: dict, new_key: str, old_key: str, default=None):
    return metric.get(old_key, metric.get(new_key, default))


def _stat_adjustment(tc: dict) -> dict | None:
    adjustment = tc.get("gameStatAdjustment")
    return adjustment if isinstance(adjustment, dict) else None


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
        The JSON document for one simulator accuracy run.
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
        finished_at = _run_finished_at(run_doc)
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
            metric = _game_metric(tc)
            bias_pct = metric.get("bias_pct")
            if bias_pct is not None:
                abs_bias_sum += abs(bias_pct)
                abs_bias_count += 1

            q = metric.get("q")
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
            elif metric.get("passes"):
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
            snapshot_blob_id: Optional[str] = None
            commit_subject: Optional[str] = None
            commit_author: Optional[str] = None
            commit_date: Optional[str] = None

            if dirty_state is not None:
                patch_blob_id = dirty_state.get("patch_blob_id")
                untracked_blob_id = dirty_state.get("untracked_blob_id")
                snapshot_blob_id = dirty_state.get("snapshot_blob_id")
                patch_gzip = dirty_state.get("patch_content_gzip")
                untracked_gzip = dirty_state.get("untracked_content_gzip")
                snapshot_gzip = dirty_state.get("snapshot_content_gzip")
                commit_subject = dirty_state.get("commit_subject")
                commit_author = dirty_state.get("commit_author")
                commit_date = dirty_state.get("commit_date")

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
                if snapshot_blob_id and snapshot_gzip:
                    conn.execute(
                        "INSERT OR IGNORE INTO blobs(id, kind, content_gzip) VALUES (?, ?, ?)",
                        (snapshot_blob_id, "simulator_snapshot", snapshot_gzip),
                    )

            conn.execute(
                """
                INSERT INTO runs (
                    id, started_at, finished_at, git_sha, dirty,
                    baseline_git_sha, cli_args_json, thresholds_json,
                    overall_avg_error_pct, bh_sig_count, summary_json,
                    patch_blob_id, untracked_blob_id, snapshot_blob_id,
                    commit_subject, commit_author, commit_date,
                    report_file, report_path
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    run_id,
                    _run_started_at(run_doc),
                    finished_at,
                    run_doc.get("git_sha") or "",
                    1 if run_doc.get("dirty") else 0,
                    run_doc.get("baseline_git_sha"),
                    json.dumps(_run_cli_args(run_doc)),
                    json.dumps(run_doc.get("thresholds", {})),
                    overall_avg_error_pct,
                    bh_sig_count,
                    json.dumps(summary),
                    patch_blob_id,
                    untracked_blob_id,
                    snapshot_blob_id,
                    commit_subject,
                    commit_author,
                    commit_date,
                    run_doc.get("report_file"),
                    run_doc.get("report_path"),
                ),
            )

            for key, tc in testcases.items():
                metric = _game_metric(tc)
                adjustment = _stat_adjustment(tc)
                conn.execute(
                    """
                    INSERT INTO run_testcases (
                        run_id, file, testcase_id, idx,
                        n_sim, n_game, mu_sim, mu_game, bias_pct,
                        t, q, passes, stat_type, waived_bool,
                        stat_adjustment_value, stat_adjustment_mode,
                        stat_adjustment_unadjusted_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        run_id,
                        tc.get("file", ""),
                        tc.get("testcase_id", ""),
                        tc.get("idx", 0),
                        _metric_value(metric, "n_candidate", "n_sim", 0),
                        _metric_value(metric, "n_reference", "n_game", 0),
                        _metric_value(metric, "mu_candidate", "mu_sim"),
                        _metric_value(metric, "mu_reference", "mu_game"),
                        metric.get("bias_pct"),
                        _metric_value(metric, "stat", "t"),
                        metric.get("q"),
                        1 if metric.get("passes") else 0,
                        metric.get("stat_type", ""),
                        1 if waived_flags.get(key) else 0,
                        adjustment.get("value") if adjustment else None,
                        adjustment.get("mode") if adjustment else None,
                        json.dumps(adjustment.get("unadjusted")) if adjustment else None,
                    ),
                )

            executed_files = set(distinct_files)
            available_files = run_doc.get("available_testcase_files")
            if available_files is None:
                # Older runs (or tests replaying pre-WOS-186 snapshots) won't have
                # this key. Fall back to executed-only to preserve prior behavior.
                available_files = list(executed_files)

            all_files = sorted(set(available_files) | executed_files)
            for file_path in all_files:
                sha = _sha256_file(root / file_path)
                if sha is None:
                    # File vanished between run and ingest. Skip either way —
                    # we can't record a hash we don't have.
                    continue
                included = 1 if file_path in executed_files else 0
                conn.execute(
                    "INSERT INTO run_testcase_files(run_id, file_path, sha256, included) VALUES (?, ?, ?, ?)",
                    (run_id, file_path, sha, included),
                )

        if _snapshot_coverage is not None:
            try:
                _snapshot_coverage(run_id, conn, root)
            except Exception:
                pass

        return run_id

    finally:
        if own_conn:
            conn.close()
