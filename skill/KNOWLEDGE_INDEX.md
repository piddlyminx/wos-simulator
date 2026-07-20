# WOS Knowledge Index

Use this index to choose the smallest useful reading set before changing the TypeScript simulator, testcase suite, report-capture tooling, or dashboard. It is not an issue tracker.

## Operating Rules

- Treat `simulator/src/types.ts` and `simulator/src/damageBuckets.ts` as the source of truth for simulator shapes and effect buckets.
- Start simulator investigations from controls and traces. Do not change global damage math because one hero testcase diverges.
- Keep captured game observations separate from simulator analysis: `wosctl run-testcase` appends `game_report_result`; TypeScript testcase runs produce parity reports and run snapshots.
- Do not add `_nc` to testcase filenames. The test runner determines whether a case is stochastic from the hydrated skills; the filename does not.
- Class advantage is troop-skill data in `simulator/config/troop_skills.json`, not a hardcoded formula coefficient.
- Hero fixtures are full current account kits unless the change is an explicit simulator-only ablation.
- Do not parse incomplete battle-report captures. Capture/parsing failures must be visible and diagnosable.

## Current Simulator Map

- Public API: `simulator/src/index.ts` exports `loadSimulatorConfig`, `BattleInputBuilder`, `prepareBattle`, `runPrepared`, and bear helpers. Prepare once and reuse the compiled battle across seeded runs.
- Inputs: `BattleInput` contains `attacker`, `defender`, optional `seed`, `maxRounds`, and `engagement_type`; each `FighterInput` contains troop-id counts, unit-keyed stat bonuses, optional `passive`, `heroes`, and `joiner_heroes`.
- Resolution: `resolveFighter` converts troop ids and hero levels into `ResolvedFighter`, `ResolvedSkill`, troop skills, diagnostics, and unit aggregates.
- Effects: skill files define `trigger` plus native bucket effects, `extra_skill_attack`, `dodge`, `no_attack`, or `attack_order`; runtime effects become `ActiveEffect`.
- Damage: `DamageJob` uses `kind: "normal" | "skill"`; `calculateDamageJob` combines static profile buckets, dynamic indexed effects, and `source.extraSkill`.
- Tracing: trace mode records `AttackOutcome.trace` with `atomicBuckets`, `aggregationGroups`, `appliedEffects`, `rejectedEffects`, `rawDamage`, and `finalKills`.
- Testcases: `scripts/run_testcases.ts` drives `simulator/src/tooling/testcases.ts`, supports `--matching`, `--repeat`, `--workers`, `--calibration-report`, and writes run snapshots only when `--save-snapshot` is set.

## Task Routing

| Task or symptom | Read first | Also read | Stop condition |
|---|---|---|---|
| Understanding simulator data shapes, public APIs, or config format | [TypeScript Simulator Shapes](knowledge/typescript-simulator-shapes.md) | [Battle Mechanics](knowledge/battle-mechanics.md) | You know which TypeScript type/file owns the shape you are about to edit. |
| A testcase diverges and a formula or skill change is tempting | [Skill Divergence Debugging](knowledge/skill-divergence-debugging.md) | [TypeScript Simulator Shapes](knowledge/typescript-simulator-shapes.md), [Battle Mechanics](knowledge/battle-mechanics.md), [Effect Sensitivity and Tracing](knowledge/effect-sensitivity-tracing.md), [Testcase Dashboard Calibration](knowledge/testcase-dashboard-calibration.md) | You have a narrow hypothesis supported by controls, traces, or sensitivity runs. |
| No-hero controls fail | [Battle Mechanics](knowledge/battle-mechanics.md) | [Reports Reference](references/reports.md), [Report Capture and Parsing](knowledge/report-capture-and-parsing.md), [Testcase Dashboard Calibration](knowledge/testcase-dashboard-calibration.md) | You know whether the failure is stats/report parsing, troop data, target order, rounding, or bucket aggregation. |
| No-hero controls pass but a hero or combo testcase fails | [Skill Divergence Debugging](knowledge/skill-divergence-debugging.md) | [Skill Isolation With Fixed Hero Kits](knowledge/skill-isolation-with-fixed-hero-kits.md), [Effect Sensitivity and Tracing](knowledge/effect-sensitivity-tracing.md) | You have identified the likely dimension: trigger, chance, duration, delay, extra attack jobs, target selectors, or stacking. |
| Designing new in-game fixtures for hero mechanics | [Skill Isolation With Fixed Hero Kits](knowledge/skill-isolation-with-fixed-hero-kits.md) | [Two-Account Calibration Fixture Plan](knowledge/two-account-calibration-fixture-plan.md), [Reports Reference](references/reports.md), [Testcase Dashboard Calibration](knowledge/testcase-dashboard-calibration.md) | Each fixture has paired controls, current stats, current hero levels, and enough repeats for stochastic risk. |
| Collecting testcase observations with `wosctl run-testcase` | [Testcase Dashboard Calibration](knowledge/testcase-dashboard-calibration.md) | [Commands Reference](references/commands.md), [Reports Reference](references/reports.md) | Testcase JSON contains captured observations only, with no `sim_result`. |
| Adding trace fields, effect indexing, ablation, or residual reports | [Effect Sensitivity and Tracing](knowledge/effect-sensitivity-tracing.md) | [TypeScript Simulator Shapes](knowledge/typescript-simulator-shapes.md), [Battle Mechanics](knowledge/battle-mechanics.md) | Default simulation outputs are unchanged unless the task explicitly changes simulator behavior. |
| Changing hero or troop skill data/schema | [TypeScript Simulator Shapes](knowledge/typescript-simulator-shapes.md) | [Battle Mechanics](knowledge/battle-mechanics.md), [Skill Divergence Debugging](knowledge/skill-divergence-debugging.md), [Effect Sensitivity and Tracing](knowledge/effect-sensitivity-tracing.md) | `loadSimulatorConfig()` accepts the config, diagnostics are understood, and controls do not regress. |
| Changing dashboard metrics, history, grouping, or quality gates | [Testcase Dashboard Calibration](knowledge/testcase-dashboard-calibration.md) | [Effect Sensitivity and Tracing](knowledge/effect-sensitivity-tracing.md), [Skill Divergence Debugging](knowledge/skill-divergence-debugging.md) | Existing history remains interpretable and new metrics name their denominator/reference set. |
| Capturing, scrolling, OCRing, or parsing battle reports | [Report Capture and Parsing](knowledge/report-capture-and-parsing.md) | [Reports Reference](references/reports.md), [Commands Reference](references/commands.md) | Non-battle reports fail/skip correctly; incomplete bottom captures fail hard with diagnostics. |
| Modifying `wosctl` or command examples | [Commands Reference](references/commands.md) | [Report Capture and Parsing](knowledge/report-capture-and-parsing.md), [Reports Reference](references/reports.md) | Examples match argparse and do not advertise removed flags or commands. |
| Writing specs for agents or Codex | [Spec Design](knowledge/spec-design.md) | This index plus every domain file touched by the task | The spec names docs, scoped code paths, non-goals, and validation commands. |

## Document Catalog

- [TypeScript Simulator Shapes](knowledge/typescript-simulator-shapes.md) - current simulator inputs, config files, runtime shapes, outputs, and command entry points.
- [Battle Mechanics](knowledge/battle-mechanics.md) - current bucket-based damage model, active effects, extra skill attacks, and safe formula-change rules.
- [Skill Divergence Debugging](knowledge/skill-divergence-debugging.md) - triage workflow for simulator-vs-game mismatches.
- [Skill Isolation With Fixed Hero Kits](knowledge/skill-isolation-with-fixed-hero-kits.md) - practical fixture design when game heroes cannot be reduced to individual skills.
- [Effect Sensitivity and Tracing](knowledge/effect-sensitivity-tracing.md) - trace fields, effect rejection reasons, ablation reports, and grouped residual dimensions.
- [Testcase Dashboard Calibration](knowledge/testcase-dashboard-calibration.md) - testcase runner outputs, repeats, stochastic cases, dashboard metrics, and grouped residuals.
- [Report Capture and Parsing](knowledge/report-capture-and-parsing.md) - battle-report capture, bottom detection, OCR/template parsing, diagnostics, and parser contracts.
- [Two-Account Calibration Fixture Plan](knowledge/two-account-calibration-fixture-plan.md) - generic calibration batch pattern for paired account testing.
- [Spec Design](knowledge/spec-design.md) - bounded implementation specs for agents.
- [Commands Reference](references/commands.md) - stable command documentation rules and examples.
- [Reports Reference](references/reports.md) - report data contract and capture artifact expectations.

## What Does Not Belong Here

- Active bugs, current regressions, and resolved incidents.
- One-off tactical instructions for a single branch.
- Account-specific state outside an explicitly account-specific fixture plan.
- Command examples copied from memory without checking argparse.
