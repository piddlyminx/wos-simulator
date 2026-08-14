# Testcase Evidence Policy

## Read This When

Read this before collecting emulator testcase observations or deciding whether simulator output matches a captured game result.

This document owns the capture-count and parity-acceptance policy. Other workflow documents should link here rather than restating the rules.

## Determine Whether The Testcase Is Stochastic

Use the hydrated simulator skills to classify the testcase. A testcase is stochastic when an applicable hydrated skill contains a chance trigger. The filename is not evidence of determinism; do not add `_nc` to testcase filenames as a classification mechanism.

## Emulator Capture Count

- Capture a deterministic testcase once.
- Capture a stochastic testcase five times by default.
- Capture more than five stochastic observations when the outcome variance is high enough that five observations do not characterize it usefully.

These counts apply to emulator observations collected with `wosctl run-testcase`. They do not limit the TypeScript testcase runner: simulator sampling is cheap and may use a much larger `--repeat` value for stochastic comparisons.

Preserve every captured observation under `game_report_result`; do not replace the observations with only their mean.

## Deterministic Parity

A deterministic testcase should produce exactly the same endpoint in the game and simulator. Unless a testcase explicitly defines another primary result, the endpoint is the signed remaining-troop result: which side survives and how many troops remain.

Battle Details values such as skill activations and source-attributed kills are diagnostic views of the same battle trajectory. They can help locate a discrepancy, but they are not independent observations and must not be used to bypass an unexplained endpoint mismatch. For example, a skill's attributed kills looking close does not establish that skill's mechanic when the same deterministic battle has the wrong survivor count or round count.

A difference of one or two surviving units may be treated as matching when it is attributable to rounding.

A larger error may be treated as matching only when all of the following are true:

- the absolute error is still very small
- the uncertain input and its plausible interval are identified from the capture, such as a one-decimal report stat lying within `displayed ± 0.05`
- simulator sensitivity runs show that this plausible input region reaches a discrete battle-state boundary, such as a different final round, troop-line exhaustion round, target schedule, or integer source-count state
- the observed game endpoint is attained by an input inside that plausible region

The exception is about demonstrated boundary sensitivity, not general closeness. Smoothly moving the result by one troop, finding a discontinuity only outside the plausible input interval, or merely observing that battles can be discontinuous is insufficient.

When using this exception, record:

- the displayed baseline input and endpoint
- every varied input and its allowed interval
- the boundary location and the lifecycle change across it
- an in-range input that attains the exact observed endpoint

Checking only the interval corners does not establish the complete envelope when the battle is non-monotonic. Either establish a valid dominance/monotonicity argument for this testcase or also inspect the relevant interior combinations.

A small percentage error by itself is not sufficient, and a generic percentage-based `passes` flag does not establish deterministic parity. If the observed endpoint is not attained under the requirements above, classify the case as an unexplained deterministic mismatch and do not use it to confirm the mechanic whose prediction depends on that mismatch being understood.

Use this decision table:

| Comparison | Classification |
|---|---|
| Exact endpoint, or one/two units with an identified rounding cause | Deterministic match |
| Larger small residual; plausible input interval straddles a state discontinuity; an in-range input attains the exact observation | Boundary-compatible match; record the sensitivity evidence |
| A nearby or in-range discontinuity exists, but no tested in-range input attains the observation | Unresolved deterministic mismatch |
| The required discontinuity or exact observation appears only outside the plausible input interval | Deterministic mismatch |
| Battle Details attribution agrees while the survivor endpoint remains mismatched | Diagnostic agreement only; mechanic conclusion remains unresolved |

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
