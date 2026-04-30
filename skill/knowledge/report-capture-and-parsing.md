# Report Capture and Parsing

## Read this when

Read this before changing:

- report screenshot capture
- scroll-to-bottom detection
- OCR or template matching
- report parsing
- battle-report diagnostics
- debug artifact copying
- parser docs or report schemas

## Hard rule: do not parse incomplete captures

A captured report is only parseable if the capture process confirms the bottom of the report was reached. If bottom detection fails, parsing must fail hard rather than producing zero/default stats.

Required behavior:

1. Attempt to reach the report bottom.
2. Confirm the bottom using a report-end marker, not only image-mean stability.
3. Retry up to the configured retry limit.
4. If still not confirmed, save diagnostic screenshots and metadata.
5. Emit an error that clearly states where diagnostics were saved.
6. Do not parse the screenshots as a complete report.

Image stability can be a useful signal that scrolling stopped. It is not by itself proof that the report bottom was reached.

## Battle vs non-battle behavior

Single-report parsing:

- If the report is not a battle report, fail with a clear error.
- Do not return all-zero battle stats for non-battle reports.

Batch parsing:

- Skip non-battle reports until a battle report is found, if that is the batch-mode contract.
- Record that a non-battle report was skipped.
- Do not silently convert skipped reports into zero/default battle results.

## Parser unification goal

Report parsing should be centralized. Avoid maintaining multiple incompatible scripts that each parse stats differently.

A shared parser should handle:

- battle overview detection
- attacker/defender stat extraction
- troop count extraction
- troop type identification
- troop tier identification
- fire-crystal level identification
- result/survivor/loss extraction
- parser confidence and diagnostics

If one script has the best troop-type template matching, retain that capability and move it into the shared parser rather than discarding it.

## OCR and template matching

Use the simplest reliable parser for each field:

| Field | Preferred method |
|---|---|
| text labels and numeric stats | OCR or existing simple stat parser |
| troop type icons | template matching retained from the strongest existing implementation |
| troop tier | template matching or validated visual classifier |
| fire-crystal level | template matching or validated visual classifier |
| report-end marker | explicit marker detection, not image stability alone |

Capture both troop tier and fire-crystal level. Do not collapse them into one string if downstream code needs separate fields.

## Diagnostics contract

When debug capture is requested, missing debug artifacts are themselves diagnostic. Copy failures must be logged at warning level with:

- source key/name
- source path
- destination path
- exception message

Do not swallow debug-copy exceptions silently.

## Output contract

A parsed report should indicate:

```text
is_battle_report
report_bottom_reached
parser_version
capture_id or diagnostics id
attacker stats
defender stats
attacker troops: type, tier, fire-crystal level, count
defender troops: type, tier, fire-crystal level, count
result values
warnings
```

If `report_bottom_reached` is false, the parser should not return a normal parsed report.
