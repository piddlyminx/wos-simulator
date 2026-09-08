# Hector and Gordon: contribution, scope and bucket review

Five skills receive bounded contextual support from 13 accepted full-kit fixtures containing 25 game observations. The strongest evidence distinguishes both Rampant class branches and decay, Blitz activation beyond Infantry, and Gordon S1's normal-damage bucket. SurvivalInstincts and ChemicalTerror have positive contribution evidence, but the tested broader protection/debuff scopes remain unestablished. Existing combined-hero disagreements are preserved below.

This is a retrospective review: outcomes were known before selecting structural alternatives. Exact recorded troop/FC keys, resolved stats, hero levels and complete companion kits remain fixed. There was no live action, stat adjustment, coefficient fitting or production edit. The frozen current config includes the adopted fractional army term, retained inner source ceiling/fractional casualties, corrected Reina magnitudes and Hendrik S3 `first=2`. Gordon S3 stays configured throughout and is outside this batch.

Seven fixtures are stochastic after hydration; six are deterministic. Each stochastic candidate has 1,000 complete simulator rows, while deterministic candidates run once. All 76,060 rows preserve both side totals, per-class survivors and rounds. Scores are A−D, including draws; no sampled battle drew. `summarize.py` verified all row totals, means, SDs, sample hashes and duplicate current samples across workers. Every frozen source digest matched before and after execution and extraction.

## Hector: strongest repeated evidence

All three skills occur in six fixtures/14 observations. Hydrated levels are S1 2/3/4, S2 3/4, S3 2/3/4. Main heroes occur on both sides; joiners and widget gates are untested.

`testcases/emulator_verified/hector_solo.json#0` has full Hector 3/4/3 defending with 200 of each T6 class against 1500I/1069L/1500M. Game defender outcomes are **402,409,373,403,385**, mean394.4, sampleSD14.93. Current mean386.602/SD23.785 is plausible (combined p0.991), with central95%326–410. Five outcomes do not tightly determine the distribution.

| Selected skill / change | Defender mean | SD | Raw combined p |
|---|---:|---:|---:|
|SurvivalInstincts omitted|219.789|50.430|0.00005|
|SurvivalInstincts Infantry-only recipients|384.984|26.091|0.936653|
|Rampant omitted|291.379|44.691|0.00005|
|Rampant Infantry branch omitted|345.432|36.766|0.0014|
|Rampant Marksman branch omitted|346.654|36.516|0.00185|
|Rampant decay removed; original values and 10 uses retained|412.075|5.138|0.00005|
|Blitz omitted|27.715 signed defender margin|186.116|0.00015|
|Blitz restricted to Infantry source|165.968|85.834|0.00005|

Blitz omission produces mixed simulated winners; its signed defender margin is D−A, with attacker victories contributing negative scores. It is not the mean count of surviving defenders. The complete A,D rows remain available.

The independent full-kit `testcases/emulator_verified/norah_hector_zinman_combo.json#0` has Hector 3/4/4+Norah 1/1/0+Zinman 1/0, defending with 100 of each T6 class against 400 each. Game defender outcomes **270,271,269,270,272**, mean270.4/SD1.140, agree with current269.491/SD1.367 (p0.334433). Rampant Infantry omission267.566, Marksman omission267.451 and no-decay272.752 each fail the combined distribution diagnostic (p0.0002/0.00015/0.00015). Blitz Infantry-only gives265.188, p0.00005; omission263.828, p0.00005. These repeated contexts support both Rampant class contributions, a diminishing boost versus none, and Blitz activation beyond Infantry. They do not uniquely determine the exact 15% decrement, 10-use boundary, whether generated jobs consume uses, every class coefficient, 25% proc probability or skill-versus-normal delivery.

SurvivalInstincts omission gives266.334 (p0.00025) in that second repeated fixture, but Infantry-only gives precisely the same samples as current. This same equality holds in five of six fixtures; the solo fixture's small difference does not distinguish the scopes. Traces show occasional Lancer protection in the solo fixture but almost all protection on Infantry. That is simulator execution, not independent positive game evidence for backline protection. The ledger therefore records contribution only for S1 and leaves scope unreviewed.

The remaining four Hector fixtures are retained rather than selectively discarded:

| Fixture key | Game outcome | Current prediction | Limit |
|---|---|---|---|
|`testcases/3-testcases_mixed-heroes-not-verified.json#5`|D2295|D2271.689/SD9.702, p0.017549|One tail observation, mixed Hector/Philly/Greg vs Alonso/Mia/Logan. No-decay improves this single point, but fails both repeated fixtures.|
|`testcases/emulator_verified/hector_patrick_combo.json#0`|D590|D590.774/SD0.685, p0.724664|Omitting S1 or S3 remains plausible; weak individual discriminator.|
|`testcases/emulator_verified/hector_renee_wayne.json#0`|A1597|A1588.164/SD2.904, p0.0074|Existing high-tail discrepancy remains. Earlier seeds crossed the runner threshold; this seed passing does not resolve it. Rampant no-decay improves this point but is disconfirmed by repeated fixtures.|
|`testcases/heroes_unittests/Hector_tc.json#0`|D441|D442.495/SD5.033, p0.728514|S1 omission fails, Rampant omissions remain plausible; single outcome is weak for exact probability or scaling.|

## Gordon: focused deterministic and stochastic evidence

Both skills occur in seven fixtures/11 observations, at levels2/3 and both main-hero sides. The six deterministic fixtures have no applicable hydrated chance effects, regardless of filename. The repeated `wos444` fixture is stochastic because Lynn's SongOfLion hydrates.

The two focused accepted fixtures below retain full Flint2/2/1+Gordon2/2/1+Jasser4/4, T6 Lancers against T6 Infantry. Current results agree within one survivor. This meets the requested practical tolerance; no additional rounding proof is required solely for that one-unit gap.

| Candidate | `testcases/emulator_verified/wos451_gordon_s11_lancer_damage_up_bucket.json#0` (500L vs2990I) | `testcases/emulator_verified/wos451_gordon_s21_lancer_damage_up_bucket.json#0` (360L vs2100I) |
|---|---:|---:|
|Game defender survivors|1517|1017|
|Current|1516|1016|
|S1 omitted|1845|1260|
|S1 boost only omitted|1798|1226|
|S1 poison only omitted|1578|1062|
|S1 boost moved to hero-damage bucket, retaining normal-kind restriction|1563|1052|
|S2 omitted|1842|1258|
|S2 offense only omitted|1796|1223|
|S2 enemy debuff only omitted|1576|1061|
|S2 enemy debuff restricted to Infantry|1516|1016|

These contrasts support both halves of S1/S2 and distinguish the S1 normal-damage bucket from the tested hero-damage bucket in this full-kit interaction. They do not independently certify S1's damage-kind restriction, two-attack trigger or delayed poison, S2's three-turn cadence, exact magnitudes, every stacking interaction or scope beyond the present Lancer/Infantry lines. S2 receives contribution-only annotation; S1 receives contextual bucket support.

`testcases/emulator_verified/wos444_gordon_s22_all_enemy_damage_dealt_hero_nc.json#0` retains defender Sergey4/4+Gordon2/2/1+Lynn3/3/3, 2560T6L against8100T6 (2700 each). The five game attacker outcomes **5274,4736,5021,5290,5006** have mean5065.4/SD228.015. Current5049.677/SD216.571, central95%4596–5412, p0.372931 is plausible. S1 boost omission5773.335 (p0.00005) and S2 offense omission5765.06 (p0.0001) clearly disagree. S1 poison omission remains plausible (p0.301085). S2 enemy-debuff omission gives5309.568/SD149.455 (p0.00225); restricting it to Infantry gives5290.047/SD157.820 (p0.00585). The latter lies just above the runner threshold and is not robust positive proof of all-enemy scope. Traces apply the current debuff to all three classes, but the scope question remains open.

Four existing deterministic discrepancies are explicitly retained:

| Fixture key | Game / current | Context |
|---|---|---|
|`testcases/emulator_verified/gordon_wayne_s1_extra_overlap_lvl2.json#0`|A5 /A8|255L vs1000L; raw3 residual. Every tested omission/bucket restriction is much worse, but extra-attack interaction is not closed by this result.|
|`testcases/emulator_verified/gordon_wayne_s1_extra_overlap_nc.json#0`|D19 /D3|260L vs1000L; raw16 residual with near-elimination sensitivity. Preserved, unexplained.|
|`testcases/gatot_verified/s15.2-secondary-heroes-1000-inf-125-lancer-125-marksman.json#0`|A851,366rounds /A834,376rounds|1250 vs5000; raw17 residual plus10round difference, combined Gatot/Gordon/Bradley kit. Current is nearer than tested omissions but that does not establish the cause.|
|`testcases/gatot_verified/s3-5000-inf-vs-1000-inf-10-lancer.json#0`|A4573,1151rounds /A4996,1037rounds|5000 vs1010; substantial423 survivor and114round residual. Every selected Gordon alternative leaves endpoint4996, although poison/S2 removal changes duration. Strong disconfirmation that these tested Gordon changes alone fix the mismatch.|

The fresh Gatot exports retain `maxRounds=1500` and recorded winner/round metadata. Frozen `cases.json` keeps original entries, current hashes and whether the inventory digest matched; age or an earlier stale inventory hash did not invalidate the game observations. Raw errors are context, not a universal >2 or percentage materiality rule.

## Reproduction and remaining limits

The fixed alternatives and full source hashes are in [protocol.json](protocol.json); all individual observations and fixture keys are in [cases.json](cases.json) and [comparisons.tsv](comparisons.tsv). Each `Skill-initial.json` links complete compact `Skill-initial-samples.json`. [summary.json](summary.json) records validation and every deterministic per-side/round residual. The first16 runs retain activation counts and separate modifier annotations/generated damage jobs; Blitz's parent normal-attack annotation must not be mistaken for normal-kind generated damage.

From the repository root, replay one skill with a fresh output suffix, for example:

```sh
simulator/node_modules/.bin/tsx docs/mechanics-audit/reviews/hector-gordon-2026-09-07/worker.mts Rampant replay
python docs/mechanics-audit/reviews/hector-gordon-2026-09-07/summarize.py
```

Other worker IDs are SurvivalInstincts, Blitz, VenomInfusion and ChemicalTerror. Seed strings are `hector-gordon-review-2026-09-07:<fixture-key>:<run-index>`, indices0–999. Source and frozen-file guards refuse changed inputs; existing outputs cannot be overwritten. Shared seeds are reproducible but do not guarantee paired proc sequences after an omission changes RNG use. `freeze.mts` documents preparation and intentionally refuses to overwrite the original freeze.

Combined CDF/support p<1/250 is a diagnostic, with finite simulator and game samples; threshold crossings do not independently prove or repair mechanics. Absent levels, exact probabilities and coefficients, order/consumption, damage kind, retargeting/exhaustion, all-class protection, mode/widget and joiner branches remain unreviewed except the explicitly bounded claims above.
