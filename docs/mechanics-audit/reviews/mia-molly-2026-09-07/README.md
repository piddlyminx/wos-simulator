# Mia and Molly: stochastic contribution and scope

**All five reviewed skills have contextual evidence of a positive contribution beyond Lancers alone.** This does not certify their precise probability, magnitude, damage kind, duration or stacking. The review covers Mia's three battle skills and Molly's first two; Molly's YouthfulRage stays in every recorded full kit but is outside this annotation batch.

All 19 relevant accepted fixtures, containing 86 distinct recorded observations, were replayed. There are 129,000 preserved simulator sample rows:1,000 per fixture/skill/candidate comparison, with duplicate current runs retained and verified identical across workers. Current classifications are stochastic for every fixture; filenames do not determine this. All outcomes are scored as attacker minus defender survivors, including draws; none of these samples draws. Full kits, exact troop/FC keys, reported stats and current source-ceiling/fractional-casualty arithmetic remain intact.

Three hypotheses were frozen before execution: unchanged current behavior, omission of only the selected skill's effects, and Lancer-only scope. For attack-triggered skills the latter restricts the triggering source to Lancers, preserving target selection. For turn-triggered protection it restricts recipients to own Lancers. Proc rates, values and other skills are unchanged. No coefficient fitting, stat adjustment or new game capture was performed.

| Skill | Active fixture levels | Fixture/outcome counts | Raw combined-p flags: current / omission / Lancer-only |
|---|---|---:|---:|
|Mia BadLuckStreak|1,3|14 /73|0 /13 /9|
|Mia LuckyCharm|1,2|11 /65|0 /11 /8|
|Mia RitualDeciphering|1,2|8 /53|0 /7 /6|
|Molly CallingOfTheStorm|2,5|5 /13|1 /4 /4|
|Molly IceDominion|2,4|5 /13|1 /4 /3|

Those skill counts overlap in the same battles; they must not be added as independent game evidence. Flags use the runner's combined CDF/support p<1/250 diagnostic. More persuasive scope claims below use repeated fixtures with large structural separation, rather than marginal threshold crossings or a single favorable point estimate.

## Mia's repeated full-kit fixtures

`testcases/emulator_verified/mia_only_defender_current.json#0` preserves Mia 3/2/2 defending with 200 of each T6 class against 1500 Infantry/1069 Lancers/1500 Marksmen. Ten game attacker survivor totals are 3560,3539,3556,3525,3551,3564,3546,3540,3528,3530: mean 3543.9, sampleSD13.77. Current prediction is 3544.451/SD16.717, p 0.99995.

| Selected skill changed | Omission mean / SD / p | Lancer-only mean / SD / p |
|---|---|---|
|BadLuckStreak|3644.98 /10.94 /0.00005|3587.44 /17.71 /0.00005|
|LuckyCharm|3592.55 /13.65 /0.0001|3573.71 /14.49 /0.00005|
|RitualDeciphering|3564.36 /11.33 /0.00005|3560.92 /11.58 /0.0002|

The sibling row#1 has 20 observations, and `greg_mia_defender_current.json#0` has 18 with the complete Greg 1/1/0+Mia 3/2/2 kit. Their current distributions also remain plausible (p 0.559022 and 0.79026); all three selected-skill omissions and Lancer-only alternatives fail both comparisons. This independently supports contribution and broader scope in those recorded contexts, conditional on the other full-kit behavior.

For BadLuckStreak, accepted attacker-side `testcases/heroes_unittests/Mia_tc.json#2` has only Mia S1 configured and six outcomes 1127,1118,1118,1128,1127,1127. Current mean 1124.669/SD4.668 agrees with game 1124.167/SD4.792 (p 0.890055); omission gives a point outcome 1042 and Lancer-only mean 1088.625. This strengthens the positive source-scope evidence at level 1 without independently identifying 50% probability, next-turn delay or the exact damage-taken bucket.

Traced current jobs exercise BadLuckStreak on normal and extra hits from all three own classes, LuckyCharm generated skill jobs from all three classes, and RitualDeciphering protection on each own class as frontlines die. These are verified simulator applications. The endpoint contrasts support broader scope, while exact target-transition rules and every class-specific coefficient remain unisolated. LuckyCharm and RitualDeciphering appear only on the defender side in this accepted fixture set; attacker/rally/joiner behavior is not inferred.

## Molly's repeated fixtures and existing disagreement

`testcases/emulator_verified/molly_solo.json#0` preserves Molly 2/2/1 attacking with 100 of each T6 class against 300I/240L/300M. The five game outcomes are 245,245,244,245,245: mean 244.8, sampleSD0.447. Current mean 243.842/SD1.242 has p 0.060497. This is plausible under the current comparator but retains a narrower observed spread and an approximately one-survivor mean residual; five battles do not tightly identify the true distribution.

- Omitting CallingOfTheStorm, or limiting it to Lancers, gives mean 239.802/SD0.768, p 0.00005. Only the attacking Infantry receive enemy damage in these traced battles, so the contrast directly supports protection beyond Lancers, specifically Infantry; it does not separately demonstrate protection of untouched backlines.
- Omitting IceDominion gives 237.177/SD1.304, p 0.00005. Lancer-only activation gives 241.101/SD1.138, p 0.00015. Generated jobs from Infantry and Marksmen therefore have discriminating support in this full-kit context.

`molly_lynn_combo.json#0` preserves Molly 2/2/1+Lynn 3/3/3 defending: game defender totals 399,404,402,401,408; current 403.042/SD2.402, p 0.572471. CallingOfTheStorm omission/Lancer-only both fail at p 0.0002. IceDominion omission fails at 0.0003, while Lancer-only remains plausible at 0.022949; this fixture alone does not identify the full IceDominion source scope. The accepted `heroes_unittests/Molly_tc.json#3` also favors the current effects but has only one observation.

The level 5 CallingOfTheStorm /level 4 IceDominion T10 fixture `heroes_unittests/Molly_tc.json#4` is not a strong positive discriminator: game defender 190, current 190.559/SD1.520, but both omissions and both Lancer-only alternatives remain plausible. Do not promote high-level behavior from hydration alone.

The accepted mixed-hero `testcases/3-testcases_mixed-heroes-not-verified.json#2` remains discrepant: game defender 2823 against current 2908.756/SD26.667, p 0.0021. Both selected Molly omissions make the disagreement larger. That is useful disconfirmation of deleting these effects, but cannot uniquely attribute the mismatch to Molly or certify her interaction with Jasser/Sergey, Natalia/Patrick/Alonso. The filename does not invalidate this outcome. Mia's separate mixed-hero row#5 is a weaker tail observation (currentp 0.014949), and even favors omission in this one comparison; it is not used as the main positive support for Mia.

## Artifacts and limits

[comparisons.tsv](comparisons.tsv) preserves every fixture key, individual game scores, army sizes, candidate mean/SD/interval and raw p. Each `Skill-initial.json` links its complete compact `Skill-initial-samples.json`: columns are A,D,rounds and both per-class survivor vectors. All 129,000 rows, all sample hashes, and duplicate-current rows were checked by `summarize.py`; [summary.json](summary.json) records the result. The first 16 runs per candidate include activation and per-job scope counts. For extra attacks, normal-kind entries in those counts denote parent trigger annotations, while skill-kind entries denote generated damage jobs; parent annotations do not establish a normal damage modifier.

Exact seeds are `mia-molly-review-2026-09-07:<fixture-key>:<run-index>`, with indices 0–999. Shared seed strings do not guarantee identical proc events after a structural omission changes random-number use. Results are conditional on current full-kit probabilities, levels, buckets and order; omission cannot by itself distinguish extra-job delivery from an equivalent bonus, and Lancer-only rejection does not uniquely certify every source/target rule. Levels absent above, joiners, rally/garrison gates, exact probability, timing, damage kind, stacking and troop-exhaustion branches remain unreviewed.

All workers verified the complete frozen source map before and after execution. A subsequent independent Gatot exporter metadata edit changed only `simulator/src/tooling/exportGatotTestcases.ts`; none of these 19 fixture inputs is a Gatot export, and the exporter is not imported by the replay. Original hashes were preserved. `summary.json` explicitly records that post-run drift; the frozen `worker.mts` guard now refuses a replay against that changed source tree instead of silently refreshing its hashes. `python docs/mechanics-audit/reviews/mia-molly-2026-09-07/summarize.py` reproducibly validates the stored samples without rerunning combat.
