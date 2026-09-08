# Hendrik report-stat recheck

Rechecked both saved attacker-view `report_stats.png` images against the current fixtures on 2026-09-08. All 24 displayed bonuses match in both battles. Hendrik's Marksman Attack/Defense/Lethality/Health are 465.5/458.7/244.0/218.8. These are report-resolved bonuses; no extra hero-generation stats were added. This is saved game evidence, not a new live capture or a check of today's account state.

The current-engine [replay](stat-precision.mts) and [full results](stat-precision.json) preserve inputs, config, source hashes, nominal traces and 563 shared stat vectors per battle: nominal, opposing favorable/adverse corners, each coordinate at either endpoint, and 512 interior samples. Outcomes were already known. This is a sensitivity screen, not an exhaustive interval proof. Runtime/config and fixture stability checks passed.

| Battle | Game defenders I/L/M | Current, favorable and adverse corners | Sampled total range |
| --- | --- | --- | --- |
| 250M versus 400I/100L/100M | 313/82/76 = 471 | 314/84/78 = 476 | 476 |
| 250M versus 150I/60L/60M | 16/31/21 = 68 | 19/34/25 = 78 | 78 |

The favorable corner adds 0.05 percentage points to every attacker stat and subtracts 0.05 from every defender stat. The first battle lasts 20 rounds throughout the screen; the second lasts 31 or 32, never the 33-35 implied by the observed S2/S3 counts under ordinary schedules. Every outgoing job in both nominal traces was checked against the report inputs for source Attack/Lethality and recipient Defense/Health.

All three defending lines survive both nominal traces and the game reports. Therefore Hendrik has no target exhaustion or overkill to redistribute in these battles. Retargeting or outgoing damage spillover cannot supply this missing damage. The simulator caps damage at the available target and does not redistribute excess.

Paul's supplied testcase-runner output independently confirms its +0.05 adjustment retained predictions 476 and 78. Stat rounding is already tested and does not explain these residuals. No production rule or input was changed by this recheck.
