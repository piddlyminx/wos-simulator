# Accuracy Dashboard

## Tech stack
- NextJS 15 App Router, TypeScript, Tailwind CSS
- Recharts for all charts (board-approved)
- better-sqlite3 for server-side SQLite reads (read-only)
- DB path: `test_results/dashboard.sqlite` (git-committed)
- Dev: `cd dashboard/web && npm run dev` (defaults to port 3000, falls back to 3002 etc.)

## Routes

| Route | Purpose |
|---|---|
| `/runs` | Headline avg-error trend chart + per-testcase variance chart + accordion run table |
| `/runs/[id]` | Run detail: testcase table + diff viewer for dirty runs |
| `/coverage` | Hero × skill coverage matrix |
| `/heroes` | Hero list grouped by generation |
| `/heroes/[name]` | Hero detail: skills + testcase results + error history sparkline |
| `/simulate` | Live battle simulator with OCR import, rally mode, and attacker ratio optimisation |

## Charts on /runs

### RunsHeadlineChart
Overall `avg_error_pct` line + BH-significant-flags bar chart across last N runs. Data source: `getRunTrendWithBH()`.

### TestcaseVarianceChart (WOS-179)
Per-testcase `bias_pct` over time, showing top N most variable testcases ranked by variance (stddev² of `bias_pct` across visible runs).

- **Slider**: default N=10, range 1–50. Label shows current value.
- **Variance computed client-side** (167 distinct testcases × 50 runs is small enough).
- **X axis**: run `started_at` formatted as M/D.
- **Y axis**: `bias_pct` in percent.
- **One line per testcase**, colour-coded from a 20-colour palette cycling if >20 shown.
- **Tooltip**: testcase short name + bias formatted as `XX.X%`.
- **Short label**: strips `testcases/(emulator_verified/)?` prefix and `.json` suffix. Appends `/testcase_id` when the file has multiple distinct testcase_ids. Appends `[idx]` when idx > 0.
- Data source: `getTestcaseBiasTrend(limit = 50)` in `lib/db.ts`.

## Data layer (lib/db.ts)

Key query functions:

| Function | Returns |
|---|---|
| `getRuns(limit)` | Runs ordered DESC |
| `getRunsWithDelta(limit)` | Runs + Δ vs previous run (error pct + improved/regressed/added/retired counts) |
| `getRunTrendWithBH(limit)` | Run trend with bh_sig_count + dirty flag, oldest→newest |
| `getRunTestcases(runId)` | All testcase rows for a run |
| `getTestcaseBiasTrend(limit)` | Flat rows: (file, testcase_id, idx, run_id, started_at, bias_pct) for last N runs |
| `getCoverageSnapshots(runId)` | Coverage snapshot rows joined with hero generation |
| `getHeroErrorHistory(heroName)` | Avg bias_pct per run for testcases mentioning a hero |
| `getRunPatch(runId)` | Decompressed git patch text for dirty runs |
| `getPreviousRun(runId)` | The run immediately before the given run by started_at |

## Quality gate
Every change must pass:
- `npm run build` (clean)
- `npm run lint` (clean)
- `PLAYWRIGHT_BASE_URL=http://localhost:<port> npx playwright test` — 5 smoke tests all pass

## `/simulate` ratio optimisation (WOS-220)

- The page can search attacker troop mixes while keeping the attacker total troop count, tiers, heroes, stats, and the full defender setup fixed.
- Backend entrypoint: `dashboard/optimize_ratio.py`, called by `dashboard/web/app/api/simulate/optimize-ratio/route.ts`.
- Frontend controls live on `/simulate`: `Ratio reps`, `Grid step`, and the `Optimise ratio` button.
- Result UI shows:
  - a summary of the best composition
  - a Recharts composition scatter map (`infantry %` x-axis, `lancer %` y-axis, win rate encoded by bubble size/colour)
  - a top-10 table
  - a `Use best ratio` button that writes the best composition back into the attacker troop inputs
- Safety guardrails cap the search budget so the UI tells the user to raise the grid step or lower replicates before the request becomes too expensive.
