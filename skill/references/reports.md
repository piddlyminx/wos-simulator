# Reports Reference

## Read this when

Read this before changing report docs, report parsing, capture diagnostics, or testcase ingestion from reports.

## Battle report behavior

A valid parsed battle report must contain a battle overview and enough captured content to reach the report bottom.

Single-report behavior:

- If the selected report is not a battle report, parsing raises a clear error.
- It must not return an all-zero/default battle result.

Batch behavior:

- Batch mode may skip non-battle reports while searching for a battle report.
- Skipped reports should be recorded or logged.
- Skipped non-battle reports must not be emitted as zero/default battle reports.

## Required parsed fields

A battle report parser should capture:

```text
report id or capture id
is battle report
report bottom reached
attacker name/role
defender name/role
attacker stats
defender stats
attacker troops: type, tier, fire-crystal level, count
defender troops: type, tier, fire-crystal level, count
survivors/losses/result values
warnings and parser confidence
parser version
```

Troop tier and fire-crystal level are separate fields. Do not collapse them if downstream simulator input needs both.

## Incomplete capture behavior

If the bottom of the page was not reached:

- fail hard
- save diagnostic screenshots and metadata
- include the diagnostic directory in the error
- do not parse partial screenshots as a complete battle report

## Non-battle examples

Examples of reports that should fail or skip rather than parse as zeros:

```text
mail without Battle Overview
system report
resource report
partial report before bottom detection
```

## Diagnostics

Debug artifacts are part of the report contract. When debug capture is requested, copy failures must be visible in logs. Missing artifacts during diagnostics should not be silently ignored.
