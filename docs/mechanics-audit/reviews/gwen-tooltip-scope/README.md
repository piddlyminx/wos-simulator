# Gwen: skill description wording and attack scope

**The newly captured skill description text does not justify permanent S1 or the tested shared normal-attack modifier model.** Both alternatives worsen the decisive small Gwen battle and an older exact Renee/Gwen result. No production change follows this review. All seven accepted Gwen fixtures and all three skill descriptions were known before this bounded diagnostic; every result here is retrospective.

The actual [S1](../../hero-tooltips/minxxx-gwen-2026-09-07/skill_1-panel.png), [S2](../../hero-tooltips/minxxx-gwen-2026-09-07/skill_2-panel.png), and [S3](../../hero-tooltips/minxxx-gwen-2026-09-07/skill_3-panel.png) panels show:

- S1 increases the target's damage taken by 15% at level 3, with 5/10/15/20/25% preview. No duration or subsequent-attack wording is displayed.
- S2 grants all troops' attacks 20% extra damage after every five attacks and makes the target receive 5% extra damage for its next attack received.
- S3 equips Marksmen with grenades, dealing 10% extra damage to all enemies on the next attack of every four attacks.

All displayed magnitudes match the simulator config. The text leaves implementation details of attack counting, modifier consumption and normal-versus-skill damage unresolved. Earlier [causal review](../../probes/gwen-blastmaster/causal-review.md) had already disfavored a simple persistent S1 replacement; this package reproduces that disconfirmation with current arithmetic and the complete accepted Gwen corpus.

## Concrete causal alternative

Production advances an effect's attack delay while calculating each eligible damage job. Thus a newly created S1 skipped on normal damage can become active on an S2 component, then be consumed before S3's target jobs. The new snapshot candidate copies only the Gwen S1/S2 modifiers that actually contributed to the successful source normal attack. Those copies remain available to that attack's generated damage components, subject to their original target scopes. The real effects are charged once on normal damage; the components neither advance nor consume their live Gwen modifiers. Other modifiers retain their existing lifecycle. Canceled normal attacks retain current handling.

This is a limited Gwen modifier snapshot, not a copied whole damage result. No troop count, target selector, magnitude, source ceiling, fractional casualty storage or cap changes. Repeated source attacks then retain S1 for their normal damage instead of losing it to a preceding extra component; the resulting increase in normal damage explains why this candidate approaches persistent-S1 outcomes despite skipping S1 on the very first normal hit.

A separate `normal_augmentation` candidate additionally changes Gwen S2/S3's damage kind to normal, keeping the same 20%/10% coefficients and generated targets. This tests whether those components receive already configured normal-only modifiers. It does not redefine other heroes' damage kinds or establish that all game extra attacks share a universal implementation.

Four fixed behaviors—production per-job, persistent S1, normal snapshot, and snapshot plus normal-kind augmentation—are compared under two previously motivated S3 schedules: current first 5/every 4 and first 5/every 5. S2 remains first 5/every 6; neither cadence nor coefficients were fitted. All cases preserve complete actual hero kits and exact recorded troop/FC keys.

## Three fresh S3 battles

`D` denotes defender survivors and `A` attacker survivors. The game defenders are respectively 241/581/575,461/58/44 and 24/0/0 Infantry/Lancer/Marksman.

| S3 schedule / behavior |800M vs 600 each|800M vs 1200I/100L/100M|550M vs 810I/45L/45M|
|---|---:|---:|---:|
| Game |D1397|D563|D24|
| Current / per-job |D1388|D534|A76|
| Current / permanent S1 |D1366|D455|A141|
| Current / normal snapshot |D1369|D460|A139|
| First 5/every 5 / per-job |D1399|D579|D125|
| First 5/every 5 / permanent S1 |D1377|D515|A63|
| First 5/every 5 / normal snapshot |D1381|D519|A62|

Normal-kind augmentation has exactly the same survivor vectors as normal snapshot in all three formations, so these battles do not distinguish those two damage kinds. The first 5/every 5 snapshot also predicts S2/S3 counts 12/15 in the small battle versus the game's 15/18. Matching a first battle or one subtotal cannot rescue its opposite winner and 86-troop signed error at 550 vs 900.

[snapshot-checks.json](snapshot-checks.json) verifies 418 generated Gwen jobs across 12 formation/variant pairs: every S1/S2 value equals the normal parent's snapshot, with S2's Infantry-only target restriction preserved when fanout hits a backline. The live source files are hash-checked and unchanged; only isolated simulator-loop/extra-job copies are patched. The damage formula and casualty commit logic are untouched.

## Older accepted evidence and strongest disconfirmation

All paths below are under `testcases/emulator_verified/`; each is row #0.

| Fixture | Recorded game | Current per-job | Permanent S1 | Normal snapshot | Normal augmentation |
|---|---:|---:|---:|---:|---:|
|`renee_gwen_bucket_retry_nc.json`|A318|A318|A324|A324|A327|
|`gwen_solo_nc.json`, five outcomes|A3006 each|A3011|A3003|A3003|A3003|
|`logan_gwen_combo_nc.json`|D403|D403|D403|D403|D403|

Renee/Gwen preserves full Renee 3/3/3 plus Gwen 2/1/0 and 500 T6 Lancers versus 900 T6 Infantry. It is the strongest older discriminator: an exact 318 becomes 324 or 327 within the user's usual small-army testing scale. The changed damage-kind branch can matter here because Renee's existing Dreamcatcher/Dreamslice modifiers apply only to normal damage. The three-troop difference between the two snapshot variants demonstrates this context's ability to distinguish damage kind, without proving the current Renee/Gwen interaction uniquely correct.

The larger Gwen solo result improves from a five-troop to a three-troop residual; that small change at 4,069 vs 600 cannot outweigh the explicit failures above. Logan/Gwen provides no endpoint discrimination. The single stochastic `gwen_norah_combo_nc.json` outcome is A2668. At 1,000 shared-seed samples per candidate, current mean 2696.09 has combinedp 0.722664; persistent mean 2673.18 hasp 0.9997; snapshot/augmentation mean 2673.39 hasp 0.999. All are plausible given that one game observation. S3 is zero in these older fixtures, so their two schedule results are identical.

## Reproduction and limits

`protocol.json` freezes the named hypotheses, all source and skill description hashes, config, inputs and scripts before simulation. `results.json` preserves all 56 fixture/model comparisons, each raw score and A/D totals, first-run job traces, survivor vectors and activation counts. Stochastic seeds are `gwen-tooltip-scope-0` through `-999`; scores are A−D, including draws.

```sh
npx tsx docs/mechanics-audit/reviews/gwen-tooltip-scope/replay.mts /absolute/new-output.json
python docs/mechanics-audit/reviews/gwen-tooltip-scope/check-results.py
```

Replay refuses an existing output and fails if frozen files or source hashes change. `freeze.mts` documents package creation and refuses to overwrite the original files. This package adds no battle observations and changes no accepted fixture or earlier prospective result. It rules against these specific semantic replacements; the absence of duration wording in S1 is not itself evidence that the current one-charge lifecycle is right, and the underlying Gwen disagreement remains open.
