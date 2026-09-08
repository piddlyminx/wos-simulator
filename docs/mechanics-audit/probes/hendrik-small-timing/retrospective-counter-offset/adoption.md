# Hendrik S3 phase adoption — 2026-09-07

Production now starts Hendrik's DragonsHeir on turn2, then every3 turns. **Only that `trigger.first` field changed.** [Adoption verification](adoption.json) proves the full loaded configuration equals the frozen configuration plus that single field; ArmorOfBarnacles and all29 runtime sources are unchanged. Current Hendrik definition SHA256 is `fc16f4c3883a71fc6c3eb5ec3fb7bc7c2daf88cde21b35220720a34fc769e440`.

The focused production runner (`--matching hendrik`) executed all four accepted Hendrik fixtures with zero errors/warnings. Their raw outputs, per-side survivors, winner and modeled round count exactly match the frozen S3-first2 candidate. All recorded input values and survivor observations remain unchanged.

| Accepted battle | Game | Current production | Raw remaining disagreement |
| --- | --- | --- | --- |
| Full333 Lancer probe |D17 |D17 |None |
| Full333 Marksmen versus400I/100L/100M |D471:313/82/76 |D471:313/82/76 |None in survivors |
| Full333 Marksmen versus150I/60L/60M |D68:16/31/21 |D71:16/32/23 |Total+3; per-line0/+1/+2 |
| Historical Renee444/Hendrik100 |A14 |A14 |None; S2/S3 inactive |

The small battle remains slightly outside the usual1–2 total survivor aim. Its frozen displayed-stat sensitivity range was70–71. The runner displays four PASS labels because its best-effort0.05 stat adjustment gives comparison70 for this case; the **unadjusted prediction remains71**. [Runner verification](runner-verification.json), [console output](adoption-run.log) and complete [saved artifacts](adoption-run/) retain both representations. An adjusted label is not evidence that the raw residual vanished.

The old positive Marksman report still records S3 six activations versus modeled seven. The new report's S2/S3 counts8/11 match production. A blanket terminal-activation exclusion rule is unsupported: both S3-only modeled battles have a terminal S3 activation, while the new report records all11. Actual game round counts are unknown. Reporting and final-attack timing remain unresolved; per-line survivor agreement does not certify these behaviors.

S2 retains first4/every4 with a two-turn window. The retrospective shared-offset alternative exchanged1–2 troop residuals between captures and did not independently justify moving S2. Its original Lancer-scope evidence remains valid, with exact phase/grouping uncertainty retained. The source-count ceiling and fractional survivor state remain unchanged.

The parent reports all212 simulator tests and typecheck passed after adoption. This focused check independently verifies all four current raw outcomes and complete configuration/runtime equality except the intended S3 field. [verify-adoption.mts](verify-adoption.mts) records the current hashes and preserved frozen-artifact hashes. Original forecasts, retrospective definitions, configs, results and source hashes were not rewritten. This adoption does not claim every Hendrik mechanic or all simulator disagreements are resolved.
