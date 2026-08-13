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

A deterministic testcase should produce exactly the same endpoint in the game and simulator.

A difference of one or two surviving units may be treated as matching when it is attributable to rounding.

A larger error may be treated as matching only when all of the following are true:

- the absolute error is still very small
- simulator sensitivity runs show that small, plausible input variations materially affect the endpoint
- the observed game result is attained by one of those small input variations

When using this exception, record the varied input, its magnitude, and the simulator endpoint that attains the observation. A small percentage error by itself is not sufficient, and a generic percentage-based `passes` flag does not establish deterministic parity.

## Stochastic Parity

Evaluate stochastic testcases as distributions rather than exact endpoints. Preserve and report the individual game observations and simulator samples, including their mean and variance. Increase emulator captures beyond five when the observed variance makes the comparison inconclusive.

## Evidence Categories

Keep these distinct in reports and investigation notes:

- captured game observation
- current simulator result
- simulator sensitivity or counterfactual result

Do not present a sensitivity result as a captured game result or as proof of a mechanic by itself.
