# FC troop skills and Volley: accepted-fixture review

**Four skills gain bounded positive support; Volley remains unresolved.** All recorded game outcomes are accepted evidence by Paul's instruction, regardless of folder, unless explicitly invalid or obsolete. None of these twelve selected fixtures has such a flag. This is a retrospective comparison against already known outcomes, with exact troop/FC keys, report stats and complete hero kits preserved. It creates no game observations and changes no combat code.

This replay uses the adopted fractional outer army term. The preceding baseline and initial troop review retain their original engine results. Scores are attacker survivors minus defender survivors. Every ± below is simulator **per-battle sample SD**, not uncertainty in the mean. The runner's raw distribution threshold is p < 0.004; compatibility is not proof of a unique mechanism.

| Skill | Positive evidence | Remaining limit |
| --- | --- | --- |
| CrystalShield | FC5 no-hero mixed battle, 13 game observations: current p=0.522674; omit skill p=0.000100; change level-2 proc 37.5%→25% or use raw shield 36 each p=0.000050. | Supports protection and current model over these alternatives in this full troop kit. Does not uniquely identify all denominator grouping, exact probability, incoming skill-kind behavior, consumption or FC3 level 1. |
| BodyOfLight | FC9 Infantry/Gatot: current p=0.274036 at 10k; omit only +4 Defense p=0.001550. Removing both effects fails in both reviewed FC9 cases. | Positive Defense contribution is supported. Removing only conditional CrystalShield reduction remains plausible; that branch, +6/+15 level 2, exact buckets and FC8 boundary remain unreviewed. |
| CrystalLance | Six T9 versus T1 FC10 Lancer cases: current p=0.417979–0.939603; omit CrystalLance p=0.000050 in every case. | Supports positive Lancer offensive contribution with IncandescentField retained. Does not uniquely identify separate skill-job delivery, 100% coefficient, 15% proc, lower level or exact gate. |
| IncandescentField | Across the same six distinct setups, current combined p=0.728733; omit field p=0.000460, conditional on independent battle RNG and recorded inputs. | Every individual n=1 case alone remains compatible with omission. Combined inference is retrospective and assumption-dependent; it does not distinguish +100% Defense from other half-damage implementations, or establish FC8 level 1/consumption. |
| Volley | The 33,452 case agrees; omitting Volley leaves the defender alive at the simulation cap in all 1,000 runs of each reviewed setup. | The 11,548 and 25,000 cases still fail. Separate skill-job delivery does not repair them. Cap-limited omission is a conditional diagnostic, not a measured zero-survivor game outcome or sufficient independent confirmation of Volley. |

## CrystalShield: thirteen observations

Fixture: `testcases/4-testcases_no-heroes_infantry_fc5.json#0` (`Nitro_Beast_30_1`). Attacker: 50,000 `infantry_t10_fc5`. Defender: 6,450 `infantry_t10`, 7,525 `lancer_t10`, 30,105 `lancer_t9`, 7,525 `marksman_t10`, 30,105 `marksman_t9`. No heroes; defender Ambusher and Volley remain active.

Stored scores: −45772, −42784, −44207, −47019, −46631, −44760, −47180, −44639, −46574, −45094, −45641, −45844, −42118.

| Candidate, 1,000 sims each | Mean ± SD | Raw p |
| --- | ---: | ---: |
| Current 37.5%, percentage denominator reduction | −45012.15 ±1497.06 | 0.522674 |
| Remove CrystalShield | −51054.65 ±1220.38 | 0.000100 |
| Only change level 2 probability to 25% | −47226.78 ±1352.85 | 0.000050 |
| Only change reduction bucket to raw post-subtract shield 36 | −48274.19 ±1267.98 | 0.000050 |

The first current trace applies CrystalShield to normal attacks from all three enemy classes. This supports contextual Infantry protection against that mixed army; trace contents identify modeled contribution, not separate observed in-game activations. No other bucket family was compared.

## BodyOfLight: distinguish the two effects

Exact fixtures are `testcases/gatot_verified/s4-fc9-gatot-90000.json#0` and `testcases/gatot_verified/s5-fc9-gatot-lumak-90000.json#0`. Both compare T11 FC9 and T10 FC9 Infantry with full recorded Gatot kits; the second also retains the recorded attacker Lumak kit. BodyOfLight is level 1: +4 Defense and conditional +10 reduction.

| Fixture / game | Current, 1,000 sims | Omit both p | Omit Defense p | Omit conditional p |
| --- | --- | ---: | ---: | ---: |
| s4 / +83565 | +83402.39 ±218.52; p=0.559772 | 0.000050 | 0.002400 | 0.063447 |
| s5 / +86767 | +86783.84 ±145.47; p=0.967802 | 0.000050 | 0.010649 | 0.388531 |

Independent 10,000-sim confirmation of the borderline s4 Defense result gives current **+83394.94 ±218.27, p=0.274036** versus omitted Defense **+82857.93 ±227.13, p=0.001550**. All 40k confirmation samples across the four selected candidates finished with attacker wins; none reached the round cap. Defense contribution is supported in this combined normal-attack context. The conditional branch must not be promoted from the stronger whole-skill omission result.

## CrystalLance and IncandescentField: six different setups

Exact keys follow `testcases/gatot_verified/s9-<N>-t9-lancers-vs-146-t1-fc10-lancers.json#0`, with N listed below. The input is **`lancer_t1_fc10`**, not T11. Current FC hydration depends on FC independently of tier, and these cases exercise level 2 of both skills. The stored stat changes between 2,200 and 2,201 were preserved.

| N / game | Current mean ± SD / p | Omit CrystalLance mean / p | Omit IncandescentField mean / p |
| --- | --- | --- | --- |
| 1500 / −85 | −85.16 ±4.20 / 0.939603 | −74.58 / 0.000050 | −79.50 / 0.195590 |
| 1950 / −45 | −46.82 ±7.21 / 0.620269 | −22.90 / 0.000050 | −34.65 / 0.204240 |
| 2100 / −37 | −25.57 ±23.80 / 0.417979 | +238.51 / 0.000050 | +48.20 / 0.255337 |
| 2200 / −20 | +43.38 ±108.36 / 0.684916 | +482.68 / 0.000050 | +278.14 / 0.030248 |
| 2201 / +1233 | +1229.14 ±59.49 / 0.452677 | +1372.22 / 0.000050 | +1311.52 / 0.115344 |
| 3000 / +2201 | +2208.81 ±52.76 / 0.856057 | +2318.49 / 0.000050 | +2271.29 / 0.108445 |

CrystalLance omission is separated in every setup. IncandescentField omission is not individually rejected, but all six residuals shift in the same direction. [The combined comparison](incandescent-combined.json) sums standardized signed endpoint residuals using each setup's own model mean/SD. It draws one independent predicted endpoint per setup 100,000 times, using Python RNG seed 202609071 and add-one two-sided tails. This gives current sumZ=−0.85845, p=0.728733; omission sumZ=−8.80507, p=0.000460.

This assumes independent battle RNG conditional on the six recorded inputs. It does **not** treat different setups as repeated samples of one distribution, remove unusual observations, or correct for adaptive historical case selection. Shared input error or model misspecification is an alternative explanation; positive support is limited to the joint conditional contribution.

## Volley: two disagreements remain

Exact keys follow `testcases/gatot_verified/s8-<N>-t9-marksmen-vs-one-t1-fc10-infantry.json#0`. Preserve the full recorded Gatot kit and `infantry_t1_fc10` protection. The delivery alternative changes only Volley from a 100% normal-job damage buff to a separate 100% skill attack against the trigger target, retaining the 10% attack proc.

| N / game | Current, 1,000 sims | Separate skill-job alternative |
| --- | --- | --- |
| 11548 / +11267 | +11334.74 ±359.57; p=0.001300 | +11334.89 ±359.58; p=0.001100 |
| 25000 / +24929 | +24962.76 ±9.50; p=0.006500 | +24969.63 ±7.52; p=0.000050 |
| 33452 / +33427 | +33427.31 ±6.89; p=0.988201 | +33430.85 ±5.90; p=0.502475 |

The independent 10k confirmation resolves the borderline 25,000 result: current **+24962.99 ±9.40, p=0.001350**; separate-job **+24970.03 ±7.46, p=0.000050**. All samples win before the cap. The earlier baseline also rejected 11,548 and 25,000 at 10k; its original engine/samples remain in the baseline package.

The 11,548 screen includes one score 0 in each delivery candidate. [Exact seed replay](round-limit-verification.json) confirms both are draws at round1,500, with11,268 Marksmen and one opposing Infantry surviving. Every omitted-Volley screen sample is 0. First traces reach 1,500 rounds with the one Infantry still alive and attacker survivors 11,268 /24,720 /33,172 respectively. The draw mass is retained in the raw distribution; no conditioning on winners or dropping cap samples was performed. This limits the omission comparison and explains the unusually large 11,548 screen SD. There is no causal basis here to change Volley or blame a particular FC/Gatot effect.

## Reproduction and integrity

Run from the repository root:

```sh
npx --yes tsx docs/mechanics-audit/reviews/fc-troops/replay.mts /absolute/new-results.json 1000
npx --yes tsx docs/mechanics-audit/reviews/fc-troops/confirm.mts /absolute/new-confirmation.json
python docs/mechanics-audit/reviews/fc-troops/incandescent-combined.py
npx --yes tsx docs/mechanics-audit/reviews/fc-troops/verify-round-limit.mts
```

[results.json](results.json) stores all 39,000 raw screen samples, exact inputs/outcomes, fixture hashes, source hashes and first-sample diagnostics. [confirmation.json](confirmation.json) adds 40,000 independent samples. Screen seed is `fc-troop-evidence-review-2026-09-07:<test_id>#<replicate>`; confirmation seed is `fc-troop-evidence-confirmation-2026-09-07:<fixture-key>#<replicate>`. Both use four workers. The Python command exactly verifies the saved combined comparison; an optional output path writes a new artifact without replacing the original.

The frozen [config-snapshot.json](config-snapshot.json) and recorded 29 source hashes identify the replayed model. Troop definition SHA256 is `c777e710ab1e7e58b64d23e6545e2eb76ef12fa9afb83dd45a88c59ef191e8ba`. The screen refuses changed config, pre-existing output, or source changes during execution; new source versions are recorded as a new retrospective replay. Confirmation additionally refuses any change from the screen's engine hashes. Counterfactuals are simulator predictions, never game evidence.

CrystalGunpowder and FlameCharge still have no active fixture and receive no positive annotation. These conclusions do not validate exact tier/FC boundaries, mixed-tier inheritance or every component of any full kit merely because it hydrates.
