# Mechanics baseline, 7 September 2026

The enabled corpus contains 289 cases in 212 files: 170 simulator-deterministic and 119 stochastic. All executed without runner errors or warnings. Every case has stored game endpoints. All recorded game outcomes in this baseline are accepted evidence by Paul's 2026-09-07 clarification, regardless of folder, unless explicitly flagged invalid or obsolete. Missing images, age, and simulator mismatch do not invalidate observations. Which individual mechanics those battles exercise remains part of this audit.

On recorded inputs, **48 deterministic cases differ by more than two survivors from at least one individual game observation**. Thirteen still exceed two after the runner's automatic stat search; eleven display PASS under the runner's separate criteria. These are preserved diagnostic counts, not counts of material disagreements: Paul's clarified aim is one/two survivors for the sub-1,000 armies he usually tests, with more flexibility for larger armies. For example, 30,449 versus 30,454 is effectively equal on a roughly 30,000 scale. No fixed percentage cutoff is inferred. Four stochastic cases fail the raw distribution comparison, and all four still fail with 10,000 simulator samples under a second seed. Seventy stochastic cases have one game observation; 87 have fewer than five.

## Reproduction and artifacts

Baseline checkout: `68e2532c701a4a96caa1e8e8e1c178e7a5701f88`. Simulator source, configuration, testcase files, and the runner had no local modifications during these runs. Unrelated existing working-tree changes were preserved.

From the repository root:

```sh
npx --yes tsx scripts/run_testcases.ts --human --repeat 1000 --seed mechanics-audit-2026-09-07-baseline --workers 12 --save-snapshot --output-dir tmp/mechanics-audit-2026-09-07/baseline
```

This generated `tmp/mechanics-audit-2026-09-07/baseline/simulator_parity_2026-09-07T03-52-45.746Z.json`, with charts and individual case detail files in its sibling directory. The report started at `2026-09-07T03:51:58.353Z`. The runner discovered its existing calibration report at `simulator/testcase_results/baseline_result_2026-05-21T04-46-47Z.json`; no baseline comparison was performed.

- [audit.json](audit.json) preserves every game observation, raw and adjusted metrics, exact raw sample variance, review groups, confirmation results, and SHA-256 hashes/paths for external snapshots and detail artifacts. Variances use the sample estimator; game sample variance is null for a single observation.
- [raw-samples.json](raw-samples.json) preserves all 119,170 unadjusted baseline simulator samples: one per deterministic case and 1,000 per stochastic case. Reconstructed using the same seed and inputs; every case mean was checked against the original unadjusted summary metric.
- [deterministic_gt2.tsv](deterministic_gt2.tsv) enumerates all 48 cases, including each individual observed endpoint and error.
- [manifest.json](manifest.json) records commands, seeds, source/config hashes, disabled files, and snapshot hashes.
- [analyze.py](analyze.py) regenerates the compact audit from the immutable snapshots plus raw samples. Run `python docs/mechanics-audit/baseline/analyze.py`; an optional argument selects another snapshot directory.
- [preserve-raw-samples.ts](preserve-raw-samples.ts) shows the exact worker-based raw replay. Its original invocation was `npx --yes tsx tmp/mechanics-audit-2026-09-07/baseline/preserve-raw-samples.ts`; the durable copy has equivalent imports and writes beside itself. Running it again overwrites its raw-samples file, so preserve the baseline first when auditing later code.

The normal snapshot stores `comparisonSamples`, which contain the **adjusted** samples where a stat search occurred. They cannot recover those cases' full raw distributions. This is why the separate raw replay was necessary.

## Current runner criteria and interpretation

The signed endpoint is attacker survivors minus defender survivors. The raw absolute-error audit compares each individual game endpoint, rather than comparing only its mean. Differences greater than two are a diagnostic queue. Their materiality depends on scale and context; they are neither universal failures nor automatically attributed to a simulator mechanic defect.

`simulator/src/tooling/testcases.ts:584` overrides deterministic passes with a percentage of total initial troops: 0.2% plus 0.1% per completed ten rounds, capped at 0.7%. This is an existing runner heuristic, not a percentage tolerance specified by Paul. Read its result alongside absolute residuals and battle scale. `findGameStatAdjustment` additionally searches a one-dimensional input region: every recorded attacker attack/defense/lethality/health stat receives the same additive adjustment up to ±0.05, and defender stats receive its opposite. This is sensitivity analysis, not another captured observation.

An exact adjusted endpoint does not by itself establish a rounding explanation: that claim requires capture-specific input precision and an admissible input attaining the observation. The automatic search neither establishes the complete multidimensional envelope nor demonstrates a lifecycle discontinuity. The 35 cases moved from raw >2 to adjusted ≤2 retain both metrics; this does not require additional proof solely to accept a residual already within Paul's scale-appropriate tolerance, or reopen the outcomes' acceptance as game evidence.

Stochastic verdicts use the combined CDF/support comparison in `simulator/src/tooling/parityMetrics.ts:40`, failing when the unrounded empirical p-value is below `1/250` (0.004). There is no current automated inconclusive classification. A passing sparse sample remains limited evidence about a distribution; fewer than five observations is a capture-depth flag, not a statistical conclusion that every such case is inconclusive. Four stochastic cases produced no endpoint variation in the 1,000 raw simulator samples; those cases also cannot establish that their chance skills affect outcomes in the tested battle.

## Thirteen deterministic cases still beyond two after automatic adjustment

Positive scores mean attacker survivors; negative scores mean defender survivors. `Max error` is the largest absolute adjusted error over individual game observations. For Flint this differs materially from error against the mean.

| Case | Raw simulator | Game endpoint(s) | Adjusted simulator | Max error | Runner |
|---|---:|---|---:|---:|---|
| `s3-5000-inf-vs-1000-inf-10-lancer` | 4996 | 4573 | 4996 | 423 | FAIL |
| `Flint_tc.json#1` / `flint_tc_2` | 5761 | 5720,5756,5736,5715,5733,5736 | 5759 | 44 | PASS |
| `ahmose_solo_nc.json#0` | 2612 | 2633 | 2614 | 19 | PASS |
| `gordon_wayne_s1_extra_overlap_nc.json#0` | 1 | -19 | -6 | 13 | FAIL |
| `s15.2-secondary-heroes-1000-inf-125-lancer-125-marksman` | 835 | 851 | 839 | 12 | PASS |
| `no_heroes_t6_mixed_4` | 341 | 353 | 343 | 10 | PASS |
| `no_heroes_t6_mixed_3` | 767 | 778 | 769 | 9 | PASS |
| `no_heroes_t6_mixed_1` | 732 | 741 | 734 | 7 | PASS |
| `jessie_solo_nc.json#0` | 73 | 79,79,79 | 75 | 4 | PASS |
| `norah_s2_inf_only_B_nc.json#0` | 502 | 507,507,507 | 503 | 4 | PASS |
| `Seo-yoon_tc_nc.json#4` | 3799 | 3805 | 3801 | 4 | PASS |
| `gordon_wayne_s1_extra_overlap_lvl2.json#0` | 9 | 5 | 8 | 3 | PASS |
| `Jessie_tc_nc.json#3` | 210 | 217 | 214 | 3 | PASS |

The Gatot s3 discrepancy is large and unchanged by this stat search. The Gordon/Wayne overlap even changes the winning side on recorded inputs. Ahmose has a 21-survivor raw discrepancy despite displayed PASS. These are useful priorities for tracing recorded inputs and exercised mechanics. All accepted recorded outcomes can be used to investigate those disagreements without supporting images.

## Stochastic confirmations

Each selected file was rerun with `--repeat 10000 --seed mechanics-audit-2026-09-07-confirmation --workers 2 --save-snapshot --human`. `--matching` was its literal filename. Outputs are in `tmp/mechanics-audit-2026-09-07/baseline/confirmation-{mixed,s8-11548,s8-25000,hector-renee-wayne}`. The mixed file also executes its other five cases; they are recorded in the audit and are not treated as matched experimental controls.

| Case | Game endpoint (n=1 each) | Raw sim mean ± SD, 10k | Raw p, 1k | Raw p, 10k | Adjusted p, 10k |
|---|---:|---:|---:|---:|---:|
| `no_heroes_t6_mixed_2x_3` | -2823 | -2907.83 ±26.87 | 0.000050 | 0.002200 | 0.003550 |
| `s8-11548-t9-marksmen-vs-one-t1-fc10-infantry` | 11267 | 11353.75 ±24.56 | 0.000050 | 0.001350 | 0.001450 |
| `s8-25000-t9-marksmen-vs-one-t1-fc10-infantry` | 24929 | 24963.65 ±9.50 | 0.001100 | 0.001850 | 0.001450 |
| `hector_renee_wayne` | 1597 | 1587.99 ±2.85 | 0.002800 | 0.003150 | 0.004000* |

All four raw and adjusted 10k comparisons have `passes:false`. The mixed case's adjusted 1k comparison passed (p=0.00615), illustrating Monte Carlo sensitivity near the cutoff; it failed at 10k. These single game observations are rare under the recorded-input model, not proofs that a particular skill is wrong. Repeated equivalent live battles are the next discriminator.

*P-values are serialized to six decimals after the verdict uses the full value. Hector/Renee/Wayne's adjusted value is displayed as 0.004000 but corresponds to `80/20001 ≈0.00399980001`, just below the threshold. Do not recompute the verdict from the rounded stored p-value. The component and joint calibration each use 20,000 null samples; these finite estimates and the simulator sample seed matter for borderline results.

## Flint provenance finding

`testcases/heroes_unittests/Flint_tc.json` contains two captures dated **20 July 2025**. Both record defender Flint at 4/4/4 and only T6 troops. For tc2 the six game survivors range 5715–5756, with sample variance 207.8666667 (SD 14.418); the current hydrated simulator contains no chance skill and predicts exactly 5761. The file supplies one fixed input object, no per-observation input/capture references, and no explanation of the observed variation. The other entry's game defenders are 150,151,149,149,150; this is also varying evidence compared with a deterministic model, though within two of its raw endpoint.

The two active Flint records remain accepted game evidence: neither has an explicit invalid or obsolete flag. A comment about a deleted sibling does not invalidate them.

The current config makes Flint's three expedition skills deterministic battle-start bonuses. Hydration correctly reflects that config; this audit found no classifier malfunction. The stored `sim_skills_used` values are old simulator diagnostics and must not be treated as game activation counts.

There is a strong **stale-era provenance warning**: commit `c955f1ec80707691c1a12527c589727a3e5777ef` (17 April 2026, `data(testcases): drop 3 stale flagged entries (WOS-138)`) deleted a third sibling from this same July-2025 file. Its commit message explicitly attributes that sibling to a Flint rework from a probabilistic Pyromaniac DoT to a permanent infantry damage bonus. It retained these first two observations. That rationale is repository history, not independently verified proof of the exact live rework date/mechanic; an unexplained change of inputs also cannot be excluded from this file alone.

The later `emulator_verified/flint_solo_nc.json` uses a complete 2/2/1 kit and records 2862 attacker survivors versus the present raw 2859 (automatic variant 2861). July-2026 cached skill captures also show minxxx at 2/2/1 and WIP at 1/1/0, rather than the legacy 4/4/4. Its single later observation supports investigating current behavior, but does not explain the older six-observation spread or independently validate every skill.

Recommended treatment: retain the old observations with this provenance caveat, do not use their variance to change current Flint mechanics, and obtain current complete-kit evidence with known inputs. Exact current availability should come from the separate live audit. No testcase, simulator config, or combat code was changed by this baseline work.
