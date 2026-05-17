# v3 Subagent Delegation Playbook

Use this checklist when delegating v3 simulator work to subagents. The goal is
evidence-based implementation, not a runnable scaffold with missing acceptance
details.

## Source Boundaries

Default rule: v3 subagents should work from inside `v3/**`. Do not broaden the
context unless the task packet explicitly justifies it. The easiest way to avoid
importing v1 complexity is to keep agents from reading v1 or legacy code.

Allowed cold-start sources:

- `v3/battle-core-rewrite-spec.md`
- `v3/config/**`
- `v3/testcases/**` through the `v3/testcases` symlink
- `v3/testcase_results/*.json` as read-only calibration evidence for
  parity/comparison tasks
- `v3/package.json`
- current v3 source and tests for the assigned slice only

Forbidden unless the task packet explicitly allows them:

- `Base_classes/**`
- `v2/src/simulator/mechanics/**`
- non-v3 repository paths other than the `v3/testcases` symlink target
- legacy simulator implementation paths used as behavioral authority
- transcript history or previous agent conclusions not copied into the task
  packet

If a subagent thinks a forbidden path is needed, it must stop with
`NEEDS_CONTEXT` and explain the exact missing fact.

There is usually no reason for an implementation subagent to inspect outside
`v3`. The `v3/testcases` symlink is the preferred path for testcase data even
though it points at `../testcases`. Calibration files under
`v3/testcase_results` are evidence for comparison, not implementation
templates.

## Controller Workflow

1. Use `superpowers:writing-plans` for multi-step work.
2. Split broad goals into bounded slices with disjoint file ownership.
3. For implementation, use `superpowers:subagent-driven-development`: fresh
   subagent per slice, then spec-reviewer and code-quality-reviewer.
4. For every behavior change, require `superpowers:test-driven-development`.
   The implementer must show the failing test output before coding.
5. Before accepting any subagent result, use
   `superpowers:verification-before-completion`: inspect the diff and run fresh
   verification locally. Do not rely on the subagent's success statement.

Good slices are narrow enough to validate with focused probes:

- testcase discovery and calibration-result comparison
- v1/game calibration report comparison
- config loading and hero alias resolution
- active-effect lifetime and target locks
- pass-specific bucket classification
- extra skill attack job creation
- engagement/probability gating
- no-hero damage equation parity
- trace/report fields

Avoid assigning "implement v3 battle core" as a single task.

## Required Task Packet

Every subagent task must be cold-start and self-contained. Include this exact
structure and fill every section.

```markdown
# Task: <short title>

## Objective
<One sentence describing the behavior to add or fix.>

## Source Boundaries
Allowed:
- `v3/battle-core-rewrite-spec.md`
- `<specific v3 files/directories for this slice>`

Forbidden unless you return `NEEDS_CONTEXT`:
- `Base_classes/**`
- `v2/src/simulator/mechanics/**`
- legacy simulator implementation paths
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
- `npm --prefix v3 test`
- `npm --prefix v3 run typecheck`
- `<focused testcase or calibration comparison command for this slice>`

## Not Done If
- any forbidden source was used without explicit permission
- the test was not seen failing before production code
- calibration matching ignores testcase path variants, testcase id, or `idx`
- duplicate testcase ids can reuse the same calibration result
- `v3/testcases` symlink behavior is untested when testcase discovery changes
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

## Review Packet

Spec reviewers receive the same task packet plus the implementer's final
message and diff. They must check requirement coverage before code quality.

Spec reviewer prompts must ask:

- Did the implementation stay inside source boundaries?
- Is there failing-test evidence before production edits?
- Are all acceptance probes present and relevant?
- Does the diff address every `Not Done If` item that applies to the slice?
- Did the implementation add behavior outside the task packet?

Code-quality reviewers run after spec compliance. They should focus on local
maintainability, naming, type safety, deterministic behavior, and whether the
tests assert behavior instead of implementation accidents.

## v3 Acceptance Hotspots

Use these as explicit probes when the touched area is relevant:

- Calibration comparison matches by testcase path variant, testcase id, and
  testcase `idx`.
- `v3/testcases` follows the symlink to `../testcases`; disabled or stale files
  are excluded by default and included only when requested.
- Duplicate no-hero testcase ids align to distinct calibration results; the
  known duplicate cases have `mu_game` values `3752` and `3652`.
- Hero lookup supports display-name aliases and fails clearly on duplicate
  normalized aliases.
- Runtime effects are `ActiveEffect` or `EffectActivation` style mutable tokens
  with owner, side, scope, target lock, value, duration, and uses.
- Damage is centralized and bucketed; effects propose intents and do not choose
  final formula buckets.
- Product-over-product buckets keep up and down buckets separate. For example,
  `health_down: 100` doubles damage and must not make denominator health zero.
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
- Correct round flow remains:
  snapshot -> round-start effects -> pairings -> attack intents ->
  attack triggers -> active effects / extra skill proposals -> damage jobs ->
  calculate -> simultaneous commit.

## Calibration Artifacts and Accuracy Targets

Files under `v3/testcase_results/*.json` may contain run snapshots from the v1
Python simulator plus observed game-result distributions. Treat them as
read-only calibration evidence. They are useful for ranking divergence and
measuring progress, but they are not authority to copy v1 architecture,
terminology, or interdependent configuration knobs.

Prefer these JSON files for parity work. A calibration report is expected to
key cases by testcase file plus `idx` and include fields such as `testcase_id`,
`mu_sim`, `mu_game`, `sigma_game`, `bias_pct`, and `passes`. Match cases by
testcase path variant, testcase id, and `idx`; never collapse duplicate
testcase ids into one comparison row.

The project goal is a simulator that matches observed in-game results to a
useful degree of confidence across a representative testcase set. The initial
v3 goal is deliberately narrower:

- keep the battle engine simple, explicit, and diagnosable
- preserve visibility into testcase inputs, resolved heroes/skills, triggers,
  damage jobs, buckets, and final results
- match existing simulator/game confidence criteria for at least about 50% of
  cases before treating broader tuning work as meaningful
- avoid adding mechanics solely to chase one divergent testcase without first
  identifying whether the discrepancy is general

Parity-oriented subagents must classify divergences before proposing mechanics:

- config/adaptation issue
- missing diagnostic visibility
- intentional simplified-v3 gap
- likely missing mechanic with evidence across multiple cases
- unknown, needs more data

They must report:

- total cases considered and pass rate
- no-hero vs hero split when available
- worst divergences by `bias_pct` or equivalent metric
- whether divergence is against observed game data, v1 simulator output, or
  both
- why any proposed mechanic is distinct from existing v3 concepts

Not done if a parity task imports v1 complexity, copies legacy implementation
structure, or adds vague knobs that cannot be tied to clear battle mechanics.

## Baseline Verification

Run focused tests first, then broaden. Baseline commands:

```bash
npm --prefix v3 test
npm --prefix v3 run typecheck
npm --silent --prefix v3 run testcases -- --matching emulator_verified --repeat 1
```

Expected broad testcase evidence:

- selected files parse with zero parse errors
- selected cases adapt and execute
- zero unexpected simulator errors
- hero cases resolve hero names
- troop skills resolve where applicable
- skill/effect activation counts are nonzero for active skill cases
- calibration comparison can be made against `v3/testcase_results/*.json` when
  parity evidence is required

Do not claim a slice is complete until the final report includes fresh command
output or a concrete explanation for any command that could not be run.

## Minimal Controller Checklist

Before dispatch:

- [ ] Slice has one clear behavioral objective.
- [ ] File ownership is explicit and does not overlap other active workers.
- [ ] Task packet includes source boundaries and forbidden paths.
- [ ] Required first observations are specific.
- [ ] At least one focused red/green test is required.
- [ ] Acceptance probes include exact commands.
- [ ] `Not Done If` items include all applicable v3 hotspots.

Before accepting:

- [ ] Subagent reported `DONE` or `DONE_WITH_CONCERNS`.
- [ ] Diff is inside declared ownership.
- [ ] Red evidence exists before production edits.
- [ ] Green evidence and final verification are fresh.
- [ ] Spec reviewer approved requirement coverage.
- [ ] Code-quality reviewer approved maintainability.
- [ ] Controller ran independent verification or documented the blocker.
