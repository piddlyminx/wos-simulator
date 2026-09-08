# Reina ShadowBlade scope probe

**The original design was frozen before any new Reina1/1/1 outcome was read. All five captures are complete; individual observations and fresh-stat inputs are saved in `capture-01/` through `capture-05/`.** WIP attacks with full **Reina1/1/1 and350 T6 Lancers**. Minxxx defends with **no heroes,150 T6 Infantry +50 T6 Lancers +50 T6 Marksmen**. Both armies are below1000 troops. No live skill is disabled, and there are no joiners or higher-tier/FC troop effects.

## Captured results — September 7, 2026

**Level1 correction supported in this context:** Paul raised whether the displayed120% includes the ordinary100% attack, implying a net20% increment. The five results favor the additional120% implementation. A [bounded S1/S2 challenge](../../reviews/reina-alternate-semantics/README.md) tested normal-kind20% delivery and two dodge-timing alternatives; none explains the five outcomes, and extending reactive dodge through the round also contradicts an older S3-locked case. The correction is retained; the skill description alone was not decisive. The recorded observations and original forecasts remain unchanged.

The game directly displays **Shadow Blade damage120%/140%/160%/180%/200%**. See the [level-one report skill description](shadow-blade-level1-tooltip.png) and [full upgrade preview](shadow-blade-upgrade-preview.png). The production coefficient array uses these values. Only level1 has S3-enabled battle evidence here; levels2–5 remain untested in battle. The archived original predictions remain unchanged; `current` in those frozen files means the original20% model.

| Battle | Displayed time | Defender Infantry / Lancer / Marksman | S3 triggered / displayed kills |
|---|---|---|---|
|1|06:43:14|66 /50 /50|8 /5|
|2|06:49:54|63 /50 /50|9 /7|
|3|07:00:42|63 /50 /50|9 /8|
|4|07:03:34|57 /50 /50|10 /8|
|5|07:05:54|74 /50 /50|6 /3|

All five attackers have zero survivors; both sides report zero losses. Every battle preserves the Infantry screen and both complete backlines. The defender endpoints166,163,163,157,174 have mean164.6, sample variance38.3 and sample SD6.1887. Every S1/S2 diagnostic shows triggered1 with a dash for attributed kills; S2's displayed1 is not treated as the number of dodges. No game round count was shown.

Fresh Reina Lancer stats are **326.2 Attack /325.0 Defense /186.8 Lethality /181.9 Health**, adding117.7/117.6 Attack/Defense to the conditional nohero fields. All five actual report inputs match. The [first fresh-stat replay](capture-01/replay.json) gives the old20% model mean179.17/SD1.97, while the independently [frozen120% interpretation](../../reviews/reina-extra-attack-magnitude/README.md) gives162.89/SD6.53. These five observations are compatible with the corrected coefficient in this full-kit formation. They do not isolate every chance, damage-kind or S1/S2 interaction.

The120% alternative was recorded by the root reviewer after the first outcome but before the root read the other four. The capture agent had seen the second outcome before receiving that forecast; the skill description and full curve were subsequently read directly. The final three outcomes were unread by either agent when the120% forecast and displayed curve were known. This exposure history is retained in the independent review.

[Capture summary](capture-summary.json) maps all five distinct timestamps/mail IDs to individual `observation.json` files, images and the testcase's five entries under `game_report_result`. The fixture is `testcases/emulator_verified/reina_shadowblade_350l_vs_150i_50l_50m.json::0`. Counterpart mail never adds a second observation. The third original stats screenshot contains a transient toast; its two incorrect Infantry Attack OCR fields were corrected from the clean counterpart's same-battle image, with the raw input and original testcase retained in [input-correction.json](input-correction.json).

The battle evidence exercises level1; the full higher-level coefficient curve is supported by the displayed upgrade preview. Paul separately [confirmed S3 is skill damage](../../damage-kind-confirmation-2026-09-07.md); the magnitude captures do not independently prove that classification. Exact25% proc behavior, all-source ownership, S1/S2 interactions and target-exhaustion behavior remain partly identified. [S1 and S2 skill descriptions](other-skill-upgrade-previews.json) were also captured without upgrading anything.

The accessible gap is **S3 ShadowBlade**, not S2 SwiftJive. The refreshed WIP roster has1/1/1; minxxx has2/2/0. Existing accepted Reina fixtures, including `reina_solo_wip.json` and `reina_attacker_wip.json`, have S3 locked. S2's current implementation rolls a4% dodge on an incoming normal attack at this level; its config still carries a `tbd` note. This probe retains that behavior rather than assuming it has been independently settled.

The main comparison is S3's current normal-attack target versus all living enemy troop types. Surviving defending Infantry separates these possibilities: current-target S3 leaves both backlines untouched, while fanout causes additional backline casualties. The other candidates record weaker questions without claiming this probe resolves them.

## Original conditional predictions before capture

**Fresh Reina report stats were not known at design time.** `estimated-input.json` copies WIP's observed **nohero** Lancer block208.5 Attack /207.4 Defense /186.8 Lethality /181.9 Health from the Hendrik Lancer report. It is a conditional starting input, not a Reina measurement. Selecting Reina can change hero and equipment stats. Minxxx's nohero fields come from that same report. The fresh-stat replays above replace these fields with the exact captured report stats without adding hero-generation bonuses again.

| Frozen model | Mean minxxx survivors | Central90% per-battle range | Central95% five-battle mean | Backline losses, central90% |
|---|---:|---|---|---|
| Current full kit, S3 current target |213.37|211–215|212.2–214.4|0|
| Only S3 fans out to all living targets |200.68|190–210|195.2–205.8|5–20|
| Only S3 delivered damage becomes zero |215.00|213–216|214.2–215.8|0|
| Only S3 job uses normal damage kind |213.20|211–215|212.0–214.2|0|

Each endpoint distribution uses2048 simulator runs. Five-battle means use16384 resamples of five independent draws from each simulated distribution; these are estimated predictive ranges, not guaranteed bounds or a fitted prior. The first256 seeds also record S2/S3 activations, S3 raw kills and target types. All defender Infantry survive these forecasts, with at least107 under any candidate. Current/fanout mean separation is about13 survivors on a250-troop defense, with a directly observable backline difference.

The paired290-vector report-precision screen changes a given seeded endpoint by at most one troop:256 mixed ±0.05 vectors,32 single-field corners and2 opposing corners across16 used fields. This is a sensitivity screen, not an exhaustive bound and not an allowance for the unknown Reina stat change. Simulator-only stress scenarios adding80 or160 unmeasured points to WIP Lancer Attack/Defense retain the Infantry screen and widen the current/fanout mean gap to about22 or37. Those values are hypothetical sensitivity inputs, not claimed Reina bonuses or bounds; other equipment fields may also change.

Paul's1–2-survivor guideline is an accuracy aim for the usual sub1000 armies. It is not a universal rejection band regardless of battle scale, stochastic variation or materiality. Here the scope contrast is much larger than report-precision sensitivity. The no-S3 and normal-kind alternatives are too close to support strong standalone coefficient or damage-kind claims, even if a sample mean favors one.

## Capture and interpretation

Capture uses only the authorized WIP and minxxx emulators. Collect **five independent repetitions with the same actual setup**, preserving each report's identity, full stats, total survivors, per-line survivors and Battle Details. A counterpart mail is the same battle, not an extra observation. Do not stop based on whether an endpoint happens to match a preferred candidate.

Use `spec.json` for the setup. After the first capture, replay the frozen models using its exact report stats. Continue the remaining repetitions only if the actual setup is correct and the fresh-stat forecast retains the front Infantry screen; otherwise preserve that capture as exploratory and redesign the remaining probe before observing more results. This is an input/topology validity condition, not outcome-based selection. If stats change between repetitions, retain and simulate each battle's actual input rather than pooling incompatible forecasts.

Positive S3 activation counts confirm exercise, but low-level S3 can display zero attributed kills: the provisional current model averages6.23 activations and only1.63 raw kills against the front Infantry. Displayed kill conversion and activation semantics remain uncertain. Record zero/dash exactly; do not require a nonzero displayed kill to retain an observation or use report counts to rescue an implausible endpoint.

A plausible full-kit distribution together with S3 activations and untouched backlines would support current-target delivery relative to the specified fanout alternative. It would not alone establish the exact25% chance,20% coefficient, normal-versus-skill damage classification, S1/S2 interaction, all-troop versus Lancer-only source ownership, or behavior after target exhaustion. The five endpoints are independent observations; the per-line breakdown and Battle Details diagnose those same battles.

The original three-line formation was selected from42 small formations. A further36 two-line Lancer/Marksman formations increased direct S3 damage but weakened the clean fanout contrast; those are documented in the scratch screen and were not captured. The chosen600 total troops keep commitment modest; this is not a claim of a globally minimal design.

## Frozen replay

The package archives all29 current runtime source files, with the outer army-term ceiling removed and both fractional stored troop state and the inner attack-count ceiling retained. `manifest.json` hashes the archive, each source file, original inputs, config, candidate patches and capture spec. Later production edits cannot silently change these forecasts.

Create a BattleInput JSON with the identical full kit/troop setup and exact fresh report stats, then run from repository root:

```sh
simulator/node_modules/.bin/tsx docs/mechanics-audit/probes/reina-shadowblade/predict.mts /absolute/captured-input.json /absolute/new-replay-output.json
```

The helper verifies the frozen files, extracts the archived engine into a temporary directory, preserves the four candidate rules, rejects changed heroes/troops or existing output paths, and labels fresh-stat output as a replay without claiming blindness. Original `prediction.json` and `estimated-input.json` remain unchanged.

Design inputs/results and the discarded two-line screen are under `tmp/mechanics-audit-2026-09-07/reina-shadowblade/`. No emulator interaction or production edits were made for this design.
