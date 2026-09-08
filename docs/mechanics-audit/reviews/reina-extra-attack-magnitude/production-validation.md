# Production validation after the Reina correction

The five new full-kit Reina 1/1/1 observations are compatible with the corrected model: defender survivors **166,163,163,157,174**, mean **164.60**, sample SD **6.19**. The fresh 1,000-run simulator sample has mean **162.725**, SD **6.521**, central 95% interval **149–175**, and combined CDF/support **p=0.632618**. All five outcomes lie in that interval; each distinct observed value also occurs in the simulator sample. Five observations support this formation's endpoint distribution without establishing every interaction or higher-level battle behavior. The actual skill description/upgrade preview chooses the 120/140/160/180/200 curve; the battle outcomes alone do not uniquely distinguish it from every stronger alternative in the frozen diagnostic.

The fresh corpus run completed **296 cases without warnings or errors**, with 176 deterministic and 120 stochastic rows. All **174 shared deterministic cases have identical per-troop survivors** to the after-rounding snapshot. The three added cases are Reina, Hendrik S3 and Gwen's small timing probe. No older shared fixture configures Reina S3 above zero, so their agreement is a regression check, not positive coverage of the corrected coefficient. The two runs use different seeds; differences between unchanged stochastic cases cannot be attributed to the Reina edit.

| Diagnostic | After rounding | After Reina |
|---|---:|---:|
| Raw deterministic rows with any recorded score error>2 |23|25|
| After the runner's optional stat adjustment, error>2 |8|10|
| Raw stochastic combined-p flags |3|4|
| Runner reported failures, including its adjustments |4|8|

These counts use **A−D even for draws** and retain every recorded observation. **Error>2 is a diagnostic, not a universal material disagreement.** One or two troops is the aim for usual sub-1,000 armies; larger armies allow more flexibility without an invented fixed percentage. Runner stat adjustments do not erase the raw residual. [All 25 deterministic residual rows](deterministic-residuals.tsv) include exact fixture keys, initial army sizes, every outcome, raw and adjusted endpoints.

The clearest remaining deterministic issues include:

- **Gwen small timing, 550 vs900:** simulator attacker 76 versus game defender 24, a 100-troop signed difference and opposite winner. Earlier Gwen captures remain defender 534 vs 563 (800 vs1,400), and 1388 vs 1397 (800 vs1,800). These remain unresolved; current skill description capture is intended to guide the next causal diagnosis.
- **Gatot s3-5000-inf-vs-1000-inf-10-lancer:** attacker 4996 vs 4573, a 423-troop residual at 5,000 vs1,010. This accepted outcome remains a substantive disagreement needing its own causal review.
- **Gordon/Wayne overlap:** defender 3 vs 19 at 260 vs1,000; the adjacent level 2 case is attacker 8 vs 5. **Hendrik S3:** defender 476 vs 471 at 250 vs600. These residuals are preserved rather than silently removed by a broad tolerance.
- **Flint_tc.json#1:** deterministic simulation attacker 5762, while six accepted outcomes range 5715–5756 at 7,000 vs200. The varying recorded outcomes require a classification/input-provenance investigation; do not infer invalidity from their age or mismatch. The other varying deterministic fixture is retained in the JSON.

Four raw stochastic comparisons are flagged at the runner's combined **p<1/250** threshold:

| Exact fixture key | Game A−D | Sim mean / SD | Raw p, previous→fresh |
|---|---:|---:|---:|
|`testcases/3-testcases_mixed-heroes-not-verified.json#2`|−2823|−2909.27 /26.07|0.0008→0.00085|
|`testcases/emulator_verified/hector_renee_wayne.json#0`|1597|1588.11 /2.88|0.00595→0.0027|
|`testcases/gatot_verified/s8-11548-t9-marksmen-vs-one-t1-fc10-infantry.json#0`|11267|11346.51 /24.77|0.00125→0.00215|
|`testcases/gatot_verified/s8-25000-t9-marksmen-vs-one-t1-fc10-infantry.json#0`|24929|24963.27 /9.12|0.00005→0.0015|

Each has only one recorded game observation. The Hector/Renee/Wayne threshold crossing is an existing borderline tail concern under a new Monte Carlo seed. Both Gatot comparisons retain their large-army context and simulator variance: a small relative troop difference can still be an unlikely tail under the modeled distribution, but a single tail observation and finite sampling do not identify the defective mechanic. The 11548 game is a draw with 11268 attackers and 1 defender, hence score 11267. This extraction agrees with production scoring; separate older Volley counterfactuals that mapped draws to zero are being corrected independently. Passing stochastic rows with sparse game samples also do not prove full mechanic coverage.

The preserved snapshots are:

- `tmp/mechanics-audit-2026-09-07/after-rounding/simulator_parity_2026-09-07T05-00-35.153Z.json`: workers 12, repeat 1000, seed `mechanics-audit-2026-09-07-after-rounding`, includeSamples=true.
- `tmp/mechanics-audit-2026-09-07/after-reina/simulator_parity_2026-09-07T06-10-29.116Z.json`: workers 12, repeat 1000, seed `mechanics-audit-2026-09-07-reina-fixed`, includeSamples=true.

[production-validation.json](production-validation.json) records both summary hashes, every referenced detail hash, raw/adjusted comparisons, exact deterministic vectors, and the full 1,000 unadjusted Reina scores. Its `comparisonSamples` array contains the full sample; the runner's similarly named `simulatorSampleDeltas`/`simulatorSampleOutcomes` retain only 10 examples. Reproduce this read-only extraction with `python docs/mechanics-audit/reviews/reina-extra-attack-magnitude/validate-parity.py`. The original prospective/retrospective protocol, results and old snapshots are unchanged.
