# Hendrik, Ahmose and Greg: six-skill review — 2026-09-07

This bounded retrospective review covers six currently defined skills using **13 distinct accepted inputs and59 recorded outcomes**. Six inputs are deterministic; seven Greg inputs are stochastic. All recorded outcomes are accepted unless explicitly invalid/obsolete, irrespective of folder, and none selected here has such an exclusion. Full kits, troop keys, stats and individual outcomes remain intact. No production definition, live state or coefficient was changed.

[definitions.json](definitions.json) records the named omission/scope/duration alternatives before execution. [results.json](results.json) preserves63,035 simulator outcomes, each with attacker-minus-defender margin, per-type survivors, winner and rounds. There are1,000 samples per stochastic candidate; deterministic candidates run once. The six skills overlap the13 inputs, so their per-skill appearances are not additional independent battles. [summary.json](summary.json) and [summarize.py](summarize.py) retain and validate the exact counts, source hashes and raw margins. The frozen config includes the adopted Hendrik S3 first2 change.

## Hendrik: WormsRavage

All four accepted Hendrik fixtures are included. The scope alternative limits S1's DefenseDown to enemy Marksmen; the current effect covers all enemy troop types.

| Full recorded kit / game | Current | Omit S1 | Enemy Marksmen only |
| --- | ---: | ---: | ---: |
| Hendrik333, Lancer-only /D17 |D17 |A20 |A20 |
| Hendrik333,250M versus400I/100L/100M /D471 |D471 |D488 |D484 |
| Hendrik333,250M versus150I/60L/60M /D68 |D71 |D104 |D97 |
| Renee444+Hendrik100,120L versus446I /A14 |A14 |D17 |D17 |

These provide strong contextual contribution and scope evidence beyond enemy Marksmen, including a Lancer-only full333 case and an Infantry opponent at S1 level1. The new small case's three-survivor residual remains explicit. This review does not isolate DefenseDown from other stat groupings, establish a full coefficient curve, or validate every kind/source/lifecycle interaction merely because S1 is used in a full kit. S2/S3 evidence remains separately documented.

## Ahmose: components and contradictory residuals

The two accepted inputs are Ahmose110 defending200 of each T6 class against1500I/1069L/1500M, and Ahmose113+Renee444 attacking with4000I/500L against13400I. Only the latter exercises BladeOfLight. Both full kits are deterministic under the current runtime.

| Selected skill alternative | Solo gameA2633 | Renee/Ahmose gameA3777 |
| --- | ---: | ---: |
| Current |2615 |3778 |
| ViperFormation omitted entirely |2667 |3798 |
| Only Infantry pause omitted |2579 |3829 |
| Only Infantry protection omitted |2675 |3745 |
| Only backline protection omitted |2640 |3778 |
| Both protection components last1 turn |2667 |3762 |
| Infantry pause lasts2 turns |2649 |3688 |
| PrayerOfFlame omitted |2634 |3756 |
| PrayerOfFlame broadened to all own troops |1918 |3872 |
| BladeOfLight omitted |inactive |3675 |
| Only BladeOfLight offensive buff omitted |inactive |3737 |
| Only BladeOfLight target debuff omitted |inactive |3720 |
| BladeOfLight target debuff immediate |inactive |3774 |
| BladeOfLight target debuff lasts2 turns |inactive |3818 |

**ViperFormation:** the Renee/Ahmose case favors a one-turn Infantry pause plus Infantry protection over omitting either component, and favors the modeled two-turn protection over the one-turn alternative. Model trace inspection confirms both components are exercised. Its backline protection is not used there: Infantry survive in front, and removing the backline component leaves3778 unchanged. In the solo case backline protection is used, but the current prediction is18 below game and omission is closer (2640, seven above). Thus that branch and precise phase are unresolved. The whole-skill omission result must not certify all three components. Both fixtures use S1 level1, where the configured protection percentage is10 for both Infantry and backlines; higher-level differences remain untested.

**PrayerOfFlame:** the Renee/Ahmose case supports an Infantry offensive contribution and rejects broadening that bonus to Lancers in that full kit. However, the solo counterfactual omitting S2 predicts2634, closer to game2633 than current2615. This is a real contradictory residual and prevents universal confirmation of S2 from this batch. Other Ahmose components or input/model uncertainty could cause it; no selected adjustment is proven to fix it. The18-troop difference is about0.7% of that endpoint and is retained numerically rather than automatically labeled material by a universal two-troop cutoff.

**BladeOfLight:** both nested effects matter in the one exercised level3 case: omitting the offensive buff or target debuff shifts the prediction by41 or58 troops. Current3778 agrees within one. Extending the debuff to two turns predicts3818. Immediate versus next-turn activation gives3774 versus3778, only four apart around3,800 survivors; this is weak timing separation and does not establish a unique delay rule. The one enemy troop class also cannot distinguish a locked target from broader enemy scope. Offense grouping, exact coefficients, higher/lower levels and mixed-role interactions remain unreviewed.

## Greg: use full distributions

All seven current distributions are compatible with their recorded outcomes at the runner's raw p<0.004 diagnostic threshold. Every ± below is simulator per-battle SD. Stored observations are retained individually in the raw file; the three `greg_only_defender_current` entries are different inputs/stat profiles, not one pooled sample. Every recorded Greg kit is110, so no S3 or higher skill level is validated here.

| Input / number of game records | Current mean±SD | Current p | Omit S1 p | S1 Marksmen-only p | S1 one-turn p |
| --- | --- | ---: | ---: | ---: | ---: |
| Mixed six-hero#5 /1 |−2271.56±9.59 |.015449 |.000050 |.000250 |.000050 |
| Greg solo /1 |2704.42±13.67 |.643368 |.000050 |.005400 |.000050 |
| Norah/Greg /5 |−366.29±2.33 |.936653 |.176741 |.750462 |.788361 |
| Mia/Greg /18 |3350.28±19.16 |.652367 |.000050 |.194340 |.006200 |
| Greg-only#0 /6 |3687.02±5.17 |.955052 |.000050 |.000450 |.000050 |
| Greg-only#1 /2 |3586.50±4.93 |.779361 |.000050 |.012349 |.000100 |
| Greg-only#2 /20 |3594.42±4.80 |.788911 |.000050 |.000050 |.000100 |

**SwordOfJustice:** the stronger repeated solo input sets support an offensive contribution outside Marksmen and a window longer than one turn. Their other skills remain active. The Norah/Greg set does not discriminate any selected S1 alternative; Mia/Greg and the earlier n=1 solo do not independently reject Marksman-only scope at this threshold. We do not rely on those borderline cases to strengthen the clearer repeated-input evidence. The comparison does not uniquely establish exact20% proc probability, three versus two turns, max-versus-add stacking, damage grouping or the full level curve.

**DeterrenceOfLaw remains unresolved.** Omitting S2 is compatible in every recorded input set (p=.009250–.885556); restricting its triggering source to Marksmen likewise remains compatible. Therefore this batch does not positively establish its contribution or exact source gate. Broadening each proc to all enemy lines is rejected in four sets, but that negative result cannot validate the current target-line effect when no effect is also plausible.

| S2 scope challenge | Current | All-enemy target mean±SD | All-enemy p | Omit S2 p |
| --- | --- | --- | ---: | ---: |
| Greg solo /gameA2697 |2704.42±13.67 |2610.22±23.64 |.000050 |.619469 |
| Norah/Greg /gameD363–369 |−366.29±2.33 |−370.88±2.44 |.000050 |.829809 |
| Mia/Greg /18 outcomes |3350.28±19.16 |3316.07±21.96 |.000050 |.619319 |
| Greg-only#2 /20 outcomes |3594.42±4.80 |3576.49±11.17 |.000150 |.656767 |

The broad target alternative is actually closer in the mixed six-hero case (p=.279136 versus current.015449), while both remain plausible. That contrary case is retained. Current delayed two-turn, immediate two-turn and delayed one-turn S2 alternatives are all compatible. No production scope/delay change follows from this review. A future S2 discriminator should make the debuffed enemy line survive long enough to deal consequential follow-up damage; merely repeating a low-sensitivity endpoint will not resolve its contribution.

## Integrity and limits

The archived [config](config-snapshot.json),32 source/definition hashes, fixture hashes and seeds identify the reviewed model. The replay asserts sources/inputs/config remained stable through execution, and the summary validates every stored simulator margin against both survivor sides. These are retrospective conditional comparisons, without stat fitting or new game observations. Preserving apparent contradictions and unexercised nested branches takes precedence over increasing a verified-skill count. No whole skill is certified by a full-kit endpoint alone.
