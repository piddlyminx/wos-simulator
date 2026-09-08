# Gwen Blastmaster prospective fanout probe

## Captured result and open disagreement

The September 7 05:05:04 game battle ended with **1,397 WIP defenders: 241 Infantry, 581 Lancers and 575 Marksmen**. Exact troop counts, report stats and Gwen's 3/1/1 kit were checked visually. [Overview](report_top.png), [stats](report_stats.png), [skill details](bd_top.png), [defender troop details](defender-troops.png), and [transcription](observation.json) are retained. The WIP inbox view is the same battle, not another observation.

Replaying the frozen candidates with fresh report stats gives 1,388 defenders for current all-line targeting and 1,439 for current-target-only. Neither reaches the game endpoint in the 290-vector display-precision screen. Current behavior remains an unexplained nine-survivor mismatch.

Retrospective cadence diagnostics produce two plausible alternatives: first activation 5/every 5 gives 1,398 (238/583/577); first activation 6/every 4 gives exactly 1,397 (241/581/575). The latter still counts five simulated skill activations versus four displayed in the game, so a matching endpoint alone does not explain all reporting/timing behavior. The [prospective follow-up](followup/README.md) separates these alternatives by 25 survivors. No production mechanic has been changed at this stage.

## Original prospective protocol

Ready capture: `./skill/scripts/wosctl --instance minxxx run-testcase docs/mechanics-audit/probes/gwen-blastmaster/spec.json` (one deterministic observation).

minxxx's freshly confirmed full Gwen **3/1/1**, 800 T6 Marksmen, attacks WIP with no heroes and 600 of each T6 troop type. Every Gwen skill remains active. No troop skill contains chance at these tiers. The formation tests the previously uncovered S3's target fanout while all three defender lines remain alive, so no ordinary target transition is needed. Total initial troops: 2,600.

The two frozen hypotheses differ only in `Blastmaster/1` job targeting. Both retain its level-1 10% skill damage, first activation on the fifth Marksman attack, then every fourth attack, and identical full-kit S1/S2 behavior.

| Frozen hypothesis | Estimated defender survivors | By troop type: I/L/M | Rounds | Stat-precision sample range |
| --- | ---: | --- | ---: | --- |
| `all_living`: one job per living enemy line | 1,390 | 239 / 579 / 572 | 22 | 1,389–1,391 |
| `current_target`: one job at the normal target | 1,441 | 241 / 600 / 600 | 22 | 1,440–1,441 |

These are conditional forecasts using historical report-resolved stats from `skill/tmp/renee_gwen_2k_discriminator.ts`; only its Gwen-enhanced Marksman attacker stats are active here. No generation bonus was added. Current account drift may exceed the sampled ±0.05 display-rounding interval. The exact captured stats must replace these estimates before comparison.

The config snapshot SHA-256 is `bcb0d3068845ca143802c6e59cd7a530a8440606133b770613c418bed425b17c`. The full snapshot, exact estimated input, candidate modifications, provenance, 290-vector sensitivity screen, and per-job simulated trace are saved beside this note. No outcome from this formation has been opened before freezing it.

Capture the complete report and Battle Details, including all three defender survivor counts and Gwen's three skill rows. Under the estimated current model, Blastmaster activates five times at simulated attacks 5/9/13/17/21 and emits fifteen jobs. The untouched-backline versus damaged-backline prediction is the clearest diagnostic: only S3 can damage Lancers or Marksmen while Infantry remains alive in this formation. Raw simulator skill kills are not automatically the same units as report-attributed kills; use the complete troop outcome first. Battle Details provides totals, not a per-attack game trace. This probe cannot independently establish every-fourth cadence or calculation timing.

After capture, put the exact `BattleInput` into a new JSON file and preserve `estimated-input.json`/`prediction.json`. From `simulator/`, run:

```sh
npx tsx ../docs/mechanics-audit/probes/gwen-blastmaster/predict.mts /absolute/path/fresh-input.json /absolute/path/fresh-prediction.json
```

The replay loads `config-snapshot.json`, keeping the candidate definitions fixed. A total endpoint within 1–2 units plus the predicted backline losses supports the current fanout in this full-kit context. A materially wrong endpoint stays unresolved even if the skill activation count agrees. If fresh account stats make a defender line die, reassess target-transition confounding before drawing the fanout conclusion.
