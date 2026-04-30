# Spec Design

## Read this when

Read this before writing an implementation prompt, Codex task, agent handoff, or design note.

A good spec tells the agent which knowledge files to read, what behavior must not change, how success will be measured, and which code paths are in scope.

## Required spec structure

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

## Knowledge routing

Every spec should include the relevant docs from `KNOWLEDGE_INDEX.md`. Do not rely on an agent discovering them.

Example:

```text
Before editing, read:
- knowledge/battle-mechanics.md
- knowledge/skill-divergence-debugging.md
- knowledge/effect-sensitivity-tracing.md
```

## Avoid hardcoded account and instance names

Generic knowledge docs and generic specs should not hardcode local instance names, emulator IDs, or account nicknames.

Use config-derived roles:

```text
default_current_attacker
default_current_defender
calibration_attacker
calibration_defender
```

Only account-specific fixture plans should name accounts directly, and they should say how to map the roles when different accounts are used.

## Formula-change specs

Any spec that changes battle mechanics must say:

- which controls are expected to improve
- which controls must not regress
- whether default simulation outputs are expected to change
- how stochastic cases will be evaluated
- whether the change is behind an experimental flag

Do not ask for broad formula rewrites unless no-hero controls support it.

## Parser/capture specs

Any spec that changes report capture or parsing must say:

- how incomplete bottom capture is detected
- where diagnostics are saved
- how non-battle reports fail or skip
- which parser owns OCR and template matching
- how troop type, tier, and fire-crystal level are captured

Do not allow parser failure to produce zero/default battle stats.

## Dashboard specs

Any dashboard spec must say:

- which metric denominator is used
- whether historical run data remains compatible
- how stochastic observation counts are displayed
- how grouped residuals are computed
- whether current issue tracking is intentionally excluded

The dashboard may show regressions and histories, but current work items belong in the board.
