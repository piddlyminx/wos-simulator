# V3 Parity Report Page Design

## Goal

Add a separate dashboard page for inspecting raw v3 parity runner reports without duplicating the existing SQLite-backed `/runs` workflow. The page should make current v3-vs-v1 and v3-vs-game discrepancies easy to sort, scan, and drill into.

## Non-Goals

- Do not replace or duplicate `/runs`, which remains the view for ingested `check_testcases.py` history.
- Do not ingest v3 parity reports into `test_results/dashboard.sqlite` in this first version.
- Do not store every repeated simulation result. Current v3 report JSON stores aggregate `v3Stats` across samples and one detailed `result` for the last stored sample.
- Do not extend `v3Stats` yet. Future useful fields include average rounds, win rate, skill activation/use counts, and average surviving units by type.

## Data Source

The page reads saved v3 parity runner JSON files from a filesystem location under the repository, initially the v3 package's report/result area. It supports the current v3 runner report shape:

- `selectedFiles`
- `selectedCases`
- `aggregate`
- `cases[]`
- `comparison.table[]`

The index table is driven by `comparison.table[]`. The detail page joins a selected table row to `cases[]` using `file`, `testcaseId`, and `idx`/`index`.

If no compatible v3 parity report exists, the page shows an empty state with the command pattern needed to generate one.

## Navigation

Add a `Parity` item to the dashboard navigation, separate from `Runs`.

Routes:

- `/parity`: report picker plus sortable testcase comparison table for the selected/latest report.
- `/parity/[reportId]/case`: testcase detail page using query parameters for `file`, `testcaseId`, and `idx`.

Use a query-parameter detail route because testcase file paths contain slashes and are easier to handle safely as encoded parameters.

## Index Page

The index page has compact summary cards:

- selected cases
- executed cases
- parse errors
- unexpected errors
- diagnostics
- matched calibration rows
- v3-vs-v1 failing count
- v3-vs-game failing count

The main table is client-sortable and defaults to the highest-value triage order:

1. failing `v3VsGamePasses`
2. failing `v3VsV1Passes`
3. largest absolute `v3VsGameZ`
4. largest absolute `v3VsGameBiasPct`

Columns:

- file
- testcaseId
- idx
- reference baseline: `nSim`, `muSim`, `sigmaSim`, `nGame`, `muGame`, `sigmaGame`, `referencePasses`, `referenceBiasPct`
- current v3 output: `v3N`, `v3Mu`, `v3Sigma`, `v3Sem`, `v3ScoreDelta`
- v3 vs v1: `v3VsV1Passes`, `v3VsV1BiasRaw`, `v3VsV1BiasPct`, `v3VsV1Z`
- v3 vs game: `v3VsGamePasses`, `v3VsGameBiasRaw`, `v3VsGameBiasPct`, `v3VsGameZ`

Rows link to the testcase detail page. The table should include lightweight filters for failed rows and text search across file/testcase id if this can be done without expanding scope much.

## Detail Page

The detail page shows the selected testcase execution in sections:

- comparison summary: one-row baseline/v3/verdict data from `comparison.table[]`
- v3 sample metadata: deterministic flag, sample count, `v3Stats`, `v3ScoreDelta`
- fighter visibility: heroes, troop skill ids, troop counts, and skill effect activation counts by side
- final stored v3 result: winner, rounds, remaining units
- diagnostics and error messages
- optional expandable stored-run attack table

The stored-run attack table must be labeled clearly: it represents the single detailed result stored in `cases[].result`, not every repeat used to compute `v3Stats`.

## Components

Add small, dashboard-style components rather than a large monolith:

- `ParityReportTable`: sortable/filterable table for `comparison.table[]`.
- `ParityReportSummary`: summary cards for report/run health.
- `ParityCaseSummary`: detail-page summary sections.

Use the existing dashboard visual language: dense tables, restrained colors, compact metric cards, no marketing-style page sections.

## Error Handling

- Missing report directory: empty state.
- No compatible reports: empty state.
- Malformed report file: show report-level error and do not crash the page.
- Missing case for a detail URL: show a not-found style message with a link back to `/parity`.

## Testing

Add focused tests around the data loader:

- finds compatible v3 parity reports
- picks the latest report deterministically
- extracts summary counts
- joins comparison rows to case details
- handles malformed or missing reports

Add or update a minimal dashboard smoke test if the existing Playwright setup makes this cheap.

## Follow-Up

Extend the v3 runner report shape with richer aggregate statistics:

- average rounds
- attacker win percentage
- average surviving units by side and unit type
- skill activation/use counts by skill
- selected per-repeat summaries for nondeterministic cases
