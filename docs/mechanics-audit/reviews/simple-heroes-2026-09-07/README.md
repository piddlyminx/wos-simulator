# Five simple hero skills — reviewed 2026-09-07

This is a **retrospective review of accepted game outcomes**, covering Jasser S1, Jessie S1, Patrick S1, Sergey S2 and Seo-yoon S1. Existing outcomes were available before the diagnostic. It preserves recorded full kits, stats, troop tiers, side roles and battle options; only simulator copies of the selected effect are changed. No new battle, disabled live skill, stat fitting or coefficient tuning is used.

[replay.json](replay.json) contains every reviewed input/outcome, current result, omission/scope/bucket alternative, source hashes and counts of damage jobs using each effect. [replay.mts](replay.mts) is the guarded replay; [config-snapshot.json](config-snapshot.json) preserves the complete config. [summary.json](summary.json) derives the counts below. The runtime retains fractional survivors and ceilings surviving source units for attack strength; its separate outer army-term ceiling has been removed.

The batch includes **35 distinct deterministic fixture entries and 48 stored outcome rows**: 29 entries match exactly, 34 are within two troops, and one retains a 17-troop residual. These are entry/row counts, not a claim of 48 independent battles. Stochastic full-kit cases are listed as skipped and receive no single-sample agreement judgment. All recorded outcomes are accepted regardless of folder unless explicitly excluded; names such as `heroes_unittests` or `not-verified` do not invalidate their game outcomes.

| Skill | Reviewed levels | Deterministic entries | Largest current residual | What is supported here |
| --- | --- | ---: | ---: | --- |
| Jasser: Tactical Genius | 1, 2, 4 | 9 | 1 | Offensive contribution beyond Marksmen in the tested kits |
| Jessie: Stand of Arms | 1, 2, 4, 5 | 15 | 2 | Offensive contribution beyond Lancers; shared bonus pool with the tested Zinman S3 |
| Patrick: Super Nutrients | 1, 2, 3, 4 | 9 | 17 | Defensive contribution beyond Lancers, with one combined-kit discrepancy retained |
| Sergey: Weaken | 2, 4 | 4 | 0 | Enemy offensive suppression beyond Infantry in the tested mixed army |
| Seo-yoon: Rallying Beat | 1, 3 | 5 | 0 | Offensive contribution beyond Marksmen in the tested mixed armies |

Fixture overlap means the entries column should not be summed as independent evidence. A level appearing here means the effect actually entered damage jobs and the complete model was compared; it does **not** independently verify that level's coefficient or the entire scaling curve. Every reviewed application of these five effects is to a normal damage job, so skill-kind behavior remains outside this review.

## Load-bearing scope comparisons

`A` and `D` identify the side with survivors. “Class only” restricts the selected effect to the hero's troop class; for Sergey it restricts the enemy debuff to enemy Infantry. All other effects and the complete recorded kit remain unchanged.

| Accepted fixture / full kit | Game | Current | Effect omitted | Class only |
| --- | ---: | ---: | ---: | ---: |
| [Jasser solo](../../../../testcases/emulator_verified/jasser_solo_nc.json): defender Jasser 1/2, 200 of each T6 class | A2740 | A2740 | A2804 | A2761 |
| [Jasser + Patrick](../../../../testcases/emulator_verified/attdef_jasser_patrick_minxxx_attacks_nc.json): defender Jasser 2/3, Patrick 1/1; Jasser effect varied | D807 | D807 | D585 | D744 |
| [Jessie solo](../../../../testcases/emulator_verified/jessie_solo_nc.json): defender Jessie 4/1, 45 of each T6 class versus 1500 Infantry | A79 | A79 | A471 | A351 |
| [Patrick solo](../../../../testcases/emulator_verified/patrick_solo_nc.json): defender Patrick 2/1, 200 of each T6 class | A2582 | A2582 | A2725 | A2696 |
| Same Jasser + Patrick fixture; Patrick effect varied | D807 | D807 | D723 | D737 |
| [Sergey solo](../../../../testcases/emulator_verified/sergey_solo_nc.json): defender Sergey 4/4, 200 of each T6 class versus a mixed T6 army | A1348 | A1348 | A2271 | A2215 |
| [Seo-yoon solo](../../../../testcases/emulator_verified/seo_yoon_solo_nc.json): defender Seo-yoon 1/3, 300/240/300 T6 troops | D620 | D620 | D604 | D612 |
| [Seo-yoon mixed comparison, entry 6](../../../../testcases/heroes_unittests/Seo-yoon_tc_nc.json): attacker Seo-yoon S1=3; defender Seo-yoon S1=1 + Jessie 5/2 | A2128 | A2128 | A1136 | A1787 |

In the last comparison, the simulator counterfactual changes Seo-yoon's effect on both sides; it is not a single-side isolation. The full replay lists the simpler single-hero cases as well. The large omission/scope differences, together with job-level application records, support the stated contribution and rule out the selected class-only alternatives within these contexts. They do not establish every recipient independently, all battle modes or all interactions. The few-troop differences in some other rows are reported without treating them as substantial discrimination merely because they exceed two.

## Buckets and limits of attribution

**Jasser.** The simple cases cannot distinguish current `active.hero.lethality.up` from a separate Damage or Attack factor. In the [Edith/Patrick/Jasser Lancer case](../../../../testcases/emulator_verified/wos444_edith_s12_lancer_damage_dealt_hero_nc.json), game/current A1909 becomes A1921/A1919 when Jasser moves into Damage/Attack. The two Gordon overlap fixtures similarly give current D1516/D1016 versus game D1517/D1017; alternative buckets give D1550/D1043 or D1529/D1025. This consistently favors the current placement at the recorded inputs, but the differences are modest relative to the endpoint scale and depend on the other heroes' modeled pools. The annotation retains broader bucket identification as unresolved.

**Jessie.** In [Zinman entry 2](../../../../testcases/heroes_unittests/Zinman_tc.json), defender Zinman S1=1/S3=1 plus Jessie 5/2 leaves game/current **D130**. Moving Jessie's effect from the pool shared with Zinman S3 to either Damage or Attack produces **D139**. This supports their shared additive pool over the tested separated-pool alternatives, conditional on the rest of that kit. It does not uniquely establish the pool's name or every stacking rule. In the Seo-yoon mixed fixture, moving Jessie into Attack changes A2128 to A2137, while Damage is indistinguishable; that larger-scale nine-unit difference is a weaker comparison by itself.

**Patrick.** Health and damage-taken placement are identical in most reviewed cases. The Sergey overlap gives A726 versus A727, which is not useful separation. In the Edith overlap, game/current A1909 becomes A1898 after moving Patrick into damage-taken; that is contextual evidence for sharing a Health pool with Edith, but the small relative difference does not settle general bucket semantics. The [Gatot/secondary-heroes fixture](../../../../testcases/gatot_verified/s15.2-secondary-heroes-1000-inf-125-lancer-125-marksman.json) retains **game A851 versus current A834**, about 2% of the recorded endpoint. Omitting Patrick gives A883 and moving his bucket gives A834. That residual remains unresolved and cannot be assigned to Patrick alone from the complete-kit endpoint.

**Sergey and Seo-yoon.** Moving Sergey from enemy Attack-down to enemy Damage-down changes none of the four deterministic endpoints. Moving Seo-yoon from Attack-up to Damage-up changes none of the five. Their scope/contribution is supported in the listed contexts, but these comparisons do not identify those bucket labels independently.

Exact coefficient estimates, untested levels, skill-kind modifiers, duration or dispel behavior, rally/joiner gates and other combinations remain unreviewed. No production change follows from this batch. A useful future capture should discriminate a remaining hypothesis on a meaningful battle scale, rather than repeat an already matching endpoint.
