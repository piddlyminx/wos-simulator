# Spec Design

## Read This When

Read this before writing an implementation prompt, Codex task, agent handoff, or design note for this repo.

A useful spec tells the agent which knowledge files and TypeScript entry points to read, what behavior must not change, how success is measured, and which code paths are in scope.

## Required Spec Structure

Use this shape:

```text
Context
Relevant files
Knowledge files to read
Task
Non-goals
Acceptance criteria
Validation commands
Risk notes
Output expectations
```

## Knowledge Routing

Every spec should include relevant docs from `skill/KNOWLEDGE_INDEX.md`. Do not rely on an agent discovering them.

Example:

```text
Before editing, read:
- skill/KNOWLEDGE_INDEX.md
- skill/knowledge/typescript-simulator-shapes.md
- skill/knowledge/battle-mechanics.md
- skill/knowledge/skill-divergence-debugging.md
```

## Include Current Code Anchors

For simulator work, name the current TypeScript files rather than old Python classes:

```text
simulator/src/types.ts
simulator/src/config.ts
simulator/src/resolve.ts
simulator/src/damageBuckets.ts
simulator/src/effects.ts
simulator/src/effectIndex.ts
simulator/src/damage.ts
simulator/src/simulator.ts
simulator/src/tooling/testcases.ts
scripts/run_testcases.ts
```

Include only the files relevant to the task.

## Avoid Hardcoded Account And Instance Names

Generic knowledge docs and specs should not hardcode local instance names, emulator IDs, or account nicknames.

Use config-derived roles:

```text
default_current_attacker
default_current_defender
calibration_attacker
calibration_defender
```

Only account-specific fixture plans should name accounts directly, and they should say how to map the roles when different accounts are used.

## Formula Or Bucket Specs

Any spec that changes battle mechanics must say:

- which no-hero controls are expected to improve
- which controls must not regress
- whether default simulation outputs are expected to change
- whether the change affects `DamageJob.kind`, bucket aggregation, selectors, or extra skill jobs
- how testcase evidence will be evaluated under [Testcase Evidence Policy](testcase-evidence-policy.md)
- whether the change is behind an experimental path

Do not ask for broad formula rewrites unless controls support it.

## Skill Config Specs

Any spec that changes hero or troop skill data must say:

- which `SkillFile` entries are in scope
- which trigger/effect fields are changing
- which testcase or trace supports the change
- how `loadSimulatorConfig()` validation will be checked
- which controls and grouped residuals must not regress

## Parser/Capture Specs

Any spec that changes report capture or parsing must say:

- how incomplete bottom capture is detected
- where diagnostics are saved
- how non-battle reports fail or skip
- which parser owns OCR and template matching
- how troop type, tier, and fire-crystal level are captured

Do not allow parser failure to produce zero/default battle stats.

## Dashboard Specs

Any dashboard spec must say:

- which `TestcaseRunReport` or run-snapshot fields are consumed
- which metric denominator/reference is used
- whether historical run data remains compatible
- how stochastic observation and simulator sample counts are displayed
- how grouped residuals are computed
- whether current issue tracking is intentionally excluded

The dashboard may show regressions and histories, but current work items belong in the board.
