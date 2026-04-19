ALTER TABLE run_testcase_files ADD COLUMN included INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_run_testcase_files_run_included ON run_testcase_files(run_id, included);
