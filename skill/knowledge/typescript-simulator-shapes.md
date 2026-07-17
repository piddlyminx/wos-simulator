# TypeScript Simulator Shapes

## Read This When

Read this before changing simulator inputs, config data, public exports, testcase adapters, dashboard simulator adapters, or skill schemas.

## Source Of Truth

Use these files before relying on older Python-era notes:

- `simulator/src/types.ts` - public data contracts and runtime trace/result shapes.
- `simulator/src/config.ts` - config loading, legacy-field rejection, effect-type validation, and hero aliases.
- `simulator/src/resolve.ts` - `FighterInput` to `ResolvedFighter` and `ResolvedSkill`.
- `simulator/src/damageBuckets.ts` - legal native bucket effect names and aggregation placement.
- `simulator/src/effects.ts` - trigger matching, chance, duration, delay, selectors, active-effect hydration.
- `simulator/src/effectIndex.ts` - indexed runtime effect lookup by damage-job shape.
- `simulator/src/damage.ts` - bucket aggregation and `DamageEquationTrace`.
- `simulator/src/simulator.ts` - battle loop, `prepareBattle`, `runPrepared`, trace modes.
- `simulator/src/tooling/testcases.ts` and `scripts/run_testcases.ts` - testcase parity execution and CLI output.

Ignore `archived/v1/**` for current simulator behavior. Those Python files are historical reference only.

## Public Inputs

`BattleInput`:

```ts
{
  attacker: FighterInput;
  defender: FighterInput;
  seed?: string | number;
  maxRounds?: number;
  engagement_type?: string;
}
```

`FighterInput`:

```ts
{
  name?: string;
  troops: Record<string, number>;        // troop ids from simulator/config/troop_stats.json
  stats?: Record<string, Partial<StatBlock>>; // unit keys: infantry, lancer, marksman
  passive?: PassiveEffects;
  heroes?: HeroInputCollection;          // main heroes
  joiner_heroes?: HeroInputCollection;
}
```

Use `BattleInputBuilder` when building inputs in app code that should bake main-hero generation stats into `stats`. The simulator core treats `FighterInput.stats` as authoritative player stat bonuses.

## Config Shapes

Config lives under `simulator/config/`:

- `troop_stats.json`: troop id to `{ type, tier, fc?, stats }`.
- `hero_generation_stats.json`: named stat blocks referenced by hero definitions.
- `troop_skills.json`: `SkillFile` for troop/class skills.
- `hero_definitions/*.json`: one `SkillFile` per hero.

`SkillFile.skills` entries have:

- `trigger`: `pre_battle`, `battle_start`, `turn`, or `attack`, with optional `probability`, `every`, `source`, and `target` (`pre_battle` forbids `probability`).
- `effects`: native effect intents keyed by id.
- optional `requirements`: level, tier, fire-crystal, or engagement gates.

Native effect `type` values must be legal bucket paths from `damageBuckets.ts` or one of `extra_skill_attack`, `dodge`, `no_attack`, `attack_order`. Legacy fields like `effect_op` and `effect_type` are rejected by `loadSimulatorConfig()`.

Important selector rules:

- `trigger.source` / `trigger.target` bind attack-triggered effects to the current attack intent.
- Relation-qualified selectors such as `self.any`, `enemy.lancer`, and `trigger.target` are preferred.
- `units.applies_vs: "all"` is invalid in native effects. Use `"any"` for an unrestricted gate or `trigger_damage_jobs` for multi-target skill damage.

## Runtime Shapes

Resolution produces:

- `ResolvedFighter`: unit aggregates, weighted troop details, stat bonuses, heroes, hero skills, troop skills, and diagnostics.
- `ResolvedSkill`: hydrated skill source, side, hero/troop owner, level, trigger, and effect intents.
- `ActiveEffect`: runtime effect with kind, source, unit scopes, duration, delay, stacking key, and optional `triggerDamageJobs`.
- `DamageJob`: one normal or skill-damage job with attacker/defender side, unit, round-start troops, and consumed effect metadata.

Damage jobs use `kind: "normal" | "skill"`. Extra skill damage is not a second formula path; it is one or more `DamageJob` objects generated from an `extra_skill_attack` effect's `trigger_damage_jobs`.

## Output Shapes

`BattleResult` contains:

- `winner`, `rounds`, `remaining`
- `attacks: AttackOutcome[]`
- `skillReport` by side
- `resolved` visibility data and diagnostics
- `effectActivationCounts`, `extraSkillAttackJobsByEffect`, `attackControlCounts`
- `randomness` with deterministic flag and chance skill ids
- optional `trace`

Trace mode stores expensive damage detail on `AttackOutcome.trace`:

- `roundStartTroops`
- `armyTerm`
- `atomicBuckets`
- `aggregationGroups`
- `appliedEffects`
- `rejectedEffects`
- `rawDamage`
- `finalKills`

## Testcase Runner

Run parity from the repo root:

```bash
npx tsx scripts/run_testcases.ts --matching <pattern>
npx tsx scripts/run_testcases.ts --matching <pattern> --repeat 100
npx tsx scripts/run_testcases.ts --matching <pattern> --workers 4 --human
```

The runner writes a run snapshot by default and emits a `simulator-parity-summary`. Use `--no-run-snapshot` for stdout-only checks.

Use `wosctl run-testcase` only to collect game reports into `game_report_result`; simulator comparison belongs to the TypeScript runner.
