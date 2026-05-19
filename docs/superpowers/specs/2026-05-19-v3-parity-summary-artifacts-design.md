# V3 Parity Summary Artifacts Design

## Goal

Make `npm run testcases` produce a compact, useful primary report while preserving full per-battle diagnostics for drill-down. The default output will be comfortable to read in a terminal, cheap for the dashboard to load, and still point to complete artifacts when detailed investigation is needed.

## Current Problem

The v3 testcase runner currently writes one large JSON report containing both aggregate comparison data and each selected case's detailed stored battle result. Full-suite runs can grow to tens of megabytes because detailed `result` payloads include attack rows and resolved metadata for every case. That is useful evidence, but it is a poor primary output:

- stdout is not useful because the JSON is too large to scan.
- the dashboard must load detail data even when rendering only a summary table.
- humans have to search through noisy battle diagnostics to find the key parity results.

## Output Model

Use a manifest-style summary report as the primary artifact and move full case diagnostics to out-of-line artifacts.

Default CLI behavior:

- write compact summary JSON to stdout
- write the same compact summary JSON to `v3/testcase_results/v3_parity_<timestamp>.json`
- write detailed case artifacts under a sibling artifact directory
- write operational save-path information to stderr
- keep parse/unexpected-error exit behavior unchanged

Example layout:

```text
v3/testcase_results/
  v3_parity_2026-05-19T19-10-00Z.json
  v3_parity_2026-05-19T19-10-00Z/
    cases/
      000001.json
      000002.json
```

Case artifact filenames will be deterministic within a report, using zero-padded sequence numbers in selected-case order. The summary must contain references that are enough for the dashboard and a human to find the detail artifact.

## Summary Report Shape

The summary report should be lighter than the current v3 report and closer to the v1 snapshot shape written by `check_testcases.py`. It keeps only run accounting, per-testcase comparison summaries, warnings/errors, and artifact references. It removes heavyweight per-case battle payloads.

Keep:

- run metadata
- count of testcase files found
- count of testcase entries found
- per-testcase lightweight summaries for cases that executed
- warning/error summaries for cases that did not execute
- detail artifact references

Add:

- `reportKind: "v3-parity-summary"`
- `schemaVersion`
- `createdAt`
- `options`
- `artifactRoot`
- `counts`
- `warnings`
- `testcases`

`counts` includes:

- `filesFound`
- `testcasesFound`
- `executed`
- `warnings`
- `errors`
- `comparedToGame`
- `comparedToV1`

Each selected testcase must be represented exactly once:

- successful execution: an entry in `testcases`
- parse/adaptation/execution failure: an entry in `warnings` or `errors` with the reason

`warnings` and `errors` should be arrays of small objects:

- `file`
- `testcase_id`
- `idx`
- `stage`
- `reason`

Use warnings for non-fatal missing comparison inputs, such as no matching v1 snapshot entry. Use errors for parse, adaptation, execution, or artifact-write failures that prevent the case from producing a summary.

The summary should not keep a separate heavy `comparison.table[]`. The per-testcase entries are the comparison table.

`testcases` should be an object keyed by the same stable identity pattern used by v1 snapshots: `file#idx`. Each value includes:

- `file`
- `testcase_id`
- `idx`
- `detailArtifact`
- `deterministic`
- `sampleCount`
- `game`
- `v1`

If a case executes but cannot be compared against one reference, keep the testcase entry, set that comparison object to `null`, and add a warning explaining which reference was missing.

The `game` and `v1` objects expose the same comparison metric shape:

- `n_candidate`
- `mu_candidate`
- `sigma_candidate`
- `n_reference`
- `mu_reference`
- `sigma_reference`
- `bias_raw`
- `bias_pct`
- `sem`
- `stat_type`
- `stat`
- `p`
- `q`
- `passes`

For `game`, the candidate distribution is v3 output and the reference distribution is testcase `game_report_result`.

For `v1`, the candidate distribution is v3 output and the reference distribution is the matching v1 snapshot entry from the configured v1 report.

Comparison calculations must use the same statistical rules and thresholds as `check_testcases.py` wherever the same inputs exist:

- bias denominator is total initial troops across both sides
- deterministic/zero-var cases use the deterministic bias threshold
- stochastic cases with enough evidence use the same t/p and minimum-bias rule
- stochastic single-observation references are low evidence and pass by default
- q-values use the same Benjamini-Hochberg adjustment across comparable p-value rows

The implementation should extract the shared comparison calculation into reusable code rather than growing a second, incompatible parity formula in the v3 runner.

Each lightweight case must omit:

- full `result`
- full attack table
- any future trace-level payload that scales with rounds, repeats, or attacks

## Detail Artifact Shape

Each detail artifact contains the complete current case payload, including:

- all lightweight case fields
- full final stored `result`
- diagnostics
- visibility
- game and calibration metadata
- any future trace-level diagnostics

The artifact also includes enough report metadata to be interpretable if opened alone:

- `reportKind: "v3-parity-case-detail"`
- `schemaVersion`
- `createdAt`
- testcase identity fields

## CLI Flags

Initial defaults prioritize the common workflow:

- default: summary to stdout, summary file to disk, details to artifact directory
- `--no-run-snapshot`: preserve existing behavior of printing JSON only and not writing files, but now print the compact summary without `detailArtifact` paths

Optional follow-up flags can be added later if a concrete need appears:

- `--inline-details` for a single self-contained legacy-style report
- `--no-stdout-summary` for very quiet automated runs

Do not add these optional flags in the first pass unless implementation pressure makes them cheap and clearly useful.

## Dashboard Impact

The parity page treats the summary report as the index document. The table and summary cards render from the compact report alone. The detail page loads a case artifact only when the user opens a specific case.

Existing generated v3 parity reports do not need migration support. They can be deleted after this change. The dashboard loader should accept the new summary-plus-artifacts shape and show incompatible inline-detail reports as unsupported if any remain.

## Error Handling

- If a detail artifact fails to write, the CLI exits nonzero and reports the artifact write error on stderr. The summary must not reference an artifact that was not written successfully.
- If the dashboard cannot read a referenced detail artifact, show a report-level detail load error rather than crashing.
- Summary writing is all-or-obvious: create the artifact directory before writing the summary, and include only artifact paths that were successfully written.

## Testing

Add focused runner tests for:

- default output summary has no inline full `result`
- summary reports file and testcase counts
- every selected testcase is represented by either `testcases` or warnings/errors
- detail artifacts contain the full stored result
- stdout summary is compact JSON
- `--no-run-snapshot` does not write summary or detail artifacts
- artifact references are present and resolvable
- `game` and `v1` comparison objects use the same metric keys
- missing v1 snapshot rows produce warnings rather than dropping the testcase

Add focused dashboard loader tests for:

- loading summary reports with `detailArtifact`
- resolving case detail from an artifact
- rejecting unsupported inline-detail reports with a clear error
- handling missing or malformed detail artifacts

## Non-Goals

- Do not redesign parity math.
- Do not ingest v3 parity reports into SQLite.
- Do not remove detailed battle diagnostics.
- Do not make stdout human-text-only; JSON remains the primary automation interface.
