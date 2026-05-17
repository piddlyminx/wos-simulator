# v3 Subagent Delegation Playbook

Use this checklist when delegating v3 simulator work to subagents. The goal is
evidence-based implementation, not a runnable scaffold with missing acceptance
details.

## Source Boundaries

Allowed cold-start sources:

- `v3/battle-core-rewrite-spec.md`
- `v3/config/**`
- `v3/testcases/**` through the `v3/testcases` symlink
- `v3/package.json`
- current v3 source and tests for the assigned slice only
- `test_results/dashboard.sqlite` only for read-only dashboard comparison tasks

Forbidden unless the task packet explicitly allows them:

- `Base_classes/**`
- `v2/src/simulator/mechanics/**`
- legacy simulator implementation paths used as behavioral authority
- transcript history or previous agent conclusions not copied into the task
  packet

If a subagent thinks a forbidden path is needed, it must stop with
`NEEDS_CONTEXT` and explain the exact missing fact.

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

- dashboard comparison and testcase discovery
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
- `<focused testcase or dashboard command for this slice>`

## Not Done If
- any forbidden source was used without explicit permission
- the test was not seen failing before production code
- dashboard matching ignores latest `run_id`, testcase path variants, testcase
  id, or `idx`
- duplicate testcase ids can reuse the same dashboard row
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

- Dashboard comparison matches by latest `run_id`, testcase path variant,
  testcase id, and testcase `idx`.
- `v3/testcases` follows the symlink to `../testcases`; disabled or stale files
  are excluded by default and included only when requested.
- Duplicate no-hero testcase ids align to distinct dashboard rows; the known
  duplicate rows have `mu_game` values `3752` and `3652`.
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
- dashboard rows are available when `test_results/dashboard.sqlite` exists

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
