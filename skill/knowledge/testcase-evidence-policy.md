# Testcase Evidence Policy

## Read This When

Read this before collecting emulator testcase observations or deciding whether simulator output matches a captured game result.

This document owns the capture-count and parity-acceptance policy. Other workflow documents should link here rather than restating the rules.

## Accepted Game Evidence

All recorded game outcomes are accepted evidence regardless of testcase folder, unless explicitly flagged invalid or obsolete, as Paul clarified on September 7, 2026. Report images are not required to accept existing outcomes. Preserve available images for new captures. Missing images, age or simulator disagreement alone do not invalidate an observation.

## Determine Whether The Testcase Is Stochastic

Use the hydrated simulator skills to classify the testcase. A testcase is stochastic when an applicable hydrated skill contains a chance trigger. The filename is not evidence of determinism; do not add `_nc` to testcase filenames as a classification mechanism.

## Emulator Capture Count

- Capture a deterministic testcase once.
- Capture a stochastic testcase five times by default.
- Capture more than five stochastic observations when the outcome variance is high enough that five observations do not characterize it usefully.

These counts apply to emulator observations collected with `wosctl run-testcase`. They do not limit the TypeScript testcase runner: simulator sampling is cheap and may use a much larger `--repeat` value for stochastic comparisons.

Preserve every captured observation under `game_report_result`; do not replace the observations with only their mean.

## Deterministic Parity

Compare the winning side and survivor count. Unless a testcase explicitly defines another primary result, use the signed remaining-troop result. Also preserve both sides' survivor counts when a battle reaches the round limit; a score of zero need not mean both armies were eliminated.

Paul clarified the practical accuracy target on September 7, 2026:

- For the usual armies below 1,000 troops, aim for agreement within roughly 1–2 survivors. An identified rounding explanation is not required to accept that tolerance.
- Allow more flexibility for larger armies. For example, 30,449 versus 30,454 survivors on a 30k scale is effectively equal, and that gap alone is a weak basis for choosing a mechanic.
- The shared [audit README](../../docs/mechanics-audit/README.md) also gives 0.1% of combined initial troops as an accuracy aim and investigation diagnostic. It explicitly does not make that percentage a universal hard failure or a percentage PASS sufficient evidence.
- Judge a residual in context: absolute difference, army scale, winning side, sensitivity to recorded inputs, and whether the discrepancy would change the mechanic conclusion. There is no universal percentage cutoff or rigid absolute threshold for every army size.

Raw errors above 2 and the runner's percentage-based PASS flag are diagnostics, not final materiality judgments. Prefer small, informative probes with a substantial separation between competing predictions. Do not declare alternatives distinguishable merely because narrow fixed tolerance bands do not overlap.

Battle Details values such as skill activations and source-attributed kills are diagnostic views of the same battle trajectory, not independent observations. They can locate a discrepancy or corroborate a mechanism, but cannot bypass a material endpoint mismatch. Preserve unexplained differences even when the endpoint is close enough for practical agreement; matching a combined full kit does not identify every individual component.

When input uncertainty is a plausible explanation, identify the uncertain input and its supported interval (for example a one-decimal report stat within displayed ± 0.05), and report the resulting simulator sensitivity separately from the nominal forecast. Preserve every varied input, the range of outcomes, and any changes in final round, troop-line exhaustion, target schedule or integer source count. Reaching the observed endpoint inside that supported region is useful compatibility evidence; it is not a measured input or proof of the mechanic.

Checking only interval corners does not establish the complete envelope when a battle is non-monotonic. Establish a valid dominance argument or inspect relevant interior combinations. A state discontinuity found only outside a plausible input interval does not explain the recorded battle. Do not silently adjust stats or replace observations with fitted values.

| Comparison | Interpretation |
|---|---|
| Exact endpoint, or roughly 1–2 survivors for a sub-1,000 army | Practical deterministic agreement in the exercised context |
| Small residual at a larger scale, such as 5 out of 30k | May be practically equivalent; retain the numeric residual and do not overclaim discrimination |
| Material residual reached by a supported input sensitivity | Input-compatible result; retain nominal mismatch and sensitivity evidence |
| Material residual unexplained by recorded inputs or supported sensitivity | Unresolved deterministic disagreement |
| Battle Details agrees while a material endpoint mismatch remains | Diagnostic support only; affected mechanic conclusion remains unresolved |

### Terminology For Battle Boundaries

Keep these distinct:

- **Terminal elimination:** the last surviving enemy troop line is killed and the battle ends. This is the ordinary win condition for most conclusive battles; it is not a target-exhaustion anomaly.
- **Final-round boundary:** a small input change makes terminal elimination occur one round earlier or later. The extra incoming or outgoing work in that round can create a discontinuous survivor change.
- **Troop-line exhaustion:** one troop type reaches zero while other enemy troop types remain.
- **Target exhaustion:** in a mixed-unit battle, an attack is locked to a troop line, an earlier same-round attack exhausts that line, and a later scheduled attack still points at the now-empty target. The later attack may be skipped or retargeted depending on the mechanic. This does not occur merely because a single-line battle ends by terminal elimination.

When guidance says to avoid target exhaustion in a rounding experiment, it means to avoid this mixed-target scheduling confound unless it is the subject of the experiment. It does not mean that a useful testcase must avoid the normal win condition.

### Worked Interpretation

Suppose a deterministic single-line battle reports 883 survivors and 39 rounds, while the simulator gives 892 survivors and 38 rounds. If plausible report-stat sensitivity gives only 891–894 survivors and always 38 rounds, the eight- or nine-survivor residual is not tolerable: the observed endpoint and final-round transition were not attained. A matching-looking skill-kill subtotal from that battle does not rescue the mechanic conclusion because it is another view of the same unresolved casualty trajectory.

## Stochastic Parity

Evaluate stochastic testcases as distributions rather than exact endpoints. Preserve and report the individual game observations and simulator samples, including their mean and variance. Increase emulator captures beyond five when the observed variance makes the comparison inconclusive.

## Evidence Categories

Keep these distinct in reports and investigation notes:

- captured game observation
- current simulator result
- simulator sensitivity or counterfactual result

Do not present a sensitivity result as a captured game result or as proof of a mechanic by itself.
