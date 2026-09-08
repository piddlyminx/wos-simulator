# Prospective Gwen cadence and fanout follow-up

Full minxxx Gwen 3/1/1 with **800 T6 Marksmen** attacks WIP no heroes with **1,200 T6 Infantry, 100 T6 Lancers, 100 T6 Marksmen**. Total initial troops: 2,200. Capture once; hydrated mechanics are deterministic.

| Frozen interpretation | Defender survivors (I/L/M) | Rounds | ±0.05 sensitivity range |
| --- | --- | ---: | --- |
| Unchanged first 5, every 4, all living targets | 535 (445/53/37) | 48 | 534–536 |
| First 5, every 5, all living targets | 580 (467/63/50) | 46 | 579–581 |
| First 6, every 4, all living targets | 555 (460/55/40) | 47 | 554–556 |
| First 5, every 5, current target only | 723 (523/100/100) | 42 | 722–724 |

All defender lines remain alive under all candidates and all 290 stat probes. The cadence alternatives differ by 25 survivors before any new observation, and backline losses distinguish fanout. The primary comparison is the complete survivor endpoint; skill activation counts and attribution only diagnose it. Do not infer final-round suppression merely from one fewer reported skill activation.

The first report's result was already known while designing this follow-up. The new formation's outcome has not been opened. Inputs use the first report's exact displayed stats; candidate rules and config snapshot are frozen before this new capture. Substitute the new report's stats afterward without changing hypotheses. The snapshot remains the original `bcb0d3068845ca143802c6e59cd7a530a8440606133b770613c418bed425b17c`.

Capture from repository root:

```sh
./skill/scripts/wosctl --instance minxxx run-testcase docs/mechanics-audit/probes/gwen-blastmaster/followup/spec.json
```

Preserve all per-line troop outcomes and full Battle Details. Replay from `simulator/` with fresh input/output paths:

```sh
npx tsx ../docs/mechanics-audit/probes/gwen-blastmaster/followup/predict.mts /absolute/fresh-input.json /absolute/captured-prediction.json
```

The original `prediction.json`, input, and full-kit spec are retained; alternative target/cadence settings are simulator counterfactuals, not disabled live skills.

## Capture execution

Two automated attempts stopped before attacking because the hero picker did not locate Gwen. Their logs are retained under `tmp/mechanics-audit-2026-09-07/gwen/followup-capture.log` and `followup-retry-capture.log`; neither produced a new observation. The second attempt had already deployed the specified WIP camp.

The attacker setup was completed through `wosctl shell` using visible controls. A shorter picker scroll exposed Gwen, whose existing template matched the saved viewport at 0.873 (threshold 0.75). Only Gwen was assigned; Withdraw All cleared troop selections, then exactly 800 Heroic Marksmen were entered. [Deployment screenshot](attacker-deployment.png) preserves this setup. Attack dispatched at 2026-09-07 04:33:00 UTC to the same X791/Y577 camp. The new report is captured with `create-testcase` rather than rerunning the battle. Predictions remain unchanged.

## Observed result

The report dated **2026-09-07 05:33:16** records **563 defender survivors**. Every troop tier/count and displayed stat was visually checked; stats are identical to the first probe. [Frozen-candidate replay](captured-prediction.json) therefore retains predictions 535, 580, 555 and 723. Their residuals are respectively 28, 17, 8 and 160 survivors: **none agrees within two**. The phase-six candidate's exact match to the first battle is insufficient to justify that change.

Battle Details records S1 activated once (kills dash), S2 seven times (7 displayed kills), and S3 nine times (39 displayed kills). Those counts challenge the first-sixth/every-fourth candidate, but do not establish a replacement schedule. Keep displayed kills distinct from raw simulated casualties. Explicit game rounds are unavailable. [Observation](observation.json), [overview](report_top.png), [stats](report_stats.png) and [Battle Details](bd_top.png) preserve the evidence.

The [defender troop breakdown](defender-troops.png) gives **461 Infantry, 58 Lancers and 44 Marksmen**. All target types survive and both backlines take losses. The phase-six candidate gives460/55/40; the every-fifth candidate467/63/50. The WIP counterpart report (mail ID2734692464122044) is the same battle and adds no independent outcome.
