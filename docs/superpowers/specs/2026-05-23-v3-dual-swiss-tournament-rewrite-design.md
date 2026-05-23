# V3 Dual Swiss Tournament Rewrite Design

## Purpose

Rewrite `scripts/tournament_dual_swiss.py` as TypeScript tooling that uses the
v3 simulator in `lib/v3/v3` instead of the Python `lib/wos-simulator`
classes.

The rewrite must preserve the current tournament behavior closely enough that
existing CSV workflows still work:

- generate main plus joiner lineups
- run asymmetric dual-ranking Swiss rounds
- progressively freeze low-ranked active teams
- optionally run finals round-robin from Swiss qualifiers
- optionally replay finals from an existing results directory
- write `swiss_off.csv`, `swiss_def.csv`, `finals_off.csv`, and
  `finals_def.csv` with the current schema

## Current Python Behavior

`scripts/tournament_dual_swiss.py` is a standalone CLI. It imports the vendored
Python simulator, constructs lightweight `Team` records, and builds Python
`Fighter("max")` objects only inside worker jobs to avoid multiprocessing
pickle overhead.

The current active main pool is:

```ts
const MAIN_POOL = {
  Jeronimo: "inf",
  "Wu Ming": "inf",
  Hector: "inf",
  Edith: "inf",
  Mia: "lanc",
  Philly: "lanc",
  Gwen: "mark",
  Wayne: "mark",
  Bradley: "mark"
};
```

The current joiner pool is order-sensitive and intentionally includes a
duplicate `Norah` entry:

```ts
const JOINER_POOL = [
  "Jessie",
  "Seo-yoon",
  "Lumak",
  "Logan",
  "Patrick",
  "Mia",
  "Reina",
  "Norah",
  "Norah",
  "Philly",
  "Wu Ming"
];
```

By default, joiner lineups use combinations over the list indices. Because the
list contains `Norah` twice, default generation can produce duplicate-valued
lineups and can select `Norah, Norah` without `--repeat-joiners`. With
`--repeat-joiners`, generation uses combinations with replacement over that
same list, preserving the duplicate-entry semantics. The TypeScript rewrite
must preserve this behavior unless a later product decision explicitly changes
deduplication rules.

Each generated team has:

- `mains`: one infantry main, one lancer main, one marksman main, in that order
- `joiners`: four joiners, in generated combination order
- `id`: monotonically assigned integer
- `ratioLabel`: ratio string with commas replaced by hyphens, such as
  `50-20-30`
- `troops`: v3-compatible troop counts keyed by `infantry_t10`,
  `lancer_t10`, and `marksman_t10`

Ratio parsing normalizes percentages to `--total`, rounds infantry and lancer
counts independently, and assigns the remaining count to marksman:

```ts
infantry = Math.round(total * infPct / sum);
lancer = Math.round(total * lancerPct / sum);
marksman = total - infantry - lancer;
```

## V3 Simulator Integration

The rewrite must call `simulateBattle(input, config)` from
`lib/v3/v3/src/simulator.ts`, with config loaded once through
`loadSimulatorConfig()` from `lib/v3/v3/src/config.ts`.

The tournament should not import or execute any Python simulator modules.

### Fighter Input Mapping

For each tournament battle, convert a `Team` into v3 `FighterInput`:

```ts
{
  name: "max",
  troops: {
    infantry_t10: team.troops.infantry_t10,
    lancer_t10: team.troops.lancer_t10,
    marksman_t10: team.troops.marksman_t10
  },
  heroes: {
    [team.mains[0]]: allCombatSkillsAtLevelFive(team.mains[0]),
    [team.mains[1]]: allCombatSkillsAtLevelFive(team.mains[1]),
    [team.mains[2]]: allCombatSkillsAtLevelFive(team.mains[2])
  },
  joiner_heroes: {
    [joinerHeroName]: { skill_1: 5 }
  }
}
```

Important compatibility details:

- Python regular heroes default to level 5 for all valid combat skills when
  provided as a list.
- Python joiners default to only `skill_1: 5`.
- v3 merges `heroes` and `joiner_heroes` by object spread in `resolve.ts`.
  Duplicate joiner names cannot be represented in the current v3
  `joiner_heroes: Record<string, Record<string, number>>` shape.
- A hero can also appear as both a main and a joiner in the current pools, for
  example `Mia`, `Philly`, or `Wu Ming`. The current v3 object shape cannot
  represent independent main and joiner instances of the same hero without one
  overwriting the other during merge.
- The rewrite must address repeated hero instances before claiming full parity.
  Preferred approach: add a v3-compatible array input shape for hero instances,
  with an explicit role such as `main` or `joiner`, and update `resolve.ts` so
  each instance resolves independently. Fallback approach: reject generated
  teams with duplicate joiners or main-plus-joiner duplicates and clearly
  document that the TypeScript tournament is not parity-equivalent to the
  Python script.
- `allCombatSkillsAtLevelFive(heroName)` should inspect the resolved v3 hero
  definition and return every configured combat skill key at level 5, using
  `skill_1`, `skill_2`, etc. in definition order.
- Hero name aliases must work for display names used by the Python script,
  including `Wu Ming` and `Seo-yoon`.
- Use `mechanics: { hero_generation_stats: true }` if the tournament rewrite
  needs Python `Fighter("max").add_heroes_stats()` parity. v3 currently keeps
  hero generation stats opt-in.
- Use `maxRounds: 600`, matching the Python `Fight(..., max_round=600)`.

### Battle Result Mapping

`runSingleBattle(attTeam, defTeam, seed, reps)` must run `reps` replicate
battles and return:

```ts
{
  attackerId: number;
  defenderId: number;
  avgAttackerLeft: number;
  avgDefenderLeft: number;
}
```

For each replicate:

- use seed `seed + rep`
- pass that seed to `simulateBattle`
- compute attacker remaining as the total of
  `result.remaining.attacker.infantry + lancer + marksman`
- compute defender remaining the same way

Average remaining troops must use integer floor division to match Python:

```ts
Math.floor(totalAttackerLeft / reps)
Math.floor(totalDefenderLeft / reps)
```

## Tournament Algorithm

Keep separate offense and defense `Pool` instances over the same generated team
set. A `Score` contains:

- `team`
- `wins`
- `matches`
- `margin`
- computed `winRate = wins / matches || 0`
- computed `avgMargin = margin / matches || 0`

Active scores sort by:

```ts
winRate desc, avgMargin desc, team.id desc
```

This matches the Python key `(win_rate, avg_margin, team.id)` with
`reverse=True`.

### Random Seed Rounds

For rounds `1..seedRounds`:

- get active offense teams in current sorted order
- shuffle attackers with RNG seed `seed + roundNum`
- get active defense teams in current sorted order
- shuffle defenders with RNG seed `seed + roundNum + 100000`
- zip attackers and defenders by index
- allow self-matches, because the Python implementation allows them despite
  the top-level docstring saying otherwise
- create battle job seed `seed + roundNum + i * 1000`

### Dual-Ranking Swiss Rounds

For rounds after `seedRounds`:

- rank active offense teams by offense score
- rank active defense teams by defense score
- zip by rank
- allow self-matches
- create battle job seed `seed + roundNum * 10000 + i * 1000`

### Score Aggregation

For each battle result:

```ts
margin = avgAttackerLeft - avgDefenderLeft;
```

Update offense score:

- `matches += 1`
- `score.margin += margin`
- `wins += 1` only when `avgAttackerLeft > 0 && avgDefenderLeft === 0`

Update defense score:

- `matches += 1`
- `score.margin += -margin`
- `wins += 1` only when `avgDefenderLeft > 0 && avgAttackerLeft === 0`

Draws and mutual-zero outcomes are non-wins for both sides.

### Progressive Freeze

If `freezeRate > 0`, after every completed round at or after
`startFreezeRound`:

- sort each active pool
- freeze `max(1, floor(activeCount * freezeRate))` teams per pool
- cap the freeze count at active count
- pop the current bottom team and insert it at the front of `scoresFinal`
  repeatedly

This ordering detail matters: later frozen teams are better than earlier frozen
teams, and insertion at the front preserves that ranking.

At tournament end, call `finalizeRemaining()`:

- sort active scores
- set `scoresFinal = sortedActive + scoresFinal`
- empty active scores

### Stop Conditions

The Swiss loop stops when any condition is true:

- `timeLimitMins` is set and elapsed minutes is greater than the limit
- current round exceeds `totalRounds`
- freeze is enabled and both active pools are below `minPoolSize`
- one or both active pools are empty

When `--time-limit` is set, `--rounds` remains a hard safety cap in the current
Python code. Preserve that behavior even though the CLI help says time limit
overrides rounds.

## Finals Behavior

The finals round-robin scores from scratch. Swiss results only choose
qualifiers.

Generate every pair:

```ts
for (const attacker of attackerTeams) {
  for (const defender of defenderTeams) {
    pairs.push([attacker, defender]);
  }
}
```

Use battle seed:

```ts
seed + 999000 + i * 1000
```

Aggregate scores with the same win and margin rules as Swiss. Finalize both
pools after all finals battles.

### Finals From Swiss Results

`--finals-only <dir>` skips Swiss and loads candidates from:

- `<dir>/swiss_off.csv`
- `<dir>/swiss_def.csv`

It requires `--finals-top-m > 0`.

When loading CSV teams:

- read `formation`, `hero_1..hero_3`, and `joiner_1..joiner_4`
- assign new IDs from row index, separately for offense and defense lists
- rebuild troop counts from `formation` and current `--total`
- require enough rows for the requested top M after loading candidates

Copy the source `swiss_off.csv` and `swiss_def.csv` into the new output
directory before writing finals outputs.

### Main-Lineup Cap

`--finals-max-same-heroes N` limits selected finals teams to at most `N` teams
with the same three main heroes. `0` disables the cap.

Selection scans ranked candidates in order and keeps the first teams that do
not exceed the cap until `topM` is reached or the candidate list ends.

## CLI Contract

Create the TypeScript CLI under the v3 package, preferably:

```text
lib/v3/v3/src/tournament/dualSwissCli.ts
```

Add a package script:

```json
"tournament:dual-swiss": "tsx src/tournament/dualSwissCli.ts"
```

The CLI must support the Python script's options:

- `--ratios`, one or more `inf,lanc,mark` strings, default `50,20,30`
- `--total`, number, default `100000`
- `--rounds`, number, default `10`
- `--time-limit`, number of minutes, default unset
- `--seed-rounds`, number, default `2`
- `--reps`, number, default `1`
- `--top-n`, number, default `200`
- `--jobs`, number, default CPU count
- `--seed`, number, default `1234`
- `--freeze-rate`, number, default `0.2`
- `--start-freeze-round`, number, default `8`
- `--min-pool-size`, number, default `200`
- `--finals-top-m`, number, default `0`
- `--finals-reps`, number, default to `--reps`
- `--finals-only`, path, default unset
- `--finals-max-same-heroes`, number, default `0`
- `--repeat-joiners`, boolean flag, default false

Argument validation:

- ratio must have exactly three comma-separated numeric components
- ratio sum must be greater than zero
- `--finals-max-same-heroes` must be `>= 0`
- `--finals-only` requires `--finals-top-m > 0`
- finals CSV inputs must exist and contain enough candidates
- worker count must be at least one
- `--freeze-rate` must be between `0` and `1`
- `--seed-rounds` must be `>= 0`
- `--rounds` must be `>= 0`
- `--reps` and `--finals-reps` must be `>= 1`

## Output Contract

Output directories must keep the Python naming convention:

```text
tournament_results/ds_<label>_<YYYYMMDD-HHMMSS>
```

Labels:

- one input ratio: that ratio with hyphens, such as `50-20-30`
- multiple ratios: `mixed`
- finals-only source directory: use the source directory basename, stripping a
  leading `ds_` and stripping a trailing timestamp segment if present

CSV schema must remain:

```csv
rank,win_rate,avg_margin,matches,formation,hero_1,hero_2,hero_3,joiner_1,joiner_2,joiner_3,joiner_4
```

Formatting:

- `rank`: one-based integer
- `win_rate`: four decimal places
- `avg_margin`: two decimal places
- `matches`: integer
- `formation`: team `ratioLabel`
- hero and joiner columns: display names from the `Team`

When CSV rows are empty, preserve Python behavior and create the file without a
header.

## Proposed TypeScript File Structure

Keep tournament-specific code isolated from the simulator core:

- `src/tournament/types.ts`
  - `Team`, `Score`, `BattleSummary`, CLI option types
- `src/tournament/pools.ts`
  - `Pool`, score sorting, freezing, finalization
- `src/tournament/teamGeneration.ts`
  - main pool, joiner pool, ratio parsing, team generation, CSV team loading,
    finals selection
- `src/tournament/teamInput.ts`
  - `Team` to v3 `FighterInput`, max hero skill maps, duplicate joiner handling
- `src/tournament/battleRunner.ts`
  - single battle, reps, worker job shape, result aggregation
- `src/tournament/worker.ts`
  - Node worker-thread entrypoint that loads config once per worker
- `src/tournament/workerPool.ts`
  - bounded worker pool with progress callbacks
- `src/tournament/dualSwiss.ts`
  - random round, Swiss round, tournament loop, finals round-robin
- `src/tournament/results.ts`
  - result directory labels, CSV read/write, qualifier CSV copying
- `src/tournament/dualSwissCli.ts`
  - argument parsing, user-facing logging, orchestration
- `src/tournament/*.test.ts`
  - focused Node test runner coverage

Do not put tournament code into `src/simulator.ts`; the simulator should remain
the battle engine.

## Worker Model

Use Node `worker_threads`, not child processes shelling through `npx`, for
tournament battle jobs.

Each worker should:

- import `loadSimulatorConfig` and `simulateBattle`
- load config once at startup
- accept JSON-serializable battle jobs
- rebuild v3 `BattleInput` inside the worker
- return battle summaries or structured errors

The parent pool should:

- keep at most `--jobs` active workers
- dispatch battle jobs FIFO
- update progress after each completed job
- reject all queued work if a worker exits unexpectedly
- close workers at the end of the run

This keeps the Python script's "build large simulator objects inside workers"
principle while avoiding Python pickle concerns.

## Determinism

Python uses `random.seed(seed + rep)` globally before each replicate. v3 accepts
the seed on each `BattleInput`. The rewrite should pass the same numeric seed
formula into v3.

Round pairing also needs a seeded shuffle. To preserve Python pairings for the
same tournament seed, implement a local Python-compatible `random.Random`
shuffle, including MT19937 generation and Python's list shuffle algorithm. If
that is intentionally deferred, document that TypeScript pairings are stable
but not Python-seed compatible.

Do not require byte-for-byte equality with Python results, because v3 and the
Python simulator are separate implementations and v3 may already differ by
known parity status. The required determinism target is:

- same TypeScript CLI arguments
- same checked-in v3 config
- same Node version family
- same output rankings and metrics across repeated TypeScript runs

## Tests

Use the v3 package test style:

```bash
cd lib/v3/v3
npm test
npm run typecheck
```

Add focused tests for:

- ratio parsing and rounding, including marksman remainder
- invalid ratio rejection
- team generation counts for default and `--repeat-joiners`
- preservation of duplicate `Norah` semantics
- score sorting tie breakers by `team.id` descending
- freeze ordering
- random pairing determinism for a fixed seed
- Swiss pairing by rank
- score aggregation win and margin rules
- finals main-lineup cap
- CSV write schema and numeric formatting
- finals-only CSV loading and ratio reconstruction
- output label derivation from plain names and `ds_*_<timestamp>` directories
- `Team` to `BattleInput` conversion, including max main skills and joiner
  `skill_1`
- duplicate joiner and main-plus-joiner duplicate handling once the v3 input
  shape supports it

Add one integration test that stubs the battle runner with deterministic
remaining-troop results and verifies that a small tournament produces stable
offense and defense CSV rankings. This should not call the full simulator.

Add one smoke test that calls the real v3 `simulateBattle` with two generated
teams and confirms a finite battle summary. Keep it small enough for normal
`npm test`.

## Acceptance Criteria

- The new TypeScript CLI runs from `lib/v3/v3` with `npm run
  tournament:dual-swiss -- ...`.
- The CLI never imports Python code and does not require the Python virtual
  environment.
- The CLI can run a small Swiss tournament and write `swiss_off.csv` and
  `swiss_def.csv`.
- The CLI can run Swiss plus finals and write all four CSVs.
- The CLI can run `--finals-only` from an existing Swiss results directory.
- CSV columns and formatting match the Python script.
- Repeated runs with the same arguments and seed produce identical TypeScript
  outputs apart from timestamped output directory names.
- `npm test` and `npm run typecheck` pass in `lib/v3/v3`.
- Repeated hero instance semantics are either fully supported in v3 or
  explicitly rejected with a clear error before team generation creates
  unsupported lineups.

## Open Decisions

1. Repeated hero instances: full Python parity requires v3 to support repeated
   joiner heroes and same hero as main plus joiner. The current v3 `Record`
   input shape cannot represent this. The recommended decision is to add an
   array-compatible hero-instance input shape.
2. Hero stat parity: Python applies `max` hero base stats through
   `add_heroes_stats()`. The v3 rewrite should use
   `mechanics.hero_generation_stats: true` unless current v3 config parity work
   proves that those stats are already included elsewhere.
3. Exact Python ranking parity: the rewrite should prioritize deterministic v3
   results and CSV workflow compatibility over matching old Python tournament
   rankings exactly.
