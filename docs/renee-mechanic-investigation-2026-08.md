# Renee mechanic investigation

Evidence ledger reconstructed on 2026-08-12 from the August investigation, the current repository fixtures, the July Renee capture stash, and the two latest deterministic captures. Read this before continuing Renee experiments in another session.

This document distinguishes game observations from simulator representations. Bucket names are implementation labels; the important game question is which effects combine additively in one group and which multiply as separate groups.

## 2026-08-27 delayed-damage hypothesis

The active simulator candidate now separates Nightmare Trace's calculation time from its delivery time:

```text
even-turn Lancer attack
    -> calculate S1's extra damage immediately and lock its target
    -> store the completed damage result
odd turn
    -> deliver that stored result without recalculating it
    -> S2 and S3 modify current damage against the marked target in type.marked_target.damage.up
```

This reopens the earlier homogeneity conclusion for a concrete reason: S1 can appear additive with S2/S3 because it is a separate, already-calculated damage event, not because all three values occupy one arithmetic bucket. S2 and S3 still add with each other in one marked-target bucket.

The existing Lancer-to-Marksman Charge capture distinguishes the two S2/S3 candidates under this timing model. The game score is `+50`; putting S2/S3 in the existing `type.single_target.damage.up` bucket predicts `+27`, while the separate `type.marked_target.damage.up` bucket predicts exactly `+50`. Renee-only and Hendrik remain exact under both candidates, Gwen remains four survivors high, and the attacker-side Ahmose fixture is 17 survivors high under both.

These are simulator predictions against saved game observations, not a new live-game confirmation. The active config uses the separate marked-target candidate because it wins the only saved report that directly overlaps the Lancer-versus-Marksman 10% bonus. Nightmare Trace is calculated as a skill-kind damage job for now and, because it is represented as an `extra_skill_attack`, its delivered kills are attributed in the skill report. Reporting follows the effect category rather than a per-job override. Whether the game classifies that calculation as skill damage remains unresolved.

## Previous conclusion through 2026-08-12

1. **Renee's three marked-target effects use the same bucket.** Treat this as an established constraint. Do not reopen mixed S1/S2/S3 assignments such as `TTH` or `HTT` unless new evidence directly contradicts homogeneity.
2. **`active.hero.damageTaken.up` is the strongest current identity for that common bucket.** It is strongly supported, but not yet exact game truth because the clean Ahmose overlap retains a deterministic 14-survivor residual and older Ahmose captures point the other way.
3. **`type.single_target.damage.up` is rejected.** The clean Charge overlap predicted the wrong winner by a large margin.
4. **Shared `active.hero.damage.up` and shared `active.hero.defense.down` are rejected.** Edith and Hendrik provide the cleanest exclusions.
5. **All three effects being ordinary extra skill attacks is rejected.** The older Wu Ming discriminator and Renee's reports with no attributed skill kills support modifier effects instead.
6. **The working lifecycle is an every-two-turn mark opportunity, consumed by a Lancer normal attack, with target-locked child effects active on the following turn.** Uninterrupted captures support this cadence. Strict turn cadence versus every-second-successful-Lancer-attack cadence is still untested when the scheduled Lancer attack is blocked.

The previous simulator representation was therefore a defensible best model, not a perfect fit:

```text
even turn creates a one-turn Lancer mark opportunity
    -> eligible Lancer normal attack locks its actual target
    -> all three child effects activate next turn
    -> all three use active.hero.damageTaken.up
```

The JSON represents this with an equivalent carrier under each skill. Conceptually they are the three contributions attached to the same placed mark, not three independently reported recurring attacks.

See [`Renee.json`](../simulator/config/hero_definitions/Renee.json).

## Previous-model continuity rules

- Compare only **homogeneous** Renee candidates. The live question is the identity of the shared group, not whether the three skills have different types.
- Do not infer a bucket from the phrase "marked target." Targeting is expressed by `applies_to`/`applies_vs`; `type.single_target.damage.up` is a dealer-side arithmetic bucket, not a generic marker for target-locked effects.
- Do not change published Gwen values to absorb the repeated four-survivor Renee/Gwen residual.
- Do not use `hector_renee_wayne` as Renee bucket evidence. That stored battle fields only Infantry, so no Lancer consumes Renee's carrier and Renee is inert.
- Do not use the older defensive Ahmose fixtures as clean `damageTaken.up` overlap proofs. Ahmose's Infantry source can disappear before the target, so overlap is not guaranteed throughout the battle.
- For captures, use T6 unless troop skills are the subject, preregister candidate predictions, substitute exact captured stats afterward, evaluate independent `displayed +/- 0.05` stat corners, and persist Battle Details screenshots when activation counts matter.

## Previous model lifecycle and scope

The current model distinguishes the one recurring report activation from the two passive mark enhancements:

| Skill | Level values | Working scope on the turn after marking | Report interpretation |
| --- | --- | --- | --- |
| Nightmare Trace (S1) | 40/80/120/160/200% | Marked target versus one Lancer attack | Recurs every two turns in uninterrupted battles |
| Dreamcatcher (S2) | 30/60/90/120/150% | Marked target versus Lancer damage for the active turn | Listed once because it enhances placed marks |
| Dreamslice (S3) | 15/30/45/60/75% | Marked target versus damage from all friendly troop types for the active turn | Listed once because it enhances placed marks |

At 3/3/3 the marked-turn total is 255%; at 4/4/4 it is 340%. Because the three effects share a bucket, those values add before that bucket's factor is applied.

What is supported:

- `renee_solo_nc` gives exactly `-554` in five deterministic game observations under the turn-carrier, next-turn duration model.
- `renee_wayne_mixed_510_vs_888` reports Renee activations `20/1/1` over roughly 40 turns. This supports one recurring S1 mark event plus passive S2/S3 enhancements, rather than three independently reported recurring attacks.
- The zero-Lancer hero and no-hero controls both give attacker `+2688`, directly supporting the Lancer gate. With 25 Lancers the paired scores are `+2672` without Renee and `+2515` with Renee; with 100 Lancers they are `+2669` and `+2352`. Those non-zero pairs are consistent with a growing Renee response, but are not pure skill-effect deltas because Renee's hero-generation stats also strengthen the Lancer line.

What is not directly confirmed in game:

- Whether a blocked even-turn Lancer attack loses that opportunity until the next even turn, as the current turn trigger does, or merely delays an every-second-attack cadence until the next successful attack.
- Whether a mark remains attached to the original target if targeting changes before the following turn.
- S1's one-attack duration versus S2/S3's whole-turn duration in a purpose-built isolation battle.
- Whether generated skill-damage jobs should receive Dreamcatcher or Dreamslice. Most current discriminators contain only relevant normal damage.

## Previous all-three-modifier bucket evidence

Signed scores below are from the attacker's perspective: `+N` means the attacker survives with `N`; `-N` means the defender survives with `N`.

### Why homogeneity is closed

The earlier search began with 125 assignments across five candidate mechanics for S1/S2/S3. `renee_solo_nc = -554` reduced these to nine exact assignments:

- four homogeneous modifiers: DDD, HHH, TTT, and UUU;
- EEE;
- four mixed candidates whose S2 and S3 were both extra attacks.

The mixed Renee + Wayne report then favored the homogeneous modifier family, while its `20/1/1` activation topology and absence of Renee-attributed kills made S2/S3 extra attacks implausible. The later partner overlaps were therefore deliberately designed around one shared Renee type. Subsequent mixed T/S and T/H sweeps also fit materially worse.

No single one of those reports proves homogeneity by itself. The prior investigation nevertheless closed the question from their intersection, and future sessions should preserve that conclusion unless genuinely contradictory evidence appears. The Infantry-only `hector_renee_wayne` fixture contributes nothing to this reduction because Renee never places a mark there.

### High-confidence current evidence

| Evidence | Game | Candidate predictions | Conclusion |
| --- | ---: | --- | --- |
| Renee + Edith, 3/3/3 Renee | 21 S1 activations | shared `damage.up`: 22 activations, 449 survivors, 45 rounds; other homogeneous modifier buckets: 21 activations, 456 survivors, 43 rounds | Reject shared `active.hero.damage.up`. |
| Renee + Hendrik clean T6/T9 capture | `+14` | shared `defense.down`: about `+5`; shared `health.down` or `damageTaken.up`: raw `+13`, runner-adjusted `+14` | Reject shared `active.hero.defense.down`; does not separate H from T. |
| Renee + Charge clean T6 capture | `+50` | shared `damageTaken.up`: `+43..+45`; shared `single_target.damage.up`: `-86..-80` | Strongly reject `type.single_target.damage.up`; it predicts the wrong winner. |
| Renee + Ahmose attacker-side clean capture | `+3777` | shared `damageTaken.up`: `+3761..+3763`; separate numerator bucket: `+3813..+3814` | Strongly favors shared `damageTaken.up`; residual is 14 versus at least 36 for the separate bucket. |

The Charge arithmetic was also verified on the actual marked Lancer-to-Marksman jobs. At Renee 3/3/3, separate groups give `1.10 x 3.55 = 3.905`; putting Renee into Charge's bucket gives `1 + 0.10 + 2.55 = 3.65`.

The Ahmose trace confirms the intended overlap rather than merely fitting the total. At Renee 4/4/4, a shared group gives `1 + 3.40 + 0.15 = 4.55`; separate groups give `4.40 x 1.15 = 5.06`. Thirty-eight marked Lancer jobs carried 355% `damageTaken.up`, comprising Renee's 340% and Ahmose's 15%. All 500 Lancers and more than 3,200 Ahmose Infantry survived; only the final Lancer job was skipped after Infantry had already exhausted the target that round.

Reproduction details: WIP's Ahmose adds 88.44 Attack and Defense over no hero; minxxx's adds 117.66 Attack and Defense, with no Lethality or Health contribution. Only minxxx has Ahmose S3 available (`1/1/3`; WIP is `1/1/0`), so the clean overlap must put minxxx on the attacking side. The captured minxxx Infantry report stats were 408.4 Attack, 392.2 Defense, 226.3 Lethality, and 221 Health.

### Supporting but contaminated evidence

Two Renee/Gwen captures favor Renee sharing Gwen's `damageTaken.up` group:

| Formation | Game | Same bucket with published Gwen 10% | Separate buckets with published Gwen 10% |
| --- | ---: | ---: | ---: |
| 620 T6 Lancers vs 920 T6 Infantry | `+453` | `+457` | `+464` |
| 500 T6 Lancers vs 900 T6 Infantry | `+318` | `+322` | `+331` |

Both leave the same four-survivor residual under the same-group model. An effective 5% Gwen value happens to remove it, but that does **not** prove Gwen level 2 is 5%. Gwen's own grouping, scope, and duration were not understood well enough for these captures to carry the Renee conclusion by themselves.

The mixed Renee + Wayne capture also supports ordinary modifiers:

- Game: `+427`.
- Homogeneous modifier candidates: mean `+425.97`, SD 2.35.
- Tested S2/S3-extra-attack candidates: mean `+423.47`, SD 1.78.
- Report: Renee `20/1/1` activations and no Renee-attributed kills; Wayne's known extra attacks did report kills.

This disfavors Renee extra attacks but does not identify the modifier bucket.

### Legacy broad-screen captures

These reports are preserved in the stash named `WIP Renee skill fixtures and emulator captures`. Their game observations remain useful, but their frozen predictions predate the current trigger/runtime model and should be rerun before being used as a decisive present-day fit.

| Partner / target bucket | Game | Frozen prediction for matching homogeneous bucket | Other homogeneous predictions | Use |
| --- | ---: | ---: | ---: | --- |
| Edith / `active.hero.damage.up` | `+4883` | UUU `+5136` | approximately `+4916` | Strongly rejects UUU. |
| Wu Ming / extra skill attacks | `+1639` | EEE `+1039` | ordinary non-U about `+1696`; UUU `+2285` | Strongly rejects EEE and also disfavors UUU. Screenshots were not preserved. |
| Seo-yoon / `active.hero.attack.up` | `+1334` | AAA `+2187` | about `+1400` | Rejects AAA. |
| Jasser / `active.hero.lethality.up` | `+791` | LLL `+2033` | about `+867` | Rejects LLL. |
| Ahmose, first defensive fixture | `+1631` | TTT `+2017` | `+1687..+1711` | Conflicts with TTT, but source lifecycle is not controlled. |
| Ahmose, stronger defensive fixture | `+2810` | TTT `+3301` | `+2499..+2530` | Also conflicts with TTT and remains unexplained; same lifecycle weakness. |

The old high-level Hendrik fixture is stochastic and used FC10/T11 troops. Prefer the newer clean Renee 4/4/4 + Hendrik 1/0/0 capture for the defense-down exclusion.

## Previous all-three-modifier candidate ledger

| Homogeneous candidate | Status | Reason |
| --- | --- | --- |
| `active.hero.damageTaken.up` | **Best supported; implemented** | Wins Charge decisively, is favored by the clean attacker-side Ahmose overlap, and is directionally supported by Gwen. |
| `active.hero.health.down` or another separate numerator bucket | **Still the principal alternative, but weakened** | Arithmetically identical to T in simple Renee-only/Hendrik fixtures; clean Ahmose favors T by 22+ survivors of error, but retains a residual. |
| `type.normal.damage.up` | **Not independently isolated** | A separate normal-only numerator bucket is equivalent to the H proxy in the present normal-attack Ahmose comparison. Do not call it positively excluded without a known same-bucket overlap test. |
| `type.single_target.damage.up` | **Rejected** | Charge overlap predicts the wrong winner by roughly 130 signed survivors. |
| `active.hero.damage.up` | **Rejected** | Edith overlap and activation count favor a separate bucket; legacy Edith capture strongly disagrees with UUU. |
| `active.hero.defense.down` | **Rejected** | Clean Hendrik overlap gives `+5` versus game `+14`, while H/T gives `+13`. |
| `active.hero.attack.up` | **Rejected by legacy screen** | Seo-yoon matching-bucket prediction is far from the game observation. |
| `active.hero.lethality.up` | **Rejected by legacy screen** | Jasser matching-bucket prediction is far from the game observation. |
| Three `extra_skill_attack` effects | **Rejected** | Wu Ming discriminator, ordinary-modifier fits, activation topology, and absence of Renee skill kills disagree with EEE. |
| Mixed per-skill assignments | **Closed** | Prior combined evidence established one shared type; later mixed T/S and T/H sweeps also fit much worse. |

An exotic unreported deferred-damage mechanic cannot be disproved solely from the Battle Details UI, but it is not a useful live candidate unless it explains the deterministic modifier-overlap results better than the shared-bucket model.

## Unresolved contradictions and residuals

1. **Clean Ahmose residual:** game `+3777` versus TTT `+3761..+3763`. The 14-survivor miss lies outside independent displayed-stat rounding corners. It is small in percentage terms (`-0.08%` in the testcase runner) but mechanically unexplained.
2. **Old Ahmose reversal:** both legacy defensive Ahmose reports favor non-T candidates or fall between candidate families. Source survival/lifecycle is a concrete flaw in those designs, but it has not been demonstrated to account quantitatively for the discrepancy.
3. **Gwen residual:** both Gwen overlaps favor the same group but miss by exactly four survivors. Gwen should remain supporting evidence only.
4. **Renee-only bucket equivalence:** solo and simple partner battles cannot distinguish damage-taken, health-down, normal-only damage, or other separate multiplicative representations when they act on the same normal jobs.
5. **Displayed stats:** reports expose one decimal place. Independent hidden precision was bracketed in the clean captures, but exact underlying hero/stat values remain unavailable.

Do not erase these residuals by changing published values or by selecting a formula that fits one report. A valid resolution should explain the clean Charge result, the clean Ahmose result, and the older contrary Ahmose reports under one state-derived rule.

## Best next experiments

1. **Repeat or reshape the attacker-side Ahmose overlap** with Ahmose Infantry guaranteed to survive and the target guaranteed to die first. Prefer a formation that increases the T-versus-separate-bucket gap while staying away from an extinction cliff.
2. **Find a deterministic, confirmed `type.normal.damage.up` overlap partner** if one exists. This would directly separate the remaining normal-only numerator candidate rather than using `health.down` as its arithmetic proxy.
3. **Test cadence under a blocked scheduled Lancer attack.** Arrange a deterministic pause/stun or same-round target exhaustion on an even turn, then use Battle Details activations and survivor predictions to distinguish strict turn cadence from every-second-successful-attack cadence.
4. **Test target persistence in a mixed defender.** Make Renee's Lancers mark one target, then force their target relationship to change before the following turn.
5. **Investigate Gwen separately** with a mixed all-T6 formation if the repeated four-survivor residual matters. Do not use that unresolved Gwen work as the load-bearing Renee discriminator.

## Artifact index

Tracked current evidence:

- [`renee_solo_nc.json`](../testcases/emulator_verified/renee_solo_nc.json)
- [`renee_wayne_mixed_510_vs_888.json`](../testcases/emulator_verified/renee_wayne_mixed_510_vs_888.json)
- [`renee_hendrik_defense_bucket_nc.json`](../testcases/emulator_verified/renee_hendrik_defense_bucket_nc.json)
- [`renee_gwen_bucket_retry_nc.json`](../testcases/emulator_verified/renee_gwen_bucket_retry_nc.json)

New captures from 2026-08-12, currently untracked at the time this ledger was written:

- [`renee_charge_single_target_bucket_nc.json`](../testcases/emulator_verified/renee_charge_single_target_bucket_nc.json)
- [`renee_ahmose_damage_taken_overlap_attacker_nc.json`](../testcases/emulator_verified/renee_ahmose_damage_taken_overlap_attacker_nc.json)
- Their frozen capture specifications are under [`skill/testcase_spec`](../skill/testcase_spec/).

Legacy evidence is in the stash named `WIP Renee skill fixtures and emulator captures`, including the zero/25/100-Lancer pairs and `renee_same_kind_*` partner captures. Stash indices move; locate it by name rather than assuming `stash@{1}`.

The reusable diagnostic scripts are gitignored:

- `skill/tmp/renee_fixture_design.ts`
- `skill/tmp/renee_single_target_probe.ts`
- `skill/tmp/renee_ahmose_attacker_search.ts`

The earlier broad-search session was `019fddb0-7140-7ea1-9b4b-a7b106bf578e`; the Charge/Ahmose continuation was `019ff3f8-802d-7f23-9097-6593cf328452`.
