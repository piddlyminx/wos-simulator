# Five further hero skills — reviewed 2026-09-07

This **retrospective** batch covers Jessie S2, Patrick S2, Sergey S1 and Zinman S1/S3 using accepted existing game outcomes. It preserves every recorded full kit and battle input. The alternatives change only cloned simulator effects; no live skill is disabled, coefficient fitted or production file changed.

[replay.json](replay.json) preserves all reviewed inputs, game outcomes, current predictions, counterfactual results and per-effect application counts. [replay.mts](replay.mts) records explicit patches and checks the runtime/config hashes; [config-snapshot.json](config-snapshot.json) is the complete frozen config. [summary.json](summary.json) derives the counts and confirms that **both** nested Zinman S1 effects enter damage jobs. The adopted arithmetic retains fractional survivor state and ceilings surviving source units for attack strength; only the separate outer army-term ceiling was removed.

There are **31 distinct fixture entries deterministic under the current runtime and 42 stored outcome rows**: 28 entries match exactly and all 31 are within two troops. Thirteen distinct entries with stochastic full-kit hydration are listed as skipped. The reviewed cases substantially overlap the [preceding batch](../simple-heroes-2026-09-07/README.md); neither repeated files nor stored rows are asserted to be independent battles. Current runtime classification does not itself prove a game hero is deterministic. In particular, the matching Flint/Zinman point result in this replay does not verify Flint's chance behavior.

All recorded outcomes are accepted regardless of folder unless explicitly excluded. Every reviewed application of these selected effects is to a normal damage job. Exact skill-kind behavior, untested levels, mode gates and broader interactions therefore remain outside this batch.

| Skill | Reviewed levels | Deterministic entries | Maximum current residual | Bounded conclusion |
| --- | --- | ---: | ---: | --- |
| Jessie: Bulwarks | 1, 2 | 15 | 2 | Defensive contribution beyond Lancers |
| Patrick: Caloric Booster | 1, 2, 4 | 8 | 0 | Offensive contribution beyond Lancers |
| Sergey: Defender's Edge | 2, 4 | 4 | 0 | Defensive contribution beyond Infantry |
| Zinman: Implacable | 1 | 6 | 0 | Combined protection beyond Marksmen; separate Defense/Health pools unresolved |
| Zinman: Positional Battler | 1 | 3 | 0 | Offensive contribution beyond Marksmen and the tested shared pool with Jessie |

These are contextual claims. A complete-kit match does not independently verify every effect or coefficient at the listed levels. The entries column overlaps across skills and should not be summed as independent evidence.

## Scope and contribution

`A`/`D` identifies the side with survivors. “Class only” restricts this skill to the hero's own troop class, keeping the complete kit unchanged. Zinman S1's two effects are restricted together; that is not an independent scope test for each component.

| Accepted fixture and recorded kit | Game | Current | Skill omitted | Class only |
| --- | ---: | ---: | ---: | ---: |
| [Jessie solo](../../../../testcases/emulator_verified/jessie_solo_nc.json): defender Jessie 4/1, 45 of each T6 class against 1500 Infantry | A79 | A79 | A208 | A186 |
| [Jasser + Patrick](../../../../testcases/emulator_verified/attdef_jasser_patrick_minxxx_attacks_nc.json): defender Jasser 2/3 + Patrick 1/1; Patrick S2 varied | D807 | D807 | D739 | D745 |
| [Patrick solo](../../../../testcases/emulator_verified/patrick_solo_nc.json): defender Patrick 2/1, 200 of each T6 class | A2582 | A2582 | A2686 | A2659 |
| [Sergey solo](../../../../testcases/emulator_verified/sergey_solo_nc.json): defender Sergey 4/4, 200 of each T6 class against a mixed T6 army | A1348 | A1348 | A2271 | A1621 |
| [Zinman entry 2](../../../../testcases/heroes_unittests/Zinman_tc.json): defender Zinman S1=1/S3=1 + Jessie 5/2; Zinman S1 varied | D130 | D130 | D86 | D87 |
| Same Zinman/Jessie battle; Zinman S3 varied | D130 | D130 | D89 | D105 |

These separations support contributions outside the selected class-only scope in the stated kits. Some other corpus rows are weak discriminators even though the effect is exercised: for example, omitting Jessie S2 happens to improve A1133 to the recorded A1131 in `attdef_test_minxxx_attacks_nc`. That two-troop change at this scale is not evidence that the skill is absent. The complete replay retains it alongside the stronger comparisons rather than selecting only favorable rows.

## Zinman S1: both effects exercised, split still unresolved

At level 1, the configuration applies 2% Defense and 2% Health. The diagnostic separately omits each effect and also moves either effect into its sibling's pool while retaining both 2% values.

| Accepted fixture | Game/current | Omit Defense only | Omit Health only | Both values in Health | Both values in Defense |
| --- | ---: | ---: | ---: | ---: | ---: |
| Zinman entry 0, S1=1/S3=1 | D122 | D118 | D118 | D121 | D121 |
| Zinman entry 1, S1=1/S3=1 | A4018 | A4058 | A4058 | A4018 | A4018 |
| Zinman entry 2, plus Jessie 5/2 | D130 | D111 | D111 | D130 | D130 |
| [Edith/Zinman Marksmen](../../../../testcases/emulator_verified/wos444_edith_s11_mark_damage_taken_hero_nc.json), Edith 3/3/3 + Zinman 1/0/0 | A1863 | A1879 | A1877 | A1865 | A1861 |

The model needs the combined protection to reproduce these endpoints. It does **not** follow that the game implements two separate pools: both merged-pool alternatives remain within 0–2 of every reviewed endpoint, including the other solo and Flint/Zinman cases. Individual component scope, exact split and independent level scaling stay unreviewed or unresolved. No nested effect is marked wholly verified.

## Bucket comparisons

For **Jessie S2**, moving the same value from damage-taken reduction to Health changes none of the 15 endpoints. For **Sergey S1**, the same move changes only the Patrick overlap, from game/current A726 to A727. These cases do not identify the bucket independently, even though omission and scope comparisons support the defensive contribution.

For **Patrick S2**, moving Attack into Damage or Lethality is identical in seven of eight entries. In the [Edith/Patrick/Jasser Lancer fixture](../../../../testcases/emulator_verified/wos444_edith_s12_lancer_damage_dealt_hero_nc.json), game/current A1909 becomes A1915 or A1919. This modest scale-relative separation is recorded as contextual preference for the current placement; it does not settle general bucket semantics.

For **Zinman S3**, the two solo cases cannot distinguish Lethality, Damage and Attack placement. The Zinman/Jessie combination gives game/current **D130** versus **D139** when Zinman moves into either separated pool. Together with the symmetric Jessie diagnostic from the preceding batch, this supports their shared additive pool over the tested alternatives. It is the same accepted battle, not two independent observations. The pool label, exact coefficient, other combinations and all untested levels remain unverified.

No simulator change follows from this batch. The next evidence should discriminate one of the remaining alternatives at a useful battle scale, rather than repeat a matching complete-kit endpoint.
