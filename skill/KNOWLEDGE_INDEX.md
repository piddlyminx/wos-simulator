# WOS Knowledge Index

This index routes agents to the knowledge files they should read before changing the simulator, testcase suite, report-capture tooling, or dashboard. It is not an issue tracker. Current defects, active work, and resolved incidents belong in the project board or task system, not in this file.

## Operating rules

- Do not change the global damage formula because one testcase diverges. Start with controls and traces.
- If no-hero controls pass, treat the mismatch as skill semantics, target selection, timing, chance, stale stats, or report parsing until evidence proves otherwise.
- Do not restore the old SOS/Ryo/Rapi fatigue factor as a default mechanic. It was removed because deterministic WOS fixtures improved.
- Do not add a special class-advantage coefficient. Class advantage is represented as ordinary troop skills flowing through the shared skill framework.
- Do not assume individual hero skills can be isolated in game. Heroes are tested as full current account kits.
- Do not parse captured reports unless the report bottom was reached. Capture/parsing failures must be visible and diagnosable.

## Which files to read by task

| Task or symptom | Read first | Also read | Stop condition |
|---|---|---|---|
| A testcase diverges and a formula or skill change is tempting | [Skill Divergence Debugging](knowledge/skill-divergence-debugging.md) | [Battle Mechanics](knowledge/battle-mechanics.md), [Effect Sensitivity and Tracing](knowledge/effect-sensitivity-tracing.md), [Testcase Dashboard Calibration](knowledge/testcase-dashboard-calibration.md) | You have a narrow hypothesis supported by controls, traces, or sensitivity runs. |
| No-hero controls fail | [Battle Mechanics](knowledge/battle-mechanics.md) | [Reports Reference](references/reports.md), [Report Capture and Parsing](knowledge/report-capture-and-parsing.md), [Testcase Dashboard Calibration](knowledge/testcase-dashboard-calibration.md) | You know whether the failure is stats/report parsing, troop data, target order, rounding, or the core formula. |
| No-hero controls pass but a hero or combo testcase fails | [Skill Divergence Debugging](knowledge/skill-divergence-debugging.md) | [Skill Isolation With Fixed Hero Kits](knowledge/skill-isolation-with-fixed-hero-kits.md), [Effect Sensitivity and Tracing](knowledge/effect-sensitivity-tracing.md) | You have identified the likely skill schema dimension: chance, duration, lag, extra damage, target gating, or stacking. |
| Designing new in-game fixtures for hero mechanics | [Skill Isolation With Fixed Hero Kits](knowledge/skill-isolation-with-fixed-hero-kits.md) | [WIP vs minxxx Fixture Plan](knowledge/wip-minxxx-fixture-plan.md), [Reports Reference](references/reports.md), [Testcase Dashboard Calibration](knowledge/testcase-dashboard-calibration.md) | Each fixture has a paired control, current stats, current hero levels, and repeat count appropriate to stochastic risk. |
| Collecting testcase observations with `run-testcase` | [Testcase Dashboard Calibration](knowledge/testcase-dashboard-calibration.md) | [Commands Reference](references/commands.md), [Reports Reference](references/reports.md) | `run-testcase --repeat N` has only captured game observations; simulator comparison is deferred to the TypeScript simulator testcase runner, and testcase JSON has no `sim_result`. |
| Collecting WIP vs minxxx emulator reports | [WIP vs minxxx Fixture Plan](knowledge/wip-minxxx-fixture-plan.md) | [Skill Isolation With Fixed Hero Kits](knowledge/skill-isolation-with-fixed-hero-kits.md), [Reports Reference](references/reports.md) | The batch includes fresh controls and does not rely on stale account stats or hero levels. |
| Adding per-round traces, applied-benefit logs, or ablation reports | [Effect Sensitivity and Tracing](knowledge/effect-sensitivity-tracing.md) | [Battle Mechanics](knowledge/battle-mechanics.md), [Testcase Dashboard Calibration](knowledge/testcase-dashboard-calibration.md) | Default simulation outputs are unchanged when tracing is disabled. |
| Changing hero or troop skill data/schema | [Battle Mechanics](knowledge/battle-mechanics.md) | [Skill Divergence Debugging](knowledge/skill-divergence-debugging.md), [Effect Sensitivity and Tracing](knowledge/effect-sensitivity-tracing.md) | The change is supported by fixtures or sensitivity results and does not regress controls. |
| Changing dashboard metrics, history, grouping, or quality gates | [Testcase Dashboard Calibration](knowledge/testcase-dashboard-calibration.md) | [Effect Sensitivity and Tracing](knowledge/effect-sensitivity-tracing.md), [Skill Divergence Debugging](knowledge/skill-divergence-debugging.md) | Existing history remains interpretable and new metrics are named by what they normalize against. |
| Capturing, scrolling, OCRing, or parsing battle reports | [Report Capture and Parsing](knowledge/report-capture-and-parsing.md) | [Reports Reference](references/reports.md), [Commands Reference](references/commands.md) | Non-battle reports fail/skip correctly; incomplete bottom captures fail hard with diagnostics. |
| Modifying `wosctl` or command examples | [Commands Reference](references/commands.md) | [Report Capture and Parsing](knowledge/report-capture-and-parsing.md), [Reports Reference](references/reports.md) | The examples match argparse and do not advertise removed flags or commands. |
| Writing specs for agents or Codex | [Spec Design](knowledge/spec-design.md) | This index plus every domain file touched by the task | The spec says which docs to read and avoids hardcoded account/instance names unless the task is explicitly account-specific. |

## Document catalog

- [Battle Mechanics](knowledge/battle-mechanics.md) — actual two-pass damage model, skill coefficient layers, class advantage as ordinary troop skills, and rules for safe formula changes.
- [Skill Divergence Debugging](knowledge/skill-divergence-debugging.md) — triage workflow for simulator-vs-game mismatches.
- [Skill Isolation With Fixed Hero Kits](knowledge/skill-isolation-with-fixed-hero-kits.md) — practical fixture design when game heroes cannot be reduced to individual skills.
- [Effect Sensitivity and Tracing](knowledge/effect-sensitivity-tracing.md) — applied-benefit trace schema, effect rejection reasons, ablation reports, semantic perturbation reports, and grouped residual dimensions.
- [Testcase Dashboard Calibration](knowledge/testcase-dashboard-calibration.md) — how to interpret testcase runs, repeats, stochastic cases, dashboard metrics, and grouped residuals.
- [Report Capture and Parsing](knowledge/report-capture-and-parsing.md) — required behavior for battle-report capture, bottom detection, OCR/template parsing, diagnostics, and parser unification.
- [WIP vs minxxx Fixture Plan](knowledge/wip-minxxx-fixture-plan.md) — specific current fixture batches for WIP/minxxx-style account testing.
- [Spec Design](knowledge/spec-design.md) — how to write bounded implementation specs for agents.
- [Commands Reference](references/commands.md) — stable command documentation rules and examples; intentionally excludes removed/broken commands.
- [Reports Reference](references/reports.md) — report data contract, battle vs non-battle behavior, and capture artifact expectations.

## What does not belong here

- Active bugs, current regressions, and resolved incidents.
- One-off tactical instructions for a single branch.
- Account-specific state unless the document is explicitly an account-specific fixture plan.
- Command examples copied from memory without checking argparse.
