# Mixed-target parity investigation

Working evidence ledger, updated 2026-08-11. This document is intended to be read at the start of a future session before continuing the investigation. It is not a claim that every current simulator behavior is game truth.

The separate attack-trigger refactor and its unresolved skill questions are recorded in [`attack-trigger-regime-2026-08.md`](./attack-trigger-regime-2026-08.md). Do not duplicate that investigation here.

## Purpose and current focus

The immediate anomaly is the deterministic Wu Ming solo battle:

- WIP attacks with Wu Ming 3/3/3 and 170 each T6 Infantry, Lancers, and Marksmen.
- minxxx defends with 380 each T6 Infantry and Lancers and no heroes.
- Game: minxxx wins with 200 Lancers.
- Simulator using the displayed report stats: minxxx wins with 219 Lancers.
- Testcase runner after its current favourable `+0.05` attacker / `-0.05` defender stat adjustment: 218 Lancers.

The aim is to determine whether the residual comes from a wrong hero/troop mechanic, mixed-line target-transition behavior, damage/count precision, insufficiently precise testcase inputs, or another round-boundary rule. Do not fit a change to this one result without checking the isolated Wu evidence and the wider deterministic corpus.

## Conclusions with the strongest support

### 1. The configured Wu Ming skills are individually well supported

| Evidence | Game | Current testcase result | What it supports |
| --- | ---: | ---: | --- |
| `wu_ming_s1_isolation_nc` | WIP +178 | exact | S1 reduces normal damage taken by Wu's Infantry at its configured 15%. |
| `wu_ming_s2_isolation_nc` | WIP +40 | exact after report-stat allowance | S2 is active and applies to non-Infantry normal damage; the current all-troop `active.hero.damage.up` interpretation is supported. |
| `wu_ming_marksman_vs_infantry_nc` | minxxx +11 | exact | Current Wu + Ranged Strike normal damage is correct in a single-line battle. Wu S3 does not amplify normal Marksman damage or Ranged Strike. |
| `wu_ming_bradley_current_nc` | WIP +112 | exact | The combined current Wu/Bradley model is coherent; in particular Wu S2 shares Bradley S3's damage-up family and Wu S3 remains inert without skill-damage jobs. |

The single-line Marksman discriminator is especially important. The current model predicts 11 defending Infantry, exactly matching the game. Making Wu S3 amplify only Ranged Strike predicts 17 attacking Marksmen; making it amplify the whole normal attack predicts 123 attacking Marksmen. The mixed-battle discrepancy is therefore not good evidence that Wu makes Marksmen intrinsically stronger than currently modelled.

### 2. Game evidence supports no same-round retargeting

`retarget_lancer_screen_nc` uses WIP 100 T6 Lancers + 400 T6 Marksmen against minxxx 1 T6 Lancer + 499 T6 Marksmen. The Lancers kill the one defending Lancer before the WIP Marksmen act.

- No retargeting prediction: 303 defending Marksmen.
- Attack-time retargeting prediction: 282 defending Marksmen.
- Game: 303.
- Current simulator: 303.

Keep the locked target and skip a later attack when that target has already been exhausted in the round. Do not introduce retargeting to fix the Wu residual unless stronger contrary game evidence is found.

### 3. The Wu residual is located at a mixed-line extinction/target boundary

In the current simulator, a troop line with any positive fractional count remains alive. For outgoing damage its count is ceiled, so even `0.001` contributes as one troop. Targets are selected from the round-start snapshot; a line that survives by a tiny fraction can receive the round's attacks, and attacks whose locked target becomes exhausted are skipped rather than redirected.

These rules create sharp state transitions. A tiny damage change can:

1. kill defending Infantry one round earlier;
2. make Lancer and Marksman attacks target defending Lancers one round earlier;
3. allow attacking Infantry to survive and absorb attacks for another round;
4. preserve attacking Lancers, changing several later rounds;
5. change the final result by tens of troops even though the initiating damage change was very small.

This is not Wu-specific. The same shelf-and-jump behavior was reproduced without Wu once enough Marksmen were present to cross the defender Infantry extinction boundary.

### 4. The testcase inputs are not precise enough to infer small arithmetic details directly

Battle reports display each Attack, Defense, Lethality, and Health bonus to one decimal place. The underlying value is therefore approximately within `displayed ± 0.05`. Across two sides, three troop types, and four stats, a mixed testcase can contain up to 24 hidden rounding residuals.

The testcase runner's current stat allowance is only a one-dimensional best-effort probe:

- add the same value, up to `+0.05`, to every reported attacker stat;
- subtract it from every reported defender stat, or use the opposite direction;
- choose the direction that reduces the aggregate result bias.

It does **not** explore each stat's interval independently and does not calculate the full plausible outcome envelope. For the original Wu case this changes 219 defenders to 218, not 200.

Because the battle function is discontinuous near extinction boundaries, hidden input uncertainty can produce much more output uncertainty than its size suggests. This creates two cautions:

- a materially different result is not automatically evidence of a mechanics error if plausible hidden stats cross a battle-state boundary;
- candidate in-game damage-rounding regimes cannot be distinguished when their plausible hidden-stat outcome sets overlap.

The existence of a nearby cliff does not prove that the actual `±0.05` stat region crosses it. That must be tested per testcase.

## Key quantitative evidence

### Per-stat hidden-precision audit

Hypothesis tested: the original 200 result is reachable under the unchanged battle mechanics by substituting two-decimal stat values inside each displayed stat's independent `±0.05` interval.

The raw simulator initially appeared to support the hypothesis. A seeded search found 200 after 18 samples, and an exhaustive sparse search found a two-stat construction with every other stat unchanged:

- WIP Infantry Defense `414.50 → 414.53`;
- WIP Infantry Health `260.10 → 260.13`.

No single two-decimal stat substitution produced 200. The two-stat result was not a normal hidden-precision shelf, however. It left approximately `5.7e-14` WIP Infantry after round 56. That numerically empty line remained eligible for target selection in round 57, absorbed the defending attacks, and preserved WIP's Lancers. The same stat vector left the linked 190-versus-417 follow-up at 179 rather than its observed 180.

This was checked over 100,000 seeded shared stat vectors. Without normalizing committed troop residue, the original results were 219 (90,116 vectors), 218 (7,827), 200 (1,504), or 199 (553). Of the 1,504 vectors producing 200, 1,503 produced 179 in the linked follow-up and one produced 155; none produced 180.

A diagnostic variant then snapped a committed troop count down when it was within `1e-12` above an integer. This is not retained as a mechanic. Under that residue-safe diagnostic:

- 100,000 seeded vectors in the ordinary two-decimal interval (`-0.05…+0.04`) produced only 218 or 219;
- another 100,000 vectors in the deliberately wider inclusive `±0.05` box also produced only 218 or 219;
- exhaustive searches of every one- and two-stat substitution in the wider box (27,840 combinations) found no 200;
- the globally attacker-favourable corner produced 218 and the globally defender-favourable corner produced 219;
- both dominance corners retained the decisive schedule: WIP Infantry was exhausted in round 56, minxxx Infantry survived round 57 and was exhausted in round 58, and attacks first moved to Lancers in round 59;
- even at the attacker-favourable corner, minxxx Infantry started round 58 at `3.3461`, well clear of the earlier-target-transition boundary.

Because the two dominance corners preserve the same extinction schedule, every intermediate stat vector is bounded between their 218 and 219 outcomes under the residue-safe arithmetic. The independent hidden-stat box therefore does **not** explain 200 by itself. Reaching 200 inside that box requires the separate and currently unverified behavior that a machine-scale post-subtraction residue remains a living target.

### Original Wu Ranged Strike counterfactual sweep

Ranged Strike is configured as 10% damage up for Marksmen against Infantry. Changing its value is a diagnostic counterfactual, not evidence that its real value differs from 10%.

| Ranged Strike value | Reported defending Lancers | First round attacker targets Lancers | Important boundary |
| ---: | ---: | ---: | --- |
| 8.00–8.88% | 236 | 60 | Defending Infantry survives into round 59. |
| 8.89–11.42% | 219 | 59 | Defending Infantry reaches zero one round earlier. |
| 11.43–12.01% | 218 | 59 | Same target schedule; defending Infantry crosses from two ceiled source troops to one. |
| 12.02–12.04% | 200 | 58 | Defending Infantry is zero at round 58 start. This happens to match the game. |
| 12.05–14.00% | 169 | 58 | Attacking Infantry also survives round 57 by a fraction, preserving Lancers and extending the battle. |

Critical trace values:

- At 12.01%, defending Infantry starts round 58 at `0.019`; Lancers and Marksmen still target it.
- At 12.02%, defending Infantry starts round 58 at zero; both target Lancers instead. The result jumps from 218 to 200.
- At 12.04%, attacking Infantry is already zero at round 57 start, and attacking Lancers start round 58 at `150.552`.
- At 12.05%, attacking Infantry starts round 57 at `0.001`, attacks and absorbs that round's attacks; Lancers start round 58 at 170. The result jumps from 200 to 169.
- At 11.42%, defending Infantry starts round 58 at `1.045`; at 11.43% it starts at `0.988`. The ceiled dealer count changes from two to one without changing target round, producing the smaller 219-to-218 step.

The artificial 200-result window is only 0.03 percentage points wide. It demonstrates boundary sensitivity, not the correct Ranged Strike value.

### Marksman-count sweep

Changing Marksman count in the original fixture also produces discontinuities and non-monotonic results:

| Attacking Marksmen | Defending survivors |
| ---: | ---: |
| 168 | 220 |
| 169 | 201 |
| 170 | 219 |
| 173 | 217 |
| 174 | 196 |
| 180 | 191 |
| 181 | 157 |

This sweep has a confounder: damage uses `min(initial attacker army, initial defender army)` in every job's army term. Changing Marksman count can therefore change damage for every line on both sides. Holding that army term fixed at 510 still leaves strong discontinuities:

- 167→168 Marksmen: 238→220 defenders.
- 176→177 Marksmen: 214→162 defenders.

The global army term adds further boundaries but is not the cause of the underlying extinction behavior.

### Reproduction without Wu

With Wu removed, the displayed stats retained, 255 Marksmen, and the global army term fixed at 510, a Ranged Strike sweep produced these transitions:

| Boundary | Defending survivors | Defending Infantry extinction/target round |
| ---: | ---: | ---: |
| 8.80→8.81% | 377→372 | 66→65 |
| 9.75→9.76% | 371→365 | 65→64 |
| 10.91→10.92% | 365→358 | 64→63 |
| 13.76→13.77% | 349→340 | 62→61 |
| 19.19→19.20% | 320→296 | 59→58, with additional attacker-survival changes |

Without Wu and with only 170 Marksmen, defending Infantry never dies before the attacker loses, so changing Ranged Strike from 8–14% produces only small report-rounding shelves and no large jumps. The large effect therefore requires a consequential state boundary; it is not present in every battle.

A single-target control against only Infantry, sweeping Marksman count from 100–260, produced 161 distinct results and no adjacent jump of four or more. Removing the target transition removes the pronounced shelves.

### Per-line kill evidence

The game report's troop-line `Kills` values approximately show the 35% seriously-injured share of casualties; the losing side's other 65% is restored as lightly injured. Treat these as rounded report values, not exact raw casualties.

Original Wu solo:

| Attacker source | Game report kills | Simulator raw kills × 0.35 |
| --- | ---: | ---: |
| Infantry | 17 | 18.1 |
| Lancer | 60 | 59.0 |
| Marksman | 119 | 112.6 |

The Infantry/Lancer differences mostly cancel; the missing Marksman-attributed kills are approximately the aggregate 18–19 troop residual after reversing the 35% scaling. This is consistent with a missed Marksman attack against Lancers at a target-transition boundary.

Wu + Bradley:

| Attacker source | Game report kills | Simulator raw kills × 0.35 |
| --- | ---: | ---: |
| Infantry | 18 | 18.7 |
| Lancer | 66 | 67.0 |
| Marksman | 546 | 544.3 |

The source allocation is close and the final survivor result is exact. This supports the current Wu/Bradley mechanics but also shows that small source-level differences can cancel in an aggregate result.

## Current simulator mechanics relevant to the investigation

- Casualties remain fractional internally and are committed at round end.
- Every normal attack uses its source troop count snapshotted at round start; units killed earlier in the round still make their scheduled attack.
- `dealerTroops = ceil(positive round-start source troops)` for the damage army term.
- The count contribution is `ceil(sqrt(dealerTroops × minInitialArmy))`, where `minInitialArmy` is the smaller initial total army.
- Raw damage is currently kept at float64 precision per damage job; near-integer output/source ceilings ignore machine-scale residue.
- A target is selected from the round-start troop snapshot. If earlier same-round jobs exhaust that locked target, a later job is skipped rather than retargeted.
- Remaining result troop counts are ceiled for output.
- The loop remains side-major: attacker Infantry/Lancer/Marksman, then defender Infantry/Lancer/Marksman. A diagnostic unit-major reorder did not change the original Wu result because round-start attack snapshots still preserved the relevant attacks.

All of these bullets describe current simulator behavior. Round-start source snapshots and no same-round retargeting also have dedicated game/test evidence; the precise fractional and rounding rules remain under investigation.

## Explanations tested and not supported

### Simple final-round termination

Stopping immediately when an army first reaches zero does not explain the Wu result. A diagnostic unit-major + immediate-stop implementation moved the original case to 222 defenders and the follow-up to 182, both worse than the game. Across the deterministic corpus it reduced exact matches from 108 to 86 and increased total absolute error from 584.53 to 753.53. The change was reverted.

### Global attack ordering alone

Changing side-major execution to unit-major execution did not change the original Wu result under the round-start snapshot rules. Global order may still deserve a dedicated game discriminator, but it is not an explanation for this residual by itself.

### Same-round retargeting

Rejected by `retarget_lancer_screen_nc`: game and current no-retargeting simulator both give 303; retargeting predicts 282.

### Ordinary damage precision alone

The scaled follow-up battle (190 each versus 417 Infantry + 417 Lancers) gives 180 defenders in game and 179 in the current simulator. Current ceil-to-3dp, unquantized float64, float32, nearest-to-2dp, and ceil-to-2dp all predict 179. Global floor-to-2dp predicts 155 and is rejected by this follow-up.

Across 157 deterministic cases using the testcase runner's current stat adjustment:

| Regime | Passing | Exact | Total absolute error |
| --- | ---: | ---: | ---: |
| Current ceil-to-3dp | 155 | 109 | 584.53 |
| Float damage without per-job rounding | 155 | 107 | 587.53 |
| Float + near-integer snap after each job at 0.04 | 154 | 113 | 573.53 |
| Float + near-integer snap at round end at 0.04 | 154 | 115 | 574.53 |

The 0.04 snaps marginally improve aggregate fitting but lose a passing case, regress known cases such as Jessie, depend on a narrow unexplained constant, and leave original Wu at -18 adjusted bias. They are not a defensible mechanic.

Near-zero cutoffs become rapidly worse as the threshold grows. Percentage/absolute culling variants can improve selected no-hero mixed cases but regress the broader corpus and have no confirmed game basis. Do not add an epsilon/cutoff merely because it fits the Wu or no-hero boundary cases.

## What remains unresolved

1. **Does the game keep machine-scale post-subtraction residue targetable?** The per-stat audit reaches 200 only when approximately `5.7e-14` WIP Infantry remains eligible to absorb the next round. Normalizing that residue constrains the independent hidden-stat box to 218–219.
2. **What exact count/precision rule does the game use for a small positive troop remainder?** Current simulator uses fractional state plus ceiled positive source count. The observed cliff is compatible with several nearby alternatives, but none is confirmed.
3. **Are there other mixed-target cases whose apparent residuals are input-precision boundary artifacts?** This has not been audited systematically.
4. **Can in-game damage rounding be inferred at all from 1dp report stats?** Only if candidate rounding models remain separated after shared hidden-stat uncertainty is included.
5. **Is the simulator's side-major attack order correct game behavior?** It did not cause this mismatch alone, but the user expects Marksmen to attack last globally. A purpose-designed game discriminator is still needed if this is pursued.
6. **How correlated are the hidden report-stat residuals?** Treating all 24 values as independently variable gives a conservative box, but shared bonus sources may constrain achievable combinations.

## Recommended next work

### 1. Build a stat-uncertainty audit before changing mechanics

For every deterministic testcase, or initially the focal mixed cases:

1. Preserve the displayed-stat baseline.
2. Perturb every displayed stat individually by ±0.05 and record result, round count, troop-line extinction rounds, and target transitions.
3. For sensitive cases, sample combinations inside the interval box. Do not assume aggregate battle score is monotonic; the Marksman-count sweep disproves that near state boundaries.
4. Classify the case as:
   - robust match;
   - compatible after input precision;
   - boundary-sensitive/poor discriminator;
   - robust mismatch.
5. Report both the raw displayed-stat result and the uncertainty envelope. Do not silently replace one with the other.

The full independent box may include combinations not achievable from shared bonus sources. If possible, add constraints from known account/loadout components. Until then, call it a conservative envelope.

### 2. Reassess rounding only on stable evidence

Use short, deterministic, T6, preferably single-line paired battles with the same accounts and unchanged stats. Avoid target extinction, winner-round, and integer-source-count boundaries. Candidate rounding models should use the same hidden stat values across a linked set of battles and be validated on held-out battles; do not fit hidden stats separately per testcase.

### 3. Do not change Wu or retargeting from current evidence

Wu's isolated skills and single-line Marksman behavior match. The no-retargeting game discriminator matches exactly. Keep these as constraints while investigating the residual.

## Experimental discipline for future captures

- Use `./skill/wosctl`; do not touch the `Piddlyminx` emulator/account. WIP and minxxx may be used.
- Use T6 unless the mechanic being tested is a troop skill; T7+ Lancers and Marksmen add stochastic skills.
- Prefer roughly 500 troops and reasonably even battles for resolution without excessive healing.
- Before requesting an emulator capture, write down:
  1. the exact question;
  2. each plausible interpretation;
  3. estimated simulator outcomes under each interpretation using recent stats;
  4. how each possible report range changes the conclusion.
- After capture, replace estimated stats with the exact displayed report stats and rerun every unchanged candidate.
- A diagnostic config change may explore sensitivity, but never present an arbitrary skill value as game evidence and always revert it afterward.
- Preserve a confirmed/rejected/unresolved ledger. Do not reinterpret an outcome after seeing it without reopening the precommitted candidates.

## Relevant artifacts

- `testcases/emulator_verified/wu_ming_solo_current_nc.json` — focal 200 versus 218-adjusted residual.
- `testcases/emulator_verified/wu_ming_rounding_followup_nc.json` — scaled follow-up, 180 game versus 179 simulator.
- `testcases/emulator_verified/wu_ming_s1_isolation_nc.json` — exact S1 evidence.
- `testcases/emulator_verified/wu_ming_s2_isolation_nc.json` — exact/within-report-precision S2 evidence.
- `testcases/emulator_verified/wu_ming_marksman_vs_infantry_nc.json` — exact single-line Wu/Ranged Strike evidence.
- `testcases/emulator_verified/wu_ming_bradley_current_nc.json` — exact combined Wu/Bradley evidence.
- `testcases/emulator_verified/retarget_lancer_screen_nc.json` — decisive no-retargeting evidence.
- `simulator/src/damage.ts` — source count, army term, and per-job damage precision.
- `simulator/src/simulator.ts` and `simulator/src/runtime.ts` — round snapshots, target selection, exhaustion, casualty commit, and output.
- `simulator/src/tooling/testcases.ts` — current one-dimensional report-stat adjustment and deterministic comparison rules.

All diagnostic sweep instrumentation described here was removed. The JSON testcase fixtures and this document are the durable evidence.
