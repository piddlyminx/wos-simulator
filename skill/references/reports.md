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

Battle execution, report capture, and testcase materialization are independent operations:

```bash
./scripts/wosctl run-battle testcase_spec/example.json
./scripts/wosctl --instance <attacker> report --tab war --index 1 --output captures/report.json
./scripts/wosctl create-testcase testcase_spec/example.json --report captures/report.json
```

For a report that is already in the inbox, the capture and materialization steps can be composed without running a battle:

```bash
./scripts/wosctl create-testcase testcase_spec/example.json --tab war --index 2
```

Saved screenshots can be parsed and materialized without emulator access:

```bash
./scripts/wosctl report-images captures/saved-report --output captures/saved-report.json
./scripts/wosctl create-testcase testcase_spec/example.json --images captures/saved-report
```

The image directory must contain three complete views: Battle Overview/outcome, troop slots plus all Stat Bonuses, and Battle Details through the Attacker/Defender summary boundary. Generic filenames are classified by content. Existing capture directories using `report_top`, `report_stats`, `bd_top`, and `bd_bot` names are also accepted; `report_bottom` is validated when present. Supported formats are PNG, JPG, JPEG, and WEBP.

For screenshots from accounts that are not configured emulators, provide explicit non-empty hero skill dictionaries in the testcase spec. Explicit spec skills are used offline; empty hero dictionaries retain the normal saved/emulator skill-enrichment behavior.

`create-testcase` must validate attacker/defender roles, troop identities/counts, usable stats, and reported hero names against the spec before writing. A mismatch is an error and must not become ground truth.

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
