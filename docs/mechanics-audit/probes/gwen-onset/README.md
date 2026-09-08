# Withdrawn Gwen onset design

**Withdrawn before deployment on September 7.** Paul judged the five-survivor separation on a30k scale effectively equal. The original ±2 acceptance bands below are preserved as design history and must not be used to decide the mechanic. The attempted run was interrupted during alliance checks; no new battle occurred. See `withdrawal.json`. A stronger discriminator is needed.

Original prospective design:

Use minxxx's full Gwen3/1/1 kit with500 T6 Marksmen against nohero WIP11100 T6 Infantry +8300 T6 Lancers +11100 T6 Marksmen. This fits the parent-supplied approximate stocks and commits30500 defenders. No short battle result has been seen. Both earlier long Gwen outcomes were known during design.

| Frozen model | Defender survivors | Infantry / Lancers / Marksmen | S3 delivery |
|---|---:|---|---|
| first4/every5 |30449|11053 /8298 /11098|Round4|
| first5/every5 |30454|11054 /8300 /11100|Round5|
| Unchanged first5/every4 |30454|11054 /8300 /11100|Round5|
| first6/every4 |30454|11054 /8300 /11100|None|

All forecasts finish in five rounds, leaving about5.2 attackers at the start of round5. Fourth-attack delivery is therefore before the terminal round. S2 acts at round5 but contributes only0.333 raw kills, identical across variants. The chosen formation uses1100 fewer defenders than the qualifying four-round500-Marksman example. No qualifying six-round example was found in the bounded grid.

The five-survivor separation remains exact across both the current runtime and the isolated removal of the outer army-term ceiling, and across547 shared stat vectors per model/engine (4376 simulations). These include both all-stat favorable/opposite ±0.05 corners,512 mixed random vectors and32 single-field corners. Every total, per-line survivor count and five-round duration stayed unchanged. With fixed targets, positive modifiers and unchanged schedules, the opposing corners bracket the stat box through the monotone damage/count recurrence. The original stat values still require verification in the new report.

Use the total and all three line counts as primary evidence. Allowing two troops around each endpoint gives disjoint bands30447–30451 versus30452–30456. Reported activation counts and kills remain secondary: first5's terminal S3 produces1.23 raw kills but no separately visible backline survivor loss, and report rounding/terminal counting is unresolved. Preserve the exact displayed numbers or dashes and images.

An early-model match would support fourth-attack delivery relative to these later-onset models, conditional on the remaining full-kit behavior. It cannot establish recurrence, distinguish trigger phase from equivalent delivery delay, independently prove S1/S2 semantics, or resolve the two long-battle residuals. A result outside both bands is further disagreement to investigate; it is not permission to fit a new magnitude.

`input.json`, `config-snapshot.json` and `prediction.json` are immutable original forecasts. `spec.json` records their hashes, acceptance ranges and observation requirements. If captured stats differ, write a separately labelled replay and retain the originals.

Design scripts and full search/validation outputs are under `tmp/mechanics-audit-2026-09-07/gwen-causal-review/`: `design-short-onset.mts`, `short-onset-design.json`, `validate-short-onset.mts` and `short-onset-validation-summary.json`. Their completed outputs are preserved; the durable replay below is independent of production source changes.

`original-runtime.tar.gz` preserves all29 original runtime source files. `runtime-manifest.json` verifies the archive and every file, and records the one-line removal needed to derive the independent no-outer-ceiling runtime. `replay.mts` extracts both engines into a temporary directory, checks the hashes, and reads only the frozen config. It requires a new output outside this package and never overwrites original artifacts. An optional stats input must provide `attacker.stats` and `defender.stats`; only those fields replace the frozen input. Replays make no claim of blindness to game outcomes.

From repository root:

```sh
simulator/node_modules/.bin/tsx docs/mechanics-audit/probes/gwen-onset/replay.mts tmp/gwen-onset-replay.json
```

Append a captured stats input path to replay with new report stats. Both engines retain their original semantics even after the production rounding correction.
