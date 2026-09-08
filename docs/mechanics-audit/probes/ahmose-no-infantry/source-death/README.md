# Ahmose: Infantry present initially, then exhausted

**Captured: game and corrected production both give0 Infantry and3 Lancers surviving.** The pre-correction forecast was61 Lancers. The accepted report is dated2026-09-07 10:33:04 BST at X787/Y577, mail ID2734692464128625. [All24 stats and complete input](capture-01/verification.json) exactly match the frozen v2 prediction, so no changed-input replay or stat fit was needed. The Viper activation field is a dash and remains null.

The parser missed the visibly recorded single Infantry and correctly rejected troop-slot total480 against report total481. Original images and [the parser error](capture-01/parser-error.json) are preserved. Reopening the same report established the mail ID and [explicit per-line survivors](capture-01/attacker-troop-details.png); the [fixture](../../../../../testcases/emulator_verified/ahmose_source_dies_001i_480l_vs_250i.json) was manually transcribed from the verified complete report. This is one battle, with additional views of the same report. The [observation](capture-01/observation.json) separates game facts from inferred timing.

Together with the no-Infantry capture, this supports the [living-source correction](../../../reviews/renee-ahmose-lifecycle/source-gate-adoption.md). It does not settle cadence while Infantry survive. The original prospective design and forecasts below are preserved.

**Frozen before capture:** WIP fullAhmose1/1/0 with1 T6 Infantry and480 T6 Lancers attacks minxxx nohero250 T6 Infantry. One deterministic observation is planned. This follows the zero-Infantry battle's exactD11 result and tests a different question: whether initial Infantry presence allows protection to continue after the line is gone.

| Candidate | Nominal forecast |12-stat corner screen|
|---|---:|---|
|Fixed-turn protection continues after Infantry die|Attacker61 Lancers|Attacker60–62|
|No new protection without living/attacking Infantry|Attacker3 Lancers|Signed−2 to+7|

Both nominal traces have exactly two Infantry normal attacks and first show zero Infantry at the start of turn3, before the first possible fixed-turn activation on turn4. Neither a3-normal nor4-normal trigger can prime protection. Thus zero S1 contribution represents the source-dependent alternatives in this formation without stripping an effect that was already initiated before source death. Source-less fixed-turn skills generally continuing after a troop line dies is not being globally rejected; Ahmose's skill description is ambiguous about which trigger it uses.

All24 forecast stats come from the immediately preceding visually checked Ahmose1/1/0 report. Report identity, complete kits, all fresh stats and actual survivors must still be verified in the new battle. The source-death turn is a simulator inference, not a game-reported round. The large forecast separation is the endpoint discriminator; no coefficient or stat fit is planned.

The original uncaptured1I+240L/125I design remains in `protocol.json` and `prediction.json`. Its Infantry survived for three attacks, permitting an after-three-normal variant to queue protection before dying. That discovery invalidated the original zero-contribution equivalence. The larger formation and explicit death-before-third-attack guard were frozen in [protocol-v2.json](protocol-v2.json) before this capture. [prediction-v2.json](prediction-v2.json) preserves both full traces and all4096 stat corners. The corner screen is not a guaranteed interior envelope, particularly near terminal elimination where the zero-contribution model changes winning side.

Use `spec-v2.json` for capture and `predict-v2.mts INPUT_JSON NEW_OUTPUT_JSON` for an exact fresh-input replay. The original files are retained for chronology and must not be used as the current capture design.
