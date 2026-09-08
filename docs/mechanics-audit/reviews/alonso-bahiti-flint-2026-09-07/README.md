# Alonso, Bahiti and Flint: eight-skill review — 2026-09-07

This retrospective review covers **35 distinct accepted input entries and 119 recorded outcomes**: Alonso15/86, Bahiti10/14 and Flint10/19. The eight skills overlap those entries; skill appearances are not additional battles, and distinct entries are not assumed to be independent captures. All recorded outcomes are accepted unless explicitly invalid/obsolete. None selected here is excluded. Recorded full kits, troop/FC keys, stats, battle options/caps and every individual outcome are preserved in [definitions.json](definitions.json). No production definitions, coefficients or live state were changed.

The [frozen alternatives](definitions.json) precede these simulations, but all historical game outcomes were already available. They change one selected skill's effects, scope or lifetime in a cloned config; they do not describe live-disabled kits. [results.json](results.json) stores220,057 simulator outcomes from277 current/alternative predictions, with A−D margin, both sides' per-type survivors, winner and rounds. Chance-active candidates use1,000 fixed-seed draws each; deterministic candidates run once. Nine current input entries are deterministic,26 chance-active; a chance-active entry can still have an invariant endpoint. Same-seed alternatives are paired comparisons, not independent replications. Per-row distribution tests condition on the listed repetitions being comparable draws; this review does not independently establish capture independence.

[summary.json](summary.json) and [current-inputs.csv](current-inputs.csv) preserve every input separately, including the failures. Every ± below is simulator per-battle SD, not uncertainty in its mean. The raw p<.004 runner diagnostic is a flag for disagreement, not proof of a skill-specific cause. Deterministic differences are reported numerically and judged with scale in mind; the usual1–2 survivor aim is not a universal materiality cutoff.

## Current disagreement that prevents universal Alonso agreement

The six-hero mixed entry `3-testcases_mixed-heroes-not-verified.json#2` records defender2,823. Attacker Jasser2, Sergey22 and Molly22 face Natalia22, Patrick21 and Alonso120 under the exact stored troop counts/stats. The primary current1,000-draw p=.004750 was near the diagnostic threshold. A [separately frozen precision refinement](refinement-definitions.json) retained the same model/input/seed sequence and expanded to10,000 draws: **defender2,907.58±26.67, p=.000750**. Its first1,000 per-side outcomes exactly equal the primary prefix. [refinement-results.json](refinement-results.json) supersedes only that current distribution's precision; all original comparisons remain unchanged. This adds9,000 new seeds, not10,000 independent additional predictions.

The roughly85-survivor mean residual remains unresolved. Omitting Onslaught in the original comparison gives defender2,867.07±25.84 (p=.090145), closer to this observation, while longer Onslaught or broader IronStrength is worse. Cleaner Alonso input sets reject Onslaught omission. Therefore neither omission nor a coefficient retune follows from this mixed-kit disagreement. All hero interactions and input uncertainty remain possible explanations. The other14 Alonso input sets are compatible with their current distributions in this bounded sample (p=.015999–1).

## Alonso: scope, lifetime and limits

Current Onslaught grants an all-own one-turn Lethality window on a40% turn trigger. IronStrength uses a20% attack trigger, applies DamageDown to the triggering enemy line for two turns starting next turn, and takes the maximum on repeated applications. PoisonHarpoon uses a50% attack trigger and creates an extra job from the triggering source against its target. Those are model definitions, not conclusions inferred from the endpoint fit.

| Recorded input / outcomes | Current mean±SD | Current p | Omit Onslaught p | Marksmen-only Onslaught p | Two-turn Onslaught p |
| --- | --- | --- | --- | --- | --- |
| Attacker600 each /6 | -256.37 ± 10.33 | 0.438028 | 0.000050 | 0.000100 | 0.000150 |
| Attacker900I/900L, entry#0 /4 | -463.36 ± 1.00 | 0.045348 | 0.000050 | 0.000050 | 0.000050 |
| Defender344 /8 | 1457.55 ± 15.94 | 0.191840 | 0.000050 | 0.000350 | 0.000050 |
| Defender334 solo /10 | 1231.04 ± 335.51 | 0.293085 | 0.000050 | 0.000100 | 0.000100 |
| Attacker344 solo_v2#1 /19 | -18.01 ± 87.78 | 0.391580 | 0.000050 | 0.000100 | 0.000050 |
| Attacker110 /8 | 1769.36 ± 3.56 | 0.810959 | 0.000050 | 0.000050 | 0.000050 |

**Onslaught:** the repeated clean inputs support a contribution beyond Marksmen and favor a one-turn window over the tested two-turn alternative. The no-Marksman attacker110 cases retain the effect and reject Marksman-only scope. Levels1 and3 are exercised. This does not uniquely determine40% probability, precise phase, stacking/bucket behavior, coefficients at all levels or every source interaction. The mixed six-hero contradiction above is retained. One tiny mixed entry predicts exactly defender3,729 under both current and most omissions despite active chance; it supplies endpoint fit, not contribution evidence.

| IronStrength discriminator | Current mean±SD / p | Omitted mean±SD / p | Marksman-source-only p | All-enemy recipients mean±SD / p |
| --- | --- | --- | --- | --- |
| Only defender344 carries Alonso /8 | 1457.55 ± 15.94 / 0.191840 | 1479.85 ± 15.18 / 0.000300 | 0.042748 | 1345.61 ± 26.11 / 0.000100 |
| Bilateral Alonso; no Marksmen /8 | -750.58 ± 13.45 / 0.894505 | -733.66 ± 13.12 / 0.001050 | 0.001750 | -814.58 ± 17.58 / 0.000100 |

**IronStrength:** omission is implausible in these two inputs, providing contribution evidence under their complete kits. In the bilateral no-Marksman setup both sides carry Alonso (110 attacking,344 defending); restricting triggers to Marksmen is also implausible. This supports some non-Marksman triggering in that combined setup, without assigning an isolated effect size to either side/level. Broadening each proc to all enemy types is rejected in14 of15 entries, including the independently sensitive defender344 input. This favors target-line scope over the tested broader scope in context. However, omission is compatible in13 entries and Marksman-only triggering in14. Most endpoint fits alone do not exercise a strong enough discriminator. Immediate two-turn and delayed one-turn alternatives remain plausible in the two positive inputs, so exact delay/duration is unresolved. Probability20%, max stacking, damage grouping and the full level curve were not independently identified.

| PoisonHarpoon discriminator | Current mean±SD / p | Omitted mean±SD / p | Marksman-source-only mean±SD / p |
| --- | --- | --- | --- |
| Defender344 /8 | 1457.55 ± 15.94 / 0.191840 | 1550.04 ± 9.95 / 0.000100 | 1486.92 ± 15.19 / 0.000050 |
| Defender334 solo /10 | 1231.04 ± 335.51 / 0.293085 | 2391.72 ± 94.93 / 0.000050 | 1637.78 ± 209.63 / 0.000050 |
| Attacker344 solo_v2#1 /19 | -18.01 ± 87.78 / 0.391580 | -474.57 ± 31.21 / 0.000100 | -189.65 ± 114.01 / 0.000050 |

**PoisonHarpoon:** omission is implausible in8 of9 active entries; Marksman-only triggering fails5. The solo level4 contexts above provide useful positive non-Marksman source evidence without requiring bilateral attribution. The only level1 context is the mixed six-hero#5 entry, where current, omission and Marksman-only are all plausible; that level is not individually established by these battles. Source/target lock after exhaustion, exact chance/magnitude, extra-job delivery versus another damage grouping and skill/normal-kind interactions remain unreviewed. This batch does not certify damage kind from a full-kit endpoint.

## Bahiti: protection and source scope

All10 input sets have Bahiti on the defending side. S1 levels2/5 and S2 levels2/4 appear, always in complete recorded kits. Every current distribution is compatible in this sample. Filenames ending `_nc` do not override actual runtime chance: Fluorescence remains stochastic.

| Input / records | Current mean±SD / p | Omit S1 p | S1 Marksmen-only p | Omit S2 p | S2 Marksman-source-only p | S2 one-turn lifetime p |
| --- | --- | --- | --- | --- | --- | --- |
| Bahiti22 solo /2 | 2229.40 ± 50.60 / 0.840858 | 0.000150 | 0.000050 | 0.000050 | 0.000050 | 0.840858 |
| Bahiti22 solo_nc /1 | 3677.31 ± 5.54 / 0.729014 | 0.000050 | 0.000050 | 0.000050 | 0.009350 | 0.729014 |
| Philly221+Bahiti22, entry#1 /4 | -454.30 ± 4.38 / 0.196240 | 0.000050 | 0.000050 | 0.000150 | 0.000250 | 0.408930 |
| Mixed heroes#4 /1 | 9334.30 ± 42.37 / 0.263537 | 0.000050 | 0.000050 | 0.000050 | 0.000050 | 0.263537 |

**SixthSense:** omission and restricting protection to Marksmen fail in5 of10 inputs, including the cleaner solo sets and repeated Philly/Bahiti entry#1. This supports protection beyond Marksmen in those contexts. The Logan/Reina combinations and Philly/Bahiti#0 remain compatible with omission, so their endpoint fit adds little causal evidence. This review does not separately identify exact DamageTaken grouping, all coefficient levels, mode/joiner rules or every recipient/type of incoming damage.

**Fluorescence:** omission fails6 of10 and restricting attack triggers to Marksmen fails4, including the two-record solo and repeated Philly/Bahiti#1 sets. This supports an offensive contribution from other troop types. Replacing the one-attack lifetime with a one-turn lifetime is compatible in every input and produces exactly the same primary samples in7 of10; it differs in Norah/Bahiti and both Philly/Bahiti entries where extra jobs can occur. For Philly/Bahiti#1, current margin−454.30±4.38 (p=.196240) becomes−455.46±4.50 (p=.408930), both plausible. Thus the accepted outcomes do not establish the current one-attack boundary versus carryover into extra jobs. The lethality-versus-damage bucket interpretation, exact50% chance, coefficient curve, damage-kind interactions and timing remain unresolved.

## Flint: useful deterministic scope evidence, unresolved archived variability

All three current Flint skills are permanent and deterministic: Infantry DamageUp, all-own AttackUp and all-own LethalityUp. All listed sources retain their original full kits. The following predictions are signed survivor margins, so negative values mean defender survivors.

| Full kit / game | Current | Omit S1 | S1 all types | Omit S2 | S2 Infantry-only | Omit S3 | S3 Infantry-only |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Flint221 solo; gameA2862 | 2861 | 2901 | 2139 | 2972 | 2959 | 2919 | 2913 |
| Flint221+Zinman100; gameA1005 | 1005 | 1078 | -188 | 1196 | 1183 | 1114 | 1114 |
| Flint221+Gordon221+Jasser44,500L; gameD1517 | -1516 | -1516 | -841 | -1674 | -1674 | -1587 | -1587 |
| Same kit,360L; gameD1017 | -1016 | -1016 | -500 | -1134 | -1134 | -1069 | -1069 |
| ArchivedFlint444#0; gameD149–151 | -150 | -143 | -168 | -141 | -144 | -141 | -144 |
| ArchivedFlint444#1; gameA5715–5756 | 5762 | 5889 | 4995 | 5969 | 5921 | 5969 | 5921 |

**Pyromaniac:** the solo and Zinman contexts support an Infantry contribution while rejecting all-own scope. In the two Lancer-only Gordon contexts, current S1 is hydrated but never applied: omission is identical, while broadening it produces huge disagreement. Those are negative-recipient scope checks, not evidence of S1 activation. The two Marksman-only Bradley contexts also leave current S1 unexercised; all-own scope moves their outcomes only6–8 around2,700, a modest difference. In the mixed Bradley case S1 is applied in traces, yet its omission leaves the rounded endpoint6,151 unchanged. Actual application and causal endpoint separation must be distinguished.

**BurningResolve and Immolation:** the solo/Zinman and Lancer-only Gordon contexts support offensive contributions outside Infantry. Current Gordon endpoints are within one defender survivor while restricting either bonus to Infantry shifts tens or hundreds. This supports context-specific scope, not unique Attack-versus-Lethality bucket identification. At archived level4 both bonuses are20%, and removing or restricting S2 versus S3 produces identical predictions; those archived endpoints cannot independently separate their arithmetic groupings. Higher/lower unexercised levels and interactions remain unreviewed.

**Contradictory historical evidence is retained.** `heroes_unittests/Flint_tc.json#0` records defender[150,151,149,149,150] against fixed current150, within one but not a reproduced distribution. Entry#1 records attacker[5720,5756,5736,5715,5733,5736] against fixed current5,762: residuals[42,6,26,47,29,26]. The spread41 and current excess6–47 (about0.1–0.8% of survivors) remain unexplained. Omitting either offensive bonus or broadening S1 is much worse, but that does not make the residual disappear. The stored `sim_skills_used` strings are historical simulator output, not observed in-game skill activation counts; they cannot establish a chance mechanism. The present archived v1 Flint definitions also flag all three skills as permanent/nonchance. This bounded history check does not establish what mechanism or input variation produced the 2025 game spread.

The Flint/Reina/Zinman entry is stochastic through Reina. Its current defender444.72±6.33 is compatible with game439, but omitting S1 (438.85±6.68), S2 (424.58±5.94) or S3 (434.63±6.52) is also compatible. Its fit alone does not positively establish any Flint component. No chance rule or coefficient was fitted to the old variability.

## Integrity and remaining work

The [config snapshot](config-snapshot.json) and32 source/hero-definition hashes identify this current engine, including Hendrik S3 first2, Reina's current coefficient curve, persistent fractional survivor state and the established ceil of surviving source troops. The removed outer square-root army-term ceiling remains absent. Replay guards verified unchanged sources/config/inputs; [validation.json](validation.json) also checks every saved margin against both survivor sides, the refined sample's exact1,000-row overlap and all observation arrays. Game rounds are never inferred from skill counts.

[annotations.json](annotations.json) records eight partial contextual reviews. It does not mark whole mechanics verified. The mixed six-hero Alonso distribution mismatch and archived deterministic Flint spread remain open; the strongest next evidence would isolate those specific uncertainties while preserving complete kits, rather than simply repeat already-insensitive full-kit endpoints.
