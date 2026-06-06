# Simulator Subagent Delegation Playbook

Use this checklist when delegating TypeScript simulator work to subagents. The
goal is evidence-based implementation inside the simulator package, not a
runnable scaffold with missing acceptance details.

## Source Boundaries

Default rule: simulator subagents should work from inside `simulator/**`. Do not
broaden the context unless the task packet explicitly justifies it.

Allowed cold-start sources:

- `simulator/battle-core-rewrite-spec.md`
- `simulator/config/**`
- `simulator/testcases/**` through the `simulator/testcases` symlink
- `simulator/testcase_results/*.json` as read-only calibration evidence
- `simulator/package.json`
- current simulator source and tests for the assigned slice only

Forbidden unless the task packet explicitly allows them:

- archived or retired simulator implementation paths
- non-simulator repository paths other than the `simulator/testcases` symlink
  target and documented `shared/**` inputs
- transcript history or previous agent conclusions not copied into the task
  packet

If a subagent thinks a forbidden path is needed, it must stop with
`NEEDS_CONTEXT` and explain the exact missing fact.

## Controller Workflow

1. Split broad goals into bounded slices with disjoint file ownership.
2. For every behavior change, require a focused failing test before coding.
3. Before accepting any subagent result, inspect the diff and run fresh
   verification locally. Do not rely on the subagent's success statement.

Good slices are narrow enough to validate with focused probes:

- testcase discovery and calibration-result comparison
- config loading and hero alias resolution
- active-effect lifetime and target locks
- pass-specific bucket classification
- extra skill attack job creation
- engagement/probability gating
- no-hero damage equation parity against observed game data
- trace/report fields

Avoid assigning "implement the battle core" as a single task.

## Required Task Packet

Every subagent task must be cold-start and self-contained. Include this exact
structure and fill every section.

```markdown
# Task: <short title>

## Objective
<One sentence describing the behavior to add or fix.>

## Source Boundaries
Allowed:
- `simulator/battle-core-rewrite-spec.md`
- `<specific simulator files/directories for this slice>`

Forbidden unless you return `NEEDS_CONTEXT`:
- archived or retired simulator implementation paths
- unstated transcript history

## Ownership
You may modify:
- `<exact file or module ownership>`

Do not modify:
- `<neighboring files owned by other work>`

## Required First Observations
Before coding, report:
- the relevant spec sections or line ranges you read
- the current tests covering this behavior, if any
- the current implementation entry points for this slice
- the exact gap between current behavior and acceptance

## TDD Evidence Required
Before production edits:
- add or adjust a focused failing test
- run the narrow test command
- paste the failing output summary and explain why it is the expected failure

## Acceptance Probes
Run these exact commands and report the meaningful output:
- `npm --prefix simulator test`
- `npm --prefix simulator run typecheck`
- `<focused testcase or calibration comparison command for this slice>`

## Not Done If
- any forbidden source was used without explicit permission
- the test was not seen failing before production code
- calibration matching ignores testcase path variants, testcase id, or `idx`
- duplicate testcase ids can reuse the same calibration result
- `simulator/testcases` symlink behavior is untested when testcase discovery changes
- hero display-name aliases are not covered when config loading changes
- pass-specific buckets leak between normal and skill jobs
- attack-duration effects are not consumed for applicable cancelled attacks
- `applies_vs: "target"` loses target-lock semantics
- array-valued `applies_vs` collapses to the normal attack target
- `engagement_type` triggers activate without explicit matching mechanics
- probability values treat `1` as 100% instead of 1%
- final report lacks fresh verification evidence

## Final Response Required
Return one of: `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, `BLOCKED`.

Include:
- files changed
- tests added or changed
- red/green evidence
- final verification commands and results
- unresolved risks or assumptions
```

## Acceptance Hotspots

Use these as explicit probes when the touched area is relevant:

- Calibration comparison matches by testcase path variant, testcase id, and
  testcase `idx`.
- `simulator/testcases` follows the symlink to `../testcases`; disabled or stale
  files are excluded by default and included only when requested.
- Duplicate no-hero testcase ids align to distinct calibration results.
- Hero lookup supports display-name aliases and fails clearly on duplicate
  normalized aliases.
- Runtime effects are explicit mutable tokens with owner, side, scope, target
  lock, value, duration, and uses.
- Damage is centralized and bucketed; effects propose intents and do not choose
  final formula buckets.
- Product-over-product buckets keep up and down buckets separate.
- Pass-specific bucket gating prevents normal-only, skill-only, and all-pass
  modifiers from leaking into the wrong damage job.
- Attack-duration effects consume by active-effect id after applicable uses,
  including when a normal attack is cancelled.
- Extra skill attacks create explicit skill jobs for exact target units, do not
  recursively fire attack triggers, and may increment attack counters.
- Array-valued `applies_vs` targets those defender unit types; it must not be
  collapsed to the source normal attack target.
- `applies_vs: "target"` preserves a target lock captured at activation time.
- Defender-side target matching checks the defender unit being damaged.
- `engagement_type` gated triggers are inactive unless
  `BattleInput.mechanics.engagement_type` or `engagementType` explicitly
  matches.
- Probability values are percentages: `1` is 1%, `0.5` is 0.5%, and `100` is
  always.
- Frequency triggers detect threshold crossings, not exact modulo equality.

## Calibration Artifacts and Accuracy Targets

Files under `simulator/testcase_results/*.json` are read-only calibration
evidence. They are useful for ranking divergence and measuring progress, but
they are not authority to add architecture, terminology, or configuration knobs
that are not explained by current battle mechanics.

Prefer observed game-result distributions for accuracy work. A calibration
report is expected to key cases by testcase file plus `idx` and include fields
such as `testcase_id`, observed means, simulator means, spread, bias percentage,
and pass/fail status. Match cases by testcase path variant, testcase id, and
`idx`; never collapse duplicate testcase ids into one comparison row.

The project goal is a simulator that matches observed in-game results to a
useful degree of confidence across a representative testcase set.

Parity-oriented subagents must classify divergences before proposing mechanics:

- config/adaptation issue
- missing diagnostic visibility
- likely missing mechanic with evidence across multiple cases
- report parsing or testcase-data issue
- unknown, needs more data

Not done if a parity task imports retired simulator complexity, copies obsolete
implementation structure, or adds vague knobs that cannot be tied to clear
battle mechanics.

## Baseline Verification

Run focused tests first, then broaden. Baseline commands:

```bash
npm --prefix simulator test
npm --prefix simulator run typecheck
npx tsx scripts/run_testcases.ts --matching emulator_verified --repeat 1
```
