# Hendrik S3 fanout: captured 2026-09-07

The accepted game report dated **2026-09-07 06:02:19** leaves **471 defenders: 313 Infantry, 82 Lancers and 76 Marksmen**. The exact-report-input current model leaves **476 (314/84/78)**; the frozen current-target-only alternative leaves **516 (316/100/100)**. The observed 18 Lancer and 24 Marksman casualties occur behind 313 surviving Infantry, supporting S3 damage to multiple living enemy lines in this full kit. The five-survivor residual is about 1% of the predicted endpoint; it remains recorded without declaring it material solely because it exceeds two troops.

Game Battle Details reports **S2 five activations; S3 six activations and 17 kills**. Those activation counts match current scheduling. The skill-kill display is not interpreted as total fractional damage. [Observation](observation.json), [defender troop transcription](defender-troops.json), [screenshot](defender-troops.png) and [captured replay](captured-prediction.json) preserve the result. Defender mail **2734692464122617** is another view of this same battle.

A [retrospective diagnosis](retrospective/README.md) checks the previously motivated S2 alternatives against both Hendrik captures. A first-round-2/every-3 S3 phase exactly reproduces 313/82/76, but schedules seven activations, including one in terminal round 20. The reported six activations therefore leave a timing or reporting ambiguity. This exact fit was found after seeing the outcome and is not independent confirmation. No Hendrik production definition was changed. Exact S3 phase, magnitude, damage kind, other levels and interactions remain unverified.

## Frozen prospective design (historical)

The following design and forecast were recorded before this Marksman battle was observed. WIP attacks with full **Hendrik 3/3/3 and 250 T6 Marksmen**. Minxxx defends with **no heroes, 400 T6 Infantry + 100 T6 Lancers + 100 T6 Marksmen**. T6 retains baseline class passives and avoids higher-tier chance/FC skills. No joiners or other heroes are introduced.

The primary comparison is current S3 damage to **each living enemy troop line** versus S3 damage to **only the current normal-attack target**. All other skills and settings remain identical. Each live kit is preserved; the alternate target rule exists only in the simulator.

| Frozen candidate | Minxxx survivors (I/L/M) | Rounds | Sampled ±0.05 stat range |
| --- | --- | ---: | --- |
| Current engine, S3 all living targets | **476 (314/84/78)** | 20 | 475–476 |
| Current engine, S3 current target only | **516 (316/100/100)** | 19 | 516–517 |
| Outer army-term ceiling removed, all living targets | **476 (314/84/78)** | 20 | 476 |
| Outer army-term ceiling removed, current target only | **516 (316/100/100)** | 19 | 516 |

The fanout alternatives differ by **40 survivors**, while the named arithmetic counterfactual changes neither nominal result. The current configuration predicts **16 Lancer and 22 Marksman casualties** behind surviving Infantry; the target-only alternative leaves both backlines untouched. All defender lines survive all four candidates and all 1,160 stat sensitivity trials, with at least 78 troops in the smallest line. This avoids mixed-target exhaustion while positively exercising S3.

Both target rules produce six scheduled S3 activations, on rounds **3, 6, 9, 12, 15, 18**. Current fanout emits 18 skill jobs; target-only emits six. Battles end on rounds20/19, away from an S3 activation round. Current S1/S2/S3 activation counts are1/5/6. These are simulator diagnostics, not independent primary observations or guarantees of how game Battle Details count activations.

The formation was selected through simulator-only screening of nine defender formations and nineteen attacking Marksman counts. At 850 initial troops, the current model predicts 374 total casualties and a substantial target-rule separation. This is a small useful discriminator, not an assertion of globally optimal probe design. The screening path/hash is recorded in `manifest.json`. No new control fixture was created.

## Inputs, arithmetic and interpretation

All stats come from the preceding accepted Hendrik Lancer report dated **2026-09-07 05:42:10**, whose endpoint matched17. That observation was known before designing this new probe. Its [captured input](../hendrik-armor/captured-input.json) supplies WIP Marksman Attack/Defense/Lethality/Health **465.5/458.7/244.0/218.8**, minxxx no-hero Marksmen **292.2/292.7/235.8/230.3**, and all other report fields.

**Roles reverse:** WIP now attacks and minxxx defends. The hero/account lineups remain as captured, but all report stats must be checked again for this battle before interpretation. The estimated input is conditional on the earlier displayed stats, not a bound on account or role changes. These values already include hero-generation bonuses; do not add generation stats again.

The precision screen uses sixteen active stat fields, each within displayed ±0.05: 256 shared interior vectors, 32 one-coordinate endpoints, and two opposing corners, seed **20260909**. Every vector and resulting endpoint is retained. This is not an exhaustive interval proof and does not cover account-state changes.

The arithmetic alternative supplied by the parallel evidence review changes only:

```ts
ceilIgnoringFloatResidue(Math.sqrt(dealerTroops) * Math.sqrt(initialArmy))
```

to:

```ts
Math.sqrt(dealerTroops) * Math.sqrt(initialArmy)
```

The inner source-troop ceiling remains. At forecast time, removal of the outer ceiling was a separately named arithmetic counterfactual. That correction was subsequently adopted independently; both frozen nominal predictions here remain unchanged. Fractional survivor state and the established ceiling on source units used for attack strength are retained. The forecast does not materially depend on the outer arithmetic choice at these inputs.

A matching complete endpoint and backline casualties would support **positive S3 damage from Marksmen to multiple enemy troop types** and discriminate this target-only alternative, conditional on the combined S1/S2 model. One/two-troop accuracy is the usual deterministic target, interpreted with battle scale. Residuals should be disclosed and assessed for practical significance; an apparently matching skill-kill subtotal cannot resolve them.

This probe **cannot independently establish** exact S3 damage-kind/bucket placement, 24% magnitude versus nearby coefficients, cross-level scaling, every possible timing phase, interactions with other heroes, zero/depleted-target handling, or rally/widget behavior. It also does not independently validate each S1/S2 coefficient or their Marksman scope merely because the full-kit endpoint agrees. The preceding Lancer-only experiment supported a non-Marksman S2 contribution and rejected S3 sourced from Lancers; this new battle provides the missing positive Marksman branch.

## Original capture command and guarded replay

The capture is complete. This command records the original procedure; do not repeat it to obtain another view of the same report:

```sh
./skill/scripts/wosctl --instance WIP run-testcase docs/mechanics-audit/probes/hendrik-dragons-heir/spec.json
```

The saved artifacts preserve actual formation/hero confirmation, report overview, Stat Bonuses, per-line survivor counts and full Battle Details. WIP was the attacker and minxxx the defender. The defender-view report remains part of the same battle observation.

`captured-input.json` now contains the exact new report values, preserving the full kit, troop keys/counts, side roles and empty joiner lists. The guarded replay command accepts fresh input and an unused output path:

```sh
npx --yes tsx docs/mechanics-audit/probes/hendrik-dragons-heir/predict.mts /absolute/fresh-input.json /absolute/captured-prediction.json
```

The package contains a **frozen 29-file runtime source snapshot**, full config, explicit target-rule patches and the verified single-line arithmetic patch. Replay verifies frozen artifact/source hashes, materializes both isolated engines in a private temporary directory, runs the candidates, and removes that directory. It does not import mutable production combat code or depend on the original shared temporary runtime. Later production changes cannot silently alter the forecast. Existing outputs are never overwritten.

The original prospective prediction SHA256 is **`92c1a4f981205cb3756c7747ea89f927a1c9ce925926862906ab1405bc4f1e86`**. `manifest.json` records original source/report/roster hashes and the exact prospective command. Preserve `prediction.json`; a post-capture replay writes a new output and makes no claim of blindness to the new outcome.

Validation: all four candidates and1,160 precision trials completed with deterministic hydration. The frozen arithmetic patch exactly matches the supplied isolated runtime. JSON parsing and output overwrite protection were checked; the prospective prediction remains unchanged.
