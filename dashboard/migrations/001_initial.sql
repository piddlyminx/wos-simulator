CREATE TABLE IF NOT EXISTS blobs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('patch', 'untracked_manifest')),
    content_gzip BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    started_at TEXT,
    finished_at TEXT NOT NULL UNIQUE,
    git_sha TEXT NOT NULL,
    dirty INTEGER NOT NULL,
    baseline_git_sha TEXT,
    cli_args_json TEXT NOT NULL,
    thresholds_json TEXT NOT NULL,
    overall_avg_error_pct REAL,
    bh_sig_count INTEGER,
    summary_json TEXT NOT NULL,
    patch_blob_id TEXT REFERENCES blobs(id),
    untracked_blob_id TEXT REFERENCES blobs(id)
);

CREATE TABLE IF NOT EXISTS run_testcases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES runs(id),
    file TEXT NOT NULL,
    testcase_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    n_sim INTEGER NOT NULL,
    n_game INTEGER NOT NULL,
    mu_sim REAL,
    mu_game REAL,
    bias_pct REAL,
    t REAL,
    q REAL,
    passes INTEGER NOT NULL,
    stat_type TEXT NOT NULL,
    waived_bool INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS run_testcase_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES runs(id),
    file_path TEXT NOT NULL,
    sha256 TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_run_testcases_run_id ON run_testcases(run_id);
CREATE INDEX IF NOT EXISTS idx_run_testcase_files_run_id ON run_testcase_files(run_id);
CREATE INDEX IF NOT EXISTS idx_runs_finished_at ON runs(finished_at);
