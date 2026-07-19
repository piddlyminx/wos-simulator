# Skill Isolation With Fixed Hero Kits

## Read This When

Read this before designing in-game fixtures for hero mechanics or adding testcase specs that claim to isolate a skill.

## Constraint

The game usually does not allow individual Expedition skills to be disabled or set to arbitrary levels:

```text
hero fixture = all currently unlocked and leveled Expedition skills on that account
```

The simulator can ablate individual `ResolvedSkill` or `ActiveEffect` entries, but that is a counterfactual diagnostic, not a direct game fixture.

Army deployment also allows at most one main hero per troop class on a side. A testcase spec that requests two same-class main heroes on one side is an invalid game lineup, not a picker failure.

## Testcase Shape

Use current simulator shapes:

- `FighterInput.troops`: troop ids from `simulator/config/troop_stats.json`.
- `FighterInput.stats`: unit keys (`infantry`, `lancer`, `marksman`) with player stat bonuses.
- `FighterInput.heroes`: main heroes with captured skill levels.
- `FighterInput.joiner_heroes`: joiner heroes, if the fixture uses them.
- `BattleInput.engagement_type`: required when testing rally/garrison-gated skills.

Do not write or expect `sim_result` in captured fixture JSON. Game observations belong under `game_report_result`; simulator output comes from the TypeScript testcase runner.

## Practical Isolation Methods

### 1. Paired No-Hero Controls

Every hero fixture should have a same-session no-hero control with the same:

- accounts
- attacker/defender roles
- troop ids and counts
- troop tiers and fire-crystal levels
- buffs and stat snapshot
- report-capture path

Use the control to separate skill mismatch from stale stats, troop data, or parser issues.

### 2. Full-Kit Single-Hero Fixtures

When possible, test one hero as a full kit against no heroes. Label it accurately:

```json
{
  "fixture_type": "single_hero_full_kit",
  "skill_isolation": false
}
```

Do not describe it as an isolated skill test.

### 3. Attacker Composition Gating

Some effects only trigger for or apply to a source unit. Change the attacking army to make effects eligible or ineligible.

| Goal | Fixture shape |
|---|---|
| Gate marksman effects | marksmen present vs no marksmen |
| Gate lancer effects | lancers present vs no lancers |
| Test mixed-body interactions | single-type, two-type, and three-type armies |

### 4. Defender Target Gating

Some effects depend on target type or generated skill-damage jobs. Change the defender composition.

| Goal | Fixture shape |
|---|---|
| Test `trigger.target` / `units.applies_vs` | defender type present vs absent |
| Test skill-damage fanout | defender one type vs all three types |
| Test primary-target inclusion | tiny frontline plus larger backline |
| Test current-target behavior | setup where frontline changes during the fight |

### 5. Battle-Length Gating

Frequency, delay, and duration bugs often need boundary fights.

Compare candidate semantics:

```text
fires on Nth attack
fires after N completed attacks
fires at round start
fires after delay
expires after N rounds
expires after N uses
```

### 6. Repeated Stochastic Observations

A testcase is stochastic if hydrated skills have `trigger.probability`, regardless of filename.

Store individual game observations, not just the mean. Use enough repeats to estimate mean, variance, min/max, and distribution shape.

### 7. Simulator-Side Ablation

Use ablation only to rank likely causes:

- disable each hydrated skill/effect one at a time
- switch one effect bucket
- switch trigger/source/target selectors
- alter `trigger_damage_jobs`
- force chance pass/fail for one trigger
- shift duration/delay/frequency

Then design a better in-game fixture.

## Required Fixture Metadata

Use explicit metadata so future agents do not overinterpret the testcase:

```json
{
  "fixture_type": "single_hero_full_kit",
  "skill_isolation": false,
  "expected_stochastic": true,
  "stochastic_reason": ["hydrated trigger.probability"],
  "stats_snapshot": "fresh for this capture batch",
  "control_fixture": "matching_nohero_case_id"
}
```

Do not add `_nc` to testcase filenames. The test runner determines whether a case is stochastic from the hydrated skills; the filename does not.
