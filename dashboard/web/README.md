# WOS Simulator Accuracy Dashboard

A read-only local dev dashboard for the Whiteout Survival battle simulator.

## Installation

```bash
cd dashboard/web
npm install
```

## Running

```bash
npm run dev
```

The app runs at http://localhost:3000 and redirects to `/runs` by default.

## Database

The SQLite DB lives at:

```
<repo-root>/test_results/dashboard.sqlite
```

From `dashboard/web/`, this resolves to `../../test_results/dashboard.sqlite`.

Override via the `DB_PATH` environment variable if needed:

```bash
DB_PATH=/absolute/path/to/dashboard.sqlite npm run dev
```

**The DB does not need to exist for the app to start.** If missing, `/healthz` returns `{ runs: 0, warning: "DB not found" }` and all pages show an empty state.

## How the DB gets populated

The DB is created and updated by `check_testcases.py` (repo root), which calls `dashboard/ingest.py` after each test run. Run it as usual:

```bash
cd <repo-root>
python check_testcases.py
```

## Schema

| Table | Key columns |
|---|---|
| `runs` | id, started_at, finished_at, git_sha, dirty, overall_avg_error_pct, bh_sig_count |
| `run_testcases` | run_id, file, testcase_id, mu_sim, mu_game, bias_pct, t, q, passes, waived_bool |
| `run_testcase_files` | run_id, file_path, sha256 |
| `blobs` | id, kind (patch\|untracked_manifest), content_gzip |
| `heroes` | name, classes (JSON array), tier |
| `hero_skills` | hero, skill_id, name, json_path |
| `coverage_snapshots` | run_id, hero, skill_id, testcase_count, battle_outcome_count, covered_bool |

## Schema invariants

- `runs.dirty` is 0 (clean working tree) or 1 (dirty).
- All `passes` and `*_bool` columns are INTEGER 0/1 — not native JS booleans.
- `blobs.content_gzip` is raw gzip bytes.
- `coverage_snapshots.covered_bool = 1` means at least one testcase exercises the skill.

## Stack

- Next.js 15 App Router + TypeScript (strict mode)
- Tailwind CSS v4
- Recharts (available for chart components)
- better-sqlite3 (server-side, read-only)
