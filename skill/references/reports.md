# Reports Reference

## Read This When

Read this before changing report docs, report parsing, capture diagnostics, or testcase ingestion from reports.

## Battle Report Behavior

A valid parsed battle report must contain a battle overview and confirmed bottom-of-report content.

Single-report behavior:

- If the selected report is not a battle report, parsing raises a clear error.
- It must not return an all-zero/default battle result.

Batch behavior:

- Batch mode may skip non-battle reports while searching for battle reports.
- Skipped reports should be recorded or logged.
- Skipped non-battle reports must not be emitted as zero/default battle reports.

## Required Parsed Fields

A battle report parser should capture:

```text
report id or capture id
is battle report
report bottom reached
attacker name/role
defender name/role
attacker stat bonuses by unit
defender stat bonuses by unit
attacker troops: type, tier, fire-crystal level, count
defender troops: type, tier, fire-crystal level, count
survivors/losses/result values
warnings and parser confidence
parser version
```

Troop tier and fire-crystal level are separate fields. Do not collapse them if downstream code needs to map reports to generated simulator troop ids or TypeScript `FighterInput.troops`.

## Testcase Boundary

Captured report data belongs in testcase JSON as game observations, normally under `game_report_result`.

Do not add simulator output to captured testcase files. Run parity separately:

```bash
npx tsx scripts/run_testcases.ts --matching <pattern>
```

## Incomplete Capture Behavior

If the bottom of the page was not reached:

- fail hard
- save diagnostic screenshots and metadata
- include the diagnostic directory in the error
- do not parse partial screenshots as a complete battle report

## Non-Battle Examples

Examples of reports that should fail or skip rather than parse as zeros:

```text
mail without Battle Overview
system report
resource report
partial report before bottom detection
```

## Diagnostics

Debug artifacts are part of the report contract. When debug capture is requested, copy failures must be visible in logs. Missing artifacts during diagnostics should not be silently ignored.
