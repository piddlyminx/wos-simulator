# Dashboard SQLite Schema

The ingestion pipeline writes every `archived/v1/check_testcases.py` run into
`test_results/dashboard.sqlite` so the Next.js dashboard can query
historical accuracy data without re-parsing JSON snapshots. (References to
`check_testcases.py` below are the same legacy Python checker, now under
`archived/v1/`.)

---

## Tables

### `_migrations`

Internal migration-tracking table. Each applied `.sql` file gets one row.

| Column | Type | Notes |
|---|---|---|
| `name` | TEXT PK | Filename of the migration, e.g. `001_initial.sql` |
| `applied_at` | TEXT | ISO-8601 UTC timestamp of application |

---

### `blobs`

Content-addressed storage for dirty working-tree captures.  Only present when
`check_testcases.py` runs on a dirty git tree.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | `sha256:<hex>` content address |
| `kind` | TEXT | `patch` or `untracked_manifest` |
| `content_gzip` | BLOB | Gzip-compressed payload |

A **patch** blob is the output of `git diff HEAD --binary` compressed with
gzip.  An **untracked_manifest** blob is a gzipped tar archive of every
untracked (non-ignored) file in the repo at run time.

---

### `runs`

One row per `check_testcases.py` invocation.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | UUID v4 |
| `started_at` | TEXT | ISO-8601 UTC, nullable |
| `finished_at` | TEXT UNIQUE | ISO-8601 UTC — the natural dedup key |
| `git_sha` | TEXT | HEAD commit SHA at run time |
| `dirty` | INTEGER | 1 if the working tree was dirty |
| `baseline_git_sha` | TEXT | SHA of the baseline snapshot, nullable |
| `cli_args_json` | TEXT | JSON object of CLI flags |
| `thresholds_json` | TEXT | JSON object of statistical thresholds |
| `overall_avg_error_pct` | REAL | Mean of `abs(bias_pct)` across all testcases |
| `bh_sig_count` | INTEGER | Count of testcases with `q <= 0.05` |
| `summary_json` | TEXT | JSON: `{total, passing, failing, waived, skipped_count, skipped}` |
| `patch_blob_id` | TEXT FK→blobs | Present when `dirty=1` and tracked changes exist |
| `untracked_blob_id` | TEXT FK→blobs | Present when `dirty=1` and untracked files exist |

---

### `run_testcases`

One row per testcase per run.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Auto-increment surrogate key |
| `run_id` | TEXT FK→runs | Parent run |
| `file` | TEXT | Relative path of the testcase JSON file |
| `testcase_id` | TEXT | Human-readable testcase identifier |
| `idx` | INTEGER | Zero-based index within the file |
| `n_sim` | INTEGER | Number of simulator trials |
| `n_game` | INTEGER | Number of game (emulator) observations |
| `mu_sim` | REAL | Simulator mean outcome |
| `mu_game` | REAL | Game mean outcome |
| `bias_pct` | REAL | `(mu_sim - mu_game) / total_initial_troops * 100` |
| `t` | REAL | Welch t-statistic (NULL for deterministic/zero-var/single-observation cases) |
| `q` | REAL | Benjamini-Hochberg adjusted p-value (NULL for non-t cases) |
| `passes` | INTEGER | 1 if the testcase passes all acceptance criteria |
| `stat_type` | TEXT | `deterministic`, `zero_var`, `single_obs`, `p`, or `t` |
| `waived_bool` | INTEGER | 1 if the bias falls within an accepted-residual waiver band |

---

### `run_testcase_files`

SHA-256 fingerprints of the actual testcase JSON files used in a run.
Enables detection of testcase drift between runs with the same git SHA.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Auto-increment surrogate key |
| `run_id` | TEXT FK→runs | Parent run |
| `file_path` | TEXT | Relative path of the testcase JSON file |
| `sha256` | TEXT | Hex SHA-256 of the file at run time |

---

## Indexes

| Index | Table | Purpose |
|---|---|---|
| `idx_run_testcases_run_id` | `run_testcases` | Fast join from `runs` |
| `idx_run_testcase_files_run_id` | `run_testcase_files` | Fast join from `runs` |
| `idx_runs_finished_at` | `runs` | Chronological listing / dedup check |

---

## Example Queries

### All runs sorted by time (most recent first)

```sql
SELECT id, finished_at, git_sha, dirty, overall_avg_error_pct, bh_sig_count
FROM runs
ORDER BY finished_at DESC
LIMIT 20;
```

### Error trend over time

```sql
SELECT finished_at, overall_avg_error_pct, bh_sig_count
FROM runs
ORDER BY finished_at;
```

### Full testcase history for a specific testcase

```sql
SELECT r.finished_at, r.git_sha, tc.bias_pct, tc.q, tc.passes, tc.waived_bool
FROM run_testcases tc
JOIN runs r ON tc.run_id = r.id
WHERE tc.file = 'testcases/emulator_verified/lynn_solo.json'
  AND tc.testcase_id = 'lynn_solo_balanced'
ORDER BY r.finished_at;
```

### Failing testcases in the most recent run

```sql
WITH latest AS (
    SELECT id FROM runs ORDER BY finished_at DESC LIMIT 1
)
SELECT tc.file, tc.testcase_id, tc.bias_pct, tc.q, tc.waived_bool
FROM run_testcases tc
JOIN latest ON tc.run_id = latest.id
WHERE tc.passes = 0 AND tc.waived_bool = 0;
```

### Retrieve a patch blob for a dirty run

```sql
SELECT b.content_gzip
FROM runs r
JOIN blobs b ON r.patch_blob_id = b.id
WHERE r.finished_at = '2026-04-19T12:00:00Z';
-- decompress with: python3 -c "import gzip,sys; sys.stdout.buffer.write(gzip.decompress(sys.stdin.buffer.read()))"
```

### Coverage matrix — which testcases appear in which runs

```sql
SELECT tc.file, tc.testcase_id, COUNT(*) AS run_count,
       AVG(tc.bias_pct) AS avg_bias_pct,
       SUM(tc.passes) AS passing_runs
FROM run_testcases tc
GROUP BY tc.file, tc.testcase_id
ORDER BY avg_bias_pct DESC;
```

---

## DB Location

`test_results/dashboard.sqlite` relative to the repo root.

## Backfill

To populate historical runs:

```bash
.venv/bin/python dashboard/backfill.py
```

## Simulator-relevant path scope

Captured patches and untracked tars are scoped to **simulator-relevant paths
only** — the source allowlist lives in `dashboard/sim_paths.py` (mirrored for
the web UI as `dashboard/web/lib/sim-paths.ts`). Changes to dashboard code,
scratch scripts (`sim_custom.py`, `find_rng_*.py`, `troop_grid_search.py`,
`test_*.py`), or documentation cannot move a testcase outcome, so they are
stripped from both the stored blob (at capture time) and the rendered diff
(at display time, for the benefit of legacy blobs). Amend the allowlist in
both files when adding a new simulator input directory or root-level module.
