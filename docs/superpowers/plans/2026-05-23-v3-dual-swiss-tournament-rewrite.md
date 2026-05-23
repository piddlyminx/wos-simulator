# V3 Dual Swiss Tournament Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript replacement for `scripts/tournament_dual_swiss.py` that runs in `lib/v3/v3`, uses the v3 simulator, and preserves the current CSV tournament workflows.

**Architecture:** Add tournament-specific modules under `lib/v3/v3/src/tournament` and keep battle mechanics in the existing simulator core. Extend v3 fighter hero input to support repeated hero instances, then layer team generation, score pools, deterministic pairings, CSV IO, worker-thread battle execution, Swiss/finals orchestration, and a CLI over `simulateBattle`.

**Tech Stack:** TypeScript, Node 22-style ESM, `tsx`, Node test runner, v3 simulator APIs, Node `worker_threads`, Node `fs/path/os`.

---

## Source Context

Read this spec first:

- `lib/v3/docs/superpowers/specs/2026-05-23-v3-dual-swiss-tournament-rewrite-design.md`

Reference behavior:

- `scripts/tournament_dual_swiss.py`

Run commands from the v3 package:

```bash
cd lib/v3/v3
npm test
npm run typecheck
```

Important implementation decision for this plan:

- Implement repeated hero instances in v3 through an array-compatible input shape.
- Do not use the fallback that rejects duplicate joiners or main-plus-joiner duplicates.
- Use a deterministic local TypeScript shuffle for pairings. It must be stable for repeated TypeScript runs. It does not need to reproduce CPython `random.Random` pairings byte-for-byte in this first rewrite.

## File Structure

- Modify `lib/v3/v3/src/types.ts`: allow hero and joiner inputs to be either object maps or arrays; add optional hero instance metadata to resolved types.
- Modify `lib/v3/v3/src/resolve.ts`: resolve hero arrays without deduping, apply hero generation stats to main heroes only, and create unique instance IDs.
- Modify `lib/v3/v3/src/effects.ts`: include hero instance IDs in active effect IDs and stacking keys.
- Modify `lib/v3/v3/src/simulator.ts`: include hero instance IDs in skill report keys.
- Create `lib/v3/v3/src/tournament/types.ts`: tournament domain types.
- Create `lib/v3/v3/src/tournament/rng.ts`: deterministic seeded shuffle.
- Create `lib/v3/v3/src/tournament/pools.ts`: score pools, sorting, freezing, finalization.
- Create `lib/v3/v3/src/tournament/teamGeneration.ts`: pools, ratio parsing, combinations, team generation, finals candidate selection.
- Create `lib/v3/v3/src/tournament/results.ts`: CSV parsing/writing and output-directory labels.
- Create `lib/v3/v3/src/tournament/teamInput.ts`: `Team` to v3 `BattleInput` conversion.
- Create `lib/v3/v3/src/tournament/battleRunner.ts`: direct single-battle and batch battle runner.
- Create `lib/v3/v3/src/tournament/worker.ts`: worker-thread entrypoint.
- Create `lib/v3/v3/src/tournament/workerPool.ts`: bounded worker pool.
- Create `lib/v3/v3/src/tournament/dualSwiss.ts`: random rounds, Swiss rounds, tournament loop, finals round-robin.
- Create `lib/v3/v3/src/tournament/dualSwissCli.ts`: argument parsing, orchestration, logging.
- Modify `lib/v3/v3/package.json`: add `tournament:dual-swiss` script.
- Add tests under `lib/v3/v3/src/tournament/*.test.ts` and update existing simulator tests where needed.

## Task 1: Support Repeated Hero Instances In V3

**Files:**
- Modify: `lib/v3/v3/src/types.ts`
- Modify: `lib/v3/v3/src/resolve.ts`
- Modify: `lib/v3/v3/src/effects.ts`
- Modify: `lib/v3/v3/src/simulator.ts`
- Test: `lib/v3/v3/src/simulator.test.ts`

- [ ] **Step 1: Add failing tests for repeated joiners and main-only hero generation stats**

Append these tests to `lib/v3/v3/src/simulator.test.ts`:

```ts
test("array joiner heroes preserve duplicate skill instances", () => {
  const result = simulateBattle(
    {
      maxRounds: 1,
      attacker: {
        troops: { infantry_t1: 100 },
        heroes: [],
        joiner_heroes: [
          { name: "Repeat", levels: { skill_1: 1 } },
          { name: "Repeat", levels: { skill_1: 1 } }
        ]
      },
      defender: {
        troops: { infantry_t1: 100 },
        heroes: {}
      }
    },
    minimalConfig({
      Repeat: {
        name: "Repeat",
        skills: {
          Buff: {
            trigger: { type: "battle_start" },
            effects: {
              boost: {
                type: "active.hero.damage.up",
                value: 10,
                units: { applies_to: "self.infantry", applies_vs: "enemy.infantry" },
                duration: { type: "battle", value: 1 },
                same_effect_stacking: "add"
              }
            }
          }
        }
      }
    })
  );

  const reports = result.skillReport.attacker.filter((entry) => entry.heroName === "Repeat" && entry.skillId === "Buff");
  assert.equal(reports.length, 2);
  assert.deepEqual(
    reports.map((entry) => entry.effectActivations),
    [1, 1]
  );
});

test("joiner hero generation stats are not applied when main hero stats are enabled", () => {
  const config = minimalConfig({
    Main: {
      name: "Main",
      hero_generation: "S1",
      skills: {}
    },
    Joiner: {
      name: "Joiner",
      hero_generation: "S2",
      skills: {
        JoinerBuff: {
          trigger: { type: "battle_start" },
          effects: {}
        }
      }
    }
  });
  config.heroGenerationStats.S1 = { attack: 10, defense: 20, lethality: 30, health: 40 };
  config.heroGenerationStats.S2 = { attack: 100, defense: 200, lethality: 300, health: 400 };

  const fighter = resolveFighter(
    {
      troops: { infantry_t1: 10 },
      stats: { inf: { attack: 1, defense: 2, lethality: 3, health: 4 } },
      heroes: [{ name: "Main", levels: {} }],
      joiner_heroes: [{ name: "Joiner", levels: { skill_1: 1 } }]
    },
    "attacker",
    config,
    { hero_generation_stats: true }
  );

  assert.deepEqual(fighter.statBonuses.infantry, { attack: 11, defense: 22, lethality: 33, health: 44 });
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
cd lib/v3/v3
npx --yes tsx --test src/simulator.test.ts
```

Expected: FAIL with TypeScript/runtime errors because `heroes` and `joiner_heroes` do not yet accept arrays and duplicate reports are collapsed.

- [ ] **Step 3: Extend v3 public types**

In `lib/v3/v3/src/types.ts`, replace the current `FighterInput` hero fields with these type definitions:

```ts
export type HeroSkillLevels = Record<string, number>;

export interface HeroInputEntry {
  name: string;
  levels?: HeroSkillLevels;
}

export type HeroInputCollection = Record<string, HeroSkillLevels> | HeroInputEntry[];

export interface FighterInput {
  name?: string;
  troops: Record<string, number>;
  stats?: Record<string, Partial<StatBlock>>;
  heroes?: HeroInputCollection;
  joiner_heroes?: HeroInputCollection;
}
```

Add these optional fields to `ResolvedSkill`:

```ts
  heroInstanceId?: string;
  heroRole?: "main" | "joiner";
```

Add these optional fields to `ResolvedHero`:

```ts
  instanceId?: string;
  role?: "main" | "joiner";
```

- [ ] **Step 4: Replace merged hero logic with instance-aware helpers**

In `lib/v3/v3/src/resolve.ts`, replace `mergedHeroes()` and update callers to use these helpers:

```ts
interface HeroInputInstance {
  name: string;
  levels: Record<string, number>;
  role: "main" | "joiner";
  instanceId: string;
}

function heroInputInstances(input: FighterInput): HeroInputInstance[] {
  return [
    ...heroCollectionInstances(input.heroes, "main"),
    ...heroCollectionInstances(input.joiner_heroes, "joiner")
  ];
}

function heroCollectionInstances(collection: FighterInput["heroes"], role: "main" | "joiner"): HeroInputInstance[] {
  if (!collection) return [];
  const entries = Array.isArray(collection)
    ? collection.map((entry) => ({ name: entry.name, levels: entry.levels ?? {} }))
    : Object.entries(collection).map(([name, levels]) => ({ name, levels }));
  const counts = new Map<string, number>();
  return entries.map((entry) => {
    const key = `${role}:${normalizeHeroName(entry.name)}`;
    const index = counts.get(key) ?? 0;
    counts.set(key, index + 1);
    return {
      name: entry.name,
      levels: entry.levels,
      role,
      instanceId: `${role}:${normalizeHeroName(entry.name)}:${index}`
    };
  });
}
```

Update `resolveHeroes()` to iterate `heroInputInstances(input)`. Apply generation stats only when `instance.role === "main"`:

```ts
if (instance.role === "main" && shouldApplyHeroGenerationStats(mechanics)) {
  for (const unit of UNIT_TYPES) {
    statBonuses[unit] = addStats(statBonuses[unit], generationStats);
  }
}
heroes.push({
  name: definition.name ?? instance.name,
  heroGeneration: definition.hero_generation,
  generationStats,
  skillIds: resolveHeroSkillIds(definition, instance.levels, mechanics),
  instanceId: instance.instanceId,
  role: instance.role
});
```

Update `resolveHeroSkills()` to iterate the same instances and pass `instanceId` and `role` into `hydrateSkill()`.

Update `hydrateSkill()` signature:

```ts
function hydrateSkill(
  skillId: string,
  rawSkill: Omit<SkillDefinition, "id" | "name">,
  side: SideId,
  level: number,
  sourceKind: "hero_skill" | "troop_skill",
  heroName?: string,
  troopType?: UnitType,
  heroInstanceId?: string,
  heroRole?: "main" | "joiner"
): ResolvedSkill
```

Set `heroInstanceId` and `heroRole` in the returned `ResolvedSkill`.

- [ ] **Step 5: Make duplicate effects and reports instance-aware**

In `lib/v3/v3/src/effects.ts`, add a helper near `activateEffect()`:

```ts
function skillSourceKey(skill: ResolvedSkill): string {
  return skill.heroInstanceId ?? skill.heroName ?? skill.troopType ?? "global";
}
```

Use it in `id` and `stackingKey`:

```ts
id: `${skill.side}:${skill.sourceKind}:${skillSourceKey(skill)}:${skill.id}:${intent.id}:r${round}:${attackIntent?.id ?? "global"}`,
stackingKey: `${skill.side}:${skill.sourceKind}:${skillSourceKey(skill)}:${skill.id}:${intent.id}`,
```

In `lib/v3/v3/src/simulator.ts`, change `reportKey()` to:

```ts
function reportKey(skill: ResolvedSkill): string {
  return `${skill.sourceKind}:${skill.heroInstanceId ?? skill.heroName ?? skill.troopType ?? ""}:${skill.id}`;
}
```

- [ ] **Step 6: Run tests and typecheck**

Run:

```bash
cd lib/v3/v3
npm test
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git -C /home/paul/projects_wsl/wos/battle_sim/lib/v3 add v3/src/types.ts v3/src/resolve.ts v3/src/effects.ts v3/src/simulator.ts v3/src/simulator.test.ts
git -C /home/paul/projects_wsl/wos/battle_sim/lib/v3 commit -m "feat(v3): support repeated hero input instances"
```

## Task 2: Add Tournament Core Types, Pools, And Deterministic RNG

**Files:**
- Create: `lib/v3/v3/src/tournament/types.ts`
- Create: `lib/v3/v3/src/tournament/rng.ts`
- Create: `lib/v3/v3/src/tournament/pools.ts`
- Test: `lib/v3/v3/src/tournament/pools.test.ts`
- Test: `lib/v3/v3/src/tournament/rng.test.ts`

- [ ] **Step 1: Write failing pool and RNG tests**

Create `lib/v3/v3/src/tournament/pools.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { Pool } from "./pools.js";
import type { Team } from "./types.js";

function team(id: number): Team {
  return {
    id,
    mains: ["Jeronimo", "Mia", "Gwen"],
    joiners: ["Jessie", "Seo-yoon", "Lumak", "Logan"],
    ratioLabel: "50-20-30",
    troops: { infantry_t10: 50, lancer_t10: 20, marksman_t10: 30 }
  };
}

test("active scores sort by win rate, average margin, then team id descending", () => {
  const pool = new Pool([team(1), team(2), team(3)]);
  pool.getScore(1).matches = 2;
  pool.getScore(1).wins = 1;
  pool.getScore(1).margin = 20;
  pool.getScore(2).matches = 2;
  pool.getScore(2).wins = 1;
  pool.getScore(2).margin = 20;
  pool.getScore(3).matches = 2;
  pool.getScore(3).wins = 2;
  pool.getScore(3).margin = 1;

  assert.deepEqual(pool.teamsActiveOrdered.map((item) => item.id), [3, 2, 1]);
});

test("freezeBottomTeams inserts later better freezes before earlier worse freezes", () => {
  const pool = new Pool([team(1), team(2), team(3), team(4)]);
  pool.getScore(1).matches = 1;
  pool.getScore(1).margin = 40;
  pool.getScore(2).matches = 1;
  pool.getScore(2).margin = 30;
  pool.getScore(3).matches = 1;
  pool.getScore(3).margin = 20;
  pool.getScore(4).matches = 1;
  pool.getScore(4).margin = 10;

  pool.freezeBottomTeams(0.25);
  pool.getScore(3).margin = -100;
  pool.freezeBottomTeams(0.25);

  assert.deepEqual(pool.teamsFinalOrdered.map((item) => item.id), [3, 4]);
});

test("finalizeRemaining preserves active teams above frozen teams", () => {
  const pool = new Pool([team(1), team(2), team(3)]);
  pool.getScore(1).matches = 1;
  pool.getScore(1).margin = 10;
  pool.getScore(2).matches = 1;
  pool.getScore(2).margin = 20;
  pool.getScore(3).matches = 1;
  pool.getScore(3).margin = 30;

  pool.freezeBottomTeams(0.34);
  pool.finalizeRemaining();

  assert.deepEqual(pool.finalScoresOrdered.map((score) => score.team.id), [3, 2, 1]);
});
```

Create `lib/v3/v3/src/tournament/rng.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { seededShuffle } from "./rng.js";

test("seededShuffle is deterministic and does not mutate input", () => {
  const input = [1, 2, 3, 4, 5, 6];
  const first = seededShuffle(input, 1234);
  const second = seededShuffle(input, 1234);
  const different = seededShuffle(input, 1235);

  assert.deepEqual(input, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, different);
  assert.deepEqual([...first].sort((a, b) => a - b), input);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
cd lib/v3/v3
npx --yes tsx --test src/tournament/pools.test.ts src/tournament/rng.test.ts
```

Expected: FAIL because the tournament modules do not exist.

- [ ] **Step 3: Create tournament types**

Create `lib/v3/v3/src/tournament/types.ts`:

```ts
export type MainHeroRole = "inf" | "lanc" | "mark";

export interface Team {
  mains: [string, string, string];
  joiners: [string, string, string, string];
  id: number;
  ratioLabel: string;
  troops: {
    infantry_t10: number;
    lancer_t10: number;
    marksman_t10: number;
  };
}

export interface Score {
  team: Team;
  wins: number;
  matches: number;
  margin: number;
}

export interface BattleSummary {
  attackerId: number;
  defenderId: number;
  avgAttackerLeft: number;
  avgDefenderLeft: number;
}

export interface BattleTask {
  attacker: Team;
  defender: Team;
  seed: number;
  reps: number;
}

export interface TournamentOptions {
  totalRounds: number;
  seedRounds: number;
  reps: number;
  jobs: number;
  seed: number;
  timeLimitMins?: number;
  freezeRate: number;
  startFreezeRound: number;
  minPoolSize: number;
}
```

- [ ] **Step 4: Create deterministic RNG helper**

Create `lib/v3/v3/src/tournament/rng.ts`:

```ts
export function createSeededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 0x6d2b79f5;
  return () => {
    state = Math.imul(state ^ (state >>> 15), state | 1);
    state ^= state + Math.imul(state ^ (state >>> 7), state | 61);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const rng = createSeededRandom(seed);
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    const current = result[index];
    result[index] = result[swapIndex];
    result[swapIndex] = current;
  }
  return result;
}
```

- [ ] **Step 5: Create score pool implementation**

Create `lib/v3/v3/src/tournament/pools.ts`:

```ts
import type { Score, Team } from "./types.js";

export function winRate(score: Score): number {
  return score.matches > 0 ? score.wins / score.matches : 0;
}

export function avgMargin(score: Score): number {
  return score.matches > 0 ? score.margin / score.matches : 0;
}

export class Pool {
  readonly teams: Team[];
  readonly scoreById = new Map<number, Score>();
  scoresActive: Score[];
  scoresFinal: Score[] = [];

  constructor(teams: Team[]) {
    this.teams = teams;
    this.scoresActive = teams.map((team) => ({ team, wins: 0, matches: 0, margin: 0 }));
    for (const score of this.scoresActive) this.scoreById.set(score.team.id, score);
  }

  sortActive(): Score[] {
    this.scoresActive.sort(compareScores);
    return this.scoresActive;
  }

  freezeBottomTeams(freezeRate: number): void {
    if (this.scoresActive.length === 0) return;
    this.sortActive();
    const count = Math.min(this.scoresActive.length, Math.max(1, Math.floor(this.scoresActive.length * freezeRate)));
    for (let index = 0; index < count; index += 1) {
      const score = this.scoresActive.pop();
      if (score) this.scoresFinal.unshift(score);
    }
  }

  get teamsActiveOrdered(): Team[] {
    return this.sortActive().map((score) => score.team);
  }

  get teamsFinalOrdered(): Team[] {
    return this.scoresFinal.map((score) => score.team);
  }

  get allScores(): Score[] {
    return [...this.scoresActive, ...this.scoresFinal];
  }

  get teamsAll(): Team[] {
    return this.allScores.map((score) => score.team);
  }

  getScore(teamId: number): Score {
    const score = this.scoreById.get(teamId);
    if (!score) throw new Error(`Unknown team id ${teamId}`);
    return score;
  }

  finalizeRemaining(): void {
    this.sortActive();
    this.scoresFinal = [...this.scoresActive, ...this.scoresFinal];
    this.scoresActive = [];
  }

  get finalScoresOrdered(): Score[] {
    if (this.scoresActive.length > 0) this.sortActive();
    return [...this.scoresActive, ...this.scoresFinal];
  }
}

function compareScores(left: Score, right: Score): number {
  return (
    winRate(right) - winRate(left) ||
    avgMargin(right) - avgMargin(left) ||
    right.team.id - left.team.id
  );
}
```

- [ ] **Step 6: Run tests and typecheck**

Run:

```bash
cd lib/v3/v3
npx --yes tsx --test src/tournament/pools.test.ts src/tournament/rng.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git -C /home/paul/projects_wsl/wos/battle_sim/lib/v3 add v3/src/tournament/types.ts v3/src/tournament/rng.ts v3/src/tournament/pools.ts v3/src/tournament/pools.test.ts v3/src/tournament/rng.test.ts
git -C /home/paul/projects_wsl/wos/battle_sim/lib/v3 commit -m "feat(v3): add tournament score primitives"
```

## Task 3: Implement Team Generation, Finals Selection, And CSV Results

**Files:**
- Create: `lib/v3/v3/src/tournament/teamGeneration.ts`
- Create: `lib/v3/v3/src/tournament/results.ts`
- Test: `lib/v3/v3/src/tournament/teamGeneration.test.ts`
- Test: `lib/v3/v3/src/tournament/results.test.ts`

- [ ] **Step 1: Write failing tests for ratios, generation, finals filtering, and CSV IO**

Create `lib/v3/v3/src/tournament/teamGeneration.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { generateTeams, parseRatio, selectFinalsTeamsByMainLineup } from "./teamGeneration.js";
import type { Team } from "./types.js";

test("parseRatio normalizes percentages and assigns marksman remainder", () => {
  assert.deepEqual(parseRatio("50,20,30", 100001), {
    infantry_t10: 50001,
    lancer_t10: 20000,
    marksman_t10: 30000
  });
});

test("parseRatio rejects malformed and zero ratios", () => {
  assert.throws(() => parseRatio("50,50", 100), /ratio must be/);
  assert.throws(() => parseRatio("0,0,0", 100), /sum must be greater than zero/);
});

test("generateTeams preserves duplicate Norah semantics", () => {
  const teams = generateTeams([["50-20-30", parseRatio("50,20,30", 100)]], false);
  assert.equal(teams.length, 3 * 2 * 3 * 330);
  assert.ok(teams.some((team) => team.joiners.filter((name) => name === "Norah").length === 2));
});

test("generateTeams supports repeat joiners over the order-sensitive joiner pool", () => {
  const teams = generateTeams([["50-20-30", parseRatio("50,20,30", 100)]], true);
  assert.equal(teams.length, 3 * 2 * 3 * 1001);
});

test("selectFinalsTeamsByMainLineup caps repeated main lineups", () => {
  const teams: Team[] = [1, 2, 3, 4].map((id) => ({
    id,
    mains: id <= 3 ? ["Jeronimo", "Mia", "Gwen"] : ["Hector", "Mia", "Gwen"],
    joiners: ["Jessie", "Seo-yoon", "Lumak", "Logan"],
    ratioLabel: "50-20-30",
    troops: { infantry_t10: 50, lancer_t10: 20, marksman_t10: 30 }
  }));

  assert.deepEqual(selectFinalsTeamsByMainLineup(teams, 3, 2).map((team) => team.id), [1, 2, 4]);
  assert.deepEqual(selectFinalsTeamsByMainLineup(teams, 3, 0).map((team) => team.id), [1, 2, 3]);
});
```

Create `lib/v3/v3/src/tournament/results.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Pool } from "./pools.js";
import {
  deriveResultsLabel,
  loadAllRankedTeamsFromCsv,
  writeResultsCsv
} from "./results.js";
import type { Team } from "./types.js";

function team(id: number, margin: number): Team {
  return {
    id,
    mains: ["Jeronimo", "Mia", "Gwen"],
    joiners: ["Jessie", "Seo-yoon", "Lumak", "Logan"],
    ratioLabel: "50-20-30",
    troops: { infantry_t10: 50, lancer_t10: 20, marksman_t10: 30 }
  };
}

test("deriveResultsLabel strips ds prefix and timestamp suffix", () => {
  assert.equal(deriveResultsLabel("50-20-30"), "50-20-30");
  assert.equal(deriveResultsLabel("ds_mixed_20260510-160417"), "mixed");
  assert.equal(deriveResultsLabel("plain_dir"), "plain_dir");
});

test("writeResultsCsv preserves schema and formatting", () => {
  const root = mkdtempSync(join(tmpdir(), "dual-swiss-"));
  try {
    const teams = [team(1, 10), team(2, 20)];
    const attackPool = new Pool(teams);
    const defensePool = new Pool(teams);
    for (const pool of [attackPool, defensePool]) {
      pool.getScore(1).wins = 1;
      pool.getScore(1).matches = 2;
      pool.getScore(1).margin = 7;
      pool.getScore(2).wins = 2;
      pool.getScore(2).matches = 2;
      pool.getScore(2).margin = 9;
      pool.finalizeRemaining();
    }

    writeResultsCsv(join(root, "swiss"), attackPool, defensePool, 2);
    const text = readFileSync(join(root, "swiss_off.csv"), "utf8").trim();
    assert.equal(
      text.split("\\n")[0],
      "rank,win_rate,avg_margin,matches,formation,hero_1,hero_2,hero_3,joiner_1,joiner_2,joiner_3,joiner_4"
    );
    assert.match(text, /1,1\\.0000,4\\.50,2,50-20-30,Jeronimo,Mia,Gwen,Jessie,Seo-yoon,Lumak,Logan/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadAllRankedTeamsFromCsv rebuilds troops from formation and row ids", () => {
  const root = mkdtempSync(join(tmpdir(), "dual-swiss-"));
  try {
    const file = join(root, "swiss_off.csv");
    const csv = [
      "rank,win_rate,avg_margin,matches,formation,hero_1,hero_2,hero_3,joiner_1,joiner_2,joiner_3,joiner_4",
      "1,1.0000,10.00,2,60-40-0,Jeronimo,Mia,Gwen,Jessie,Seo-yoon,Lumak,Logan"
    ].join("\\n");
    require("node:fs").writeFileSync(file, `${csv}\\n`);
    const teams = loadAllRankedTeamsFromCsv(file, 100);
    assert.equal(teams[0].id, 0);
    assert.deepEqual(teams[0].troops, { infantry_t10: 60, lancer_t10: 40, marksman_t10: 0 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
cd lib/v3/v3
npx --yes tsx --test src/tournament/teamGeneration.test.ts src/tournament/results.test.ts
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement team generation**

Create `lib/v3/v3/src/tournament/teamGeneration.ts` with:

```ts
import type { MainHeroRole, Team } from "./types.js";

export const MAIN_POOL: Record<string, MainHeroRole> = {
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

export const JOINER_POOL = [
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
] as const;

export function parseRatio(text: string, total: number): Team["troops"] {
  const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length !== 3) throw new Error("ratio must be 'inf,lanc,mark'");
  const values = parts.map((part) => Number(part));
  if (values.some((value) => !Number.isFinite(value))) throw new Error("ratio components must be numeric");
  const sum = values[0] + values[1] + values[2];
  if (sum <= 0) throw new Error("ratio sum must be greater than zero");
  const infantry = Math.round((total * values[0]) / sum);
  const lancer = Math.round((total * values[1]) / sum);
  return {
    infantry_t10: infantry,
    lancer_t10: lancer,
    marksman_t10: total - infantry - lancer
  };
}

export function generateTeams(ratios: Array<[string, Team["troops"]]>, allowRepeatedJoiners = false): Team[] {
  const teams: Team[] = [];
  const infantry = heroesForRole("inf");
  const lancer = heroesForRole("lanc");
  const marksman = heroesForRole("mark");
  const joinerCombos = allowRepeatedJoiners
    ? combinationsWithReplacement([...JOINER_POOL], 4)
    : combinations([...JOINER_POOL], 4);
  let id = 0;
  for (const [ratioLabel, troops] of ratios) {
    for (const inf of infantry) {
      for (const lanc of lancer) {
        for (const mark of marksman) {
          for (const joiners of joinerCombos) {
            teams.push({
              id,
              mains: [inf, lanc, mark],
              joiners: joiners as Team["joiners"],
              ratioLabel,
              troops
            });
            id += 1;
          }
        }
      }
    }
  }
  return teams;
}

export function selectFinalsTeamsByMainLineup(teams: Team[], topM: number, maxSameMainLineup: number): Team[] {
  if (maxSameMainLineup <= 0) return teams.slice(0, topM);
  const selected: Team[] = [];
  const counts = new Map<string, number>();
  for (const team of teams) {
    if (selected.length >= topM) break;
    const key = team.mains.join("\\u0000");
    const count = counts.get(key) ?? 0;
    if (count >= maxSameMainLineup) continue;
    selected.push(team);
    counts.set(key, count + 1);
  }
  return selected;
}

function heroesForRole(role: MainHeroRole): string[] {
  return Object.entries(MAIN_POOL).filter(([, value]) => value === role).map(([name]) => name);
}

function combinations<T>(items: T[], size: number): T[][] {
  const output: T[][] = [];
  function visit(start: number, current: T[]): void {
    if (current.length === size) {
      output.push([...current]);
      return;
    }
    for (let index = start; index <= items.length - (size - current.length); index += 1) {
      current.push(items[index]);
      visit(index + 1, current);
      current.pop();
    }
  }
  visit(0, []);
  return output;
}

function combinationsWithReplacement<T>(items: T[], size: number): T[][] {
  const output: T[][] = [];
  function visit(start: number, current: T[]): void {
    if (current.length === size) {
      output.push([...current]);
      return;
    }
    for (let index = start; index < items.length; index += 1) {
      current.push(items[index]);
      visit(index, current);
      current.pop();
    }
  }
  visit(0, []);
  return output;
}
```

- [ ] **Step 4: Implement CSV results module**

Create `lib/v3/v3/src/tournament/results.ts`. Include these public functions:

```ts
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { avgMargin, Pool, winRate } from "./pools.js";
import { parseRatio } from "./teamGeneration.js";
import type { Score, Team } from "./types.js";

const RESULTS_DIR_TIMESTAMP_RE = /^\\d{8}-\\d{6}$/;
const CSV_FIELDS = ["rank", "win_rate", "avg_margin", "matches", "formation", "hero_1", "hero_2", "hero_3", "joiner_1", "joiner_2", "joiner_3", "joiner_4"];

export function deriveResultsLabel(source: string): string {
  const name = basename(source);
  if (!name.startsWith("ds_")) return name;
  const candidate = name.slice(3);
  const split = candidate.lastIndexOf("_");
  if (split < 0) return candidate;
  const prefix = candidate.slice(0, split);
  const suffix = candidate.slice(split + 1);
  return RESULTS_DIR_TIMESTAMP_RE.test(suffix) ? prefix : candidate;
}

export function loadAllRankedTeamsFromCsv(csvPath: string, total: number): Team[] {
  const rows = parseCsv(readFileSync(csvPath, "utf8"));
  return rows.map((row, id) => ({
    id,
    mains: [row.hero_1, row.hero_2, row.hero_3],
    joiners: [row.joiner_1, row.joiner_2, row.joiner_3, row.joiner_4],
    ratioLabel: row.formation,
    troops: parseRatio(row.formation.replace(/-/g, ","), total)
  }));
}

export function loadRankedTeamsFromCsv(csvPath: string, topM: number, total: number): Team[] {
  const teams = loadAllRankedTeamsFromCsv(csvPath, total);
  if (teams.length < topM) throw new Error(`${csvPath} contains only ${teams.length} rows, but ${topM} were requested`);
  return teams.slice(0, topM);
}

export function copyQualifierCsvs(sourceDir: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true });
  for (const name of ["swiss_off.csv", "swiss_def.csv"]) {
    copyFileSync(join(sourceDir, name), join(destDir, name));
  }
}

export function writeResultsCsv(pathPrefix: string, attackerPool: Pool, defenderPool: Pool, topN: number, offenseTeams?: Team[], defenseTeams?: Team[]): void {
  writeOneCsv(`${pathPrefix}_off.csv`, filterScores(attackerPool, offenseTeams).slice(0, topN));
  writeOneCsv(`${pathPrefix}_def.csv`, filterScores(defenderPool, defenseTeams).slice(0, topN));
}

function filterScores(pool: Pool, allowedTeams?: Team[]): Score[] {
  const scores = pool.scoresFinal.length > 0 ? pool.scoresFinal : pool.finalScoresOrdered;
  if (!allowedTeams) return scores;
  const allowed = new Set(allowedTeams.map((team) => team.id));
  return scores.filter((score) => allowed.has(score.team.id));
}

function writeOneCsv(path: string, scores: Score[]): void {
  mkdirSync(dirname(path), { recursive: true });
  if (scores.length === 0) {
    writeFileSync(path, "");
    return;
  }
  const lines = [CSV_FIELDS.join(",")];
  scores.forEach((score, index) => {
    const team = score.team;
    lines.push([
      String(index + 1),
      winRate(score).toFixed(4),
      avgMargin(score).toFixed(2),
      String(score.matches),
      team.ratioLabel,
      ...team.mains,
      ...team.joiners
    ].map(csvEscape).join(","));
  });
  writeFileSync(path, `${lines.join("\\n")}\\n`);
}

function csvEscape(value: string): string {
  return /[",\\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.trim().split(/\\r?\\n/).filter(Boolean);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === ",") {
      values.push(current);
      current = "";
    } else if (char === '"') {
      quoted = true;
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}
```

- [ ] **Step 5: Fix the CommonJS write in the test if typecheck complains**

If `require("node:fs")` in `results.test.ts` fails typecheck in ESM, replace it with an import:

```ts
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
```

Then replace:

```ts
require("node:fs").writeFileSync(file, `${csv}\n`);
```

with:

```ts
writeFileSync(file, `${csv}\n`);
```

- [ ] **Step 6: Run tests and typecheck**

Run:

```bash
cd lib/v3/v3
npx --yes tsx --test src/tournament/teamGeneration.test.ts src/tournament/results.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git -C /home/paul/projects_wsl/wos/battle_sim/lib/v3 add v3/src/tournament/teamGeneration.ts v3/src/tournament/results.ts v3/src/tournament/teamGeneration.test.ts v3/src/tournament/results.test.ts
git -C /home/paul/projects_wsl/wos/battle_sim/lib/v3 commit -m "feat(v3): add tournament team and result IO"
```

## Task 4: Convert Teams To V3 Battle Inputs And Run Direct Battles

**Files:**
- Create: `lib/v3/v3/src/tournament/teamInput.ts`
- Create: `lib/v3/v3/src/tournament/battleRunner.ts`
- Test: `lib/v3/v3/src/tournament/teamInput.test.ts`
- Test: `lib/v3/v3/src/tournament/battleRunner.test.ts`

- [ ] **Step 1: Write failing adapter and direct runner tests**

Create `lib/v3/v3/src/tournament/teamInput.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { loadSimulatorConfig } from "../config.js";
import { teamToFighterInput, teamToBattleInput } from "./teamInput.js";
import type { Team } from "./types.js";

const sampleTeam: Team = {
  id: 7,
  mains: ["Jeronimo", "Mia", "Gwen"],
  joiners: ["Jessie", "Norah", "Norah", "Wu Ming"],
  ratioLabel: "50-20-30",
  troops: { infantry_t10: 50, lancer_t10: 20, marksman_t10: 30 }
};

test("teamToFighterInput maps mains and repeated joiners to array hero inputs", () => {
  const fighter = teamToFighterInput(sampleTeam, loadSimulatorConfig());
  assert.deepEqual(fighter.troops, sampleTeam.troops);
  assert.ok(Array.isArray(fighter.heroes));
  assert.ok(Array.isArray(fighter.joiner_heroes));
  assert.equal(fighter.heroes.length, 3);
  assert.equal(fighter.joiner_heroes.length, 4);
  assert.deepEqual(fighter.joiner_heroes.filter((entry) => entry.name === "Norah").map((entry) => entry.levels), [{ skill_1: 5 }, { skill_1: 5 }]);
});

test("teamToBattleInput sets max rounds, seed, and hero generation mechanics", () => {
  const input = teamToBattleInput(sampleTeam, sampleTeam, 123, loadSimulatorConfig());
  assert.equal(input.maxRounds, 600);
  assert.equal(input.seed, 123);
  assert.deepEqual(input.mechanics, { hero_generation_stats: true });
});
```

Create `lib/v3/v3/src/tournament/battleRunner.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { loadSimulatorConfig } from "../config.js";
import { runSingleBattleDirect, totalRemaining } from "./battleRunner.js";
import type { Team } from "./types.js";

const team: Team = {
  id: 1,
  mains: ["Jeronimo", "Mia", "Gwen"],
  joiners: ["Jessie", "Seo-yoon", "Lumak", "Logan"],
  ratioLabel: "50-20-30",
  troops: { infantry_t10: 50, lancer_t10: 20, marksman_t10: 30 }
};

test("totalRemaining sums all v3 unit types", () => {
  assert.equal(totalRemaining({ infantry: 1, lancer: 2, marksman: 3 }), 6);
});

test("runSingleBattleDirect returns integer average survivors", () => {
  const result = runSingleBattleDirect({ attacker: team, defender: { ...team, id: 2 }, seed: 42, reps: 1 }, loadSimulatorConfig());
  assert.equal(result.attackerId, 1);
  assert.equal(result.defenderId, 2);
  assert.equal(Number.isInteger(result.avgAttackerLeft), true);
  assert.equal(Number.isInteger(result.avgDefenderLeft), true);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
cd lib/v3/v3
npx --yes tsx --test src/tournament/teamInput.test.ts src/tournament/battleRunner.test.ts
```

Expected: FAIL because adapters do not exist.

- [ ] **Step 3: Implement team input adapter**

Create `lib/v3/v3/src/tournament/teamInput.ts`:

```ts
import type { BattleInput, FighterInput, HeroInputEntry, SimulatorConfig, SkillFile } from "../types.js";
import type { Team } from "./types.js";

export function teamToBattleInput(attacker: Team, defender: Team, seed: number, config: SimulatorConfig): BattleInput {
  return {
    attacker: teamToFighterInput(attacker, config),
    defender: teamToFighterInput(defender, config),
    seed,
    maxRounds: 600,
    mechanics: { hero_generation_stats: true }
  };
}

export function teamToFighterInput(team: Team, config: SimulatorConfig): FighterInput {
  return {
    name: "max",
    troops: { ...team.troops },
    heroes: team.mains.map((name) => ({ name, levels: allCombatSkillsAtLevelFive(name, config) })),
    joiner_heroes: team.joiners.map((name) => ({ name, levels: { skill_1: 5 } }))
  };
}

export function allCombatSkillsAtLevelFive(heroName: string, config: SimulatorConfig): Record<string, number> {
  const definition = heroDefinitionFor(heroName, config);
  if (!definition) throw new Error(`Missing v3 hero definition for ${heroName}`);
  const levels: Record<string, number> = {};
  let index = 0;
  for (const skill of Object.keys(definition.skills ?? {})) {
    index += 1;
    levels[`skill_${index}`] = 5;
    levels[skill] = 5;
  }
  return levels;
}

function heroDefinitionFor(heroName: string, config: SimulatorConfig): SkillFile | undefined {
  const direct = config.heroDefinitions[heroName];
  if (direct) return direct;
  const normalized = normalizeHeroName(heroName);
  const alias = config.heroAliasIndex?.[normalized];
  if (alias) return config.heroDefinitions[alias];
  for (const [key, definition] of Object.entries(config.heroDefinitions)) {
    if (normalizeHeroName(key) === normalized || normalizeHeroName(definition.name ?? "") === normalized) return definition;
  }
  return undefined;
}

function normalizeHeroName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

void (undefined as unknown as HeroInputEntry);
```

If the final `void` line is not needed after imports settle, remove the unused import instead.

- [ ] **Step 4: Implement direct battle runner**

Create `lib/v3/v3/src/tournament/battleRunner.ts`:

```ts
import { simulateBattle } from "../simulator.js";
import type { BattleResult, SimulatorConfig, UnitType } from "../types.js";
import { teamToBattleInput } from "./teamInput.js";
import type { BattleSummary, BattleTask } from "./types.js";

export function runSingleBattleDirect(task: BattleTask, config: SimulatorConfig): BattleSummary {
  let totalAttackerLeft = 0;
  let totalDefenderLeft = 0;
  for (let rep = 0; rep < task.reps; rep += 1) {
    const input = teamToBattleInput(task.attacker, task.defender, task.seed + rep, config);
    const result = simulateBattle(input, config);
    totalAttackerLeft += totalRemaining(result.remaining.attacker);
    totalDefenderLeft += totalRemaining(result.remaining.defender);
  }
  return {
    attackerId: task.attacker.id,
    defenderId: task.defender.id,
    avgAttackerLeft: Math.floor(totalAttackerLeft / task.reps),
    avgDefenderLeft: Math.floor(totalDefenderLeft / task.reps)
  };
}

export function totalRemaining(remaining: BattleResult["remaining"]["attacker"]): number {
  return (remaining.infantry ?? 0) + (remaining.lancer ?? 0) + (remaining.marksman ?? 0);
}
```

- [ ] **Step 5: Run tests and typecheck**

Run:

```bash
cd lib/v3/v3
npx --yes tsx --test src/tournament/teamInput.test.ts src/tournament/battleRunner.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git -C /home/paul/projects_wsl/wos/battle_sim/lib/v3 add v3/src/tournament/teamInput.ts v3/src/tournament/battleRunner.ts v3/src/tournament/teamInput.test.ts v3/src/tournament/battleRunner.test.ts
git -C /home/paul/projects_wsl/wos/battle_sim/lib/v3 commit -m "feat(v3): adapt tournament teams to simulator battles"
```

## Task 5: Add Worker-Thread Battle Execution

**Files:**
- Create: `lib/v3/v3/src/tournament/worker.ts`
- Create: `lib/v3/v3/src/tournament/workerPool.ts`
- Modify: `lib/v3/v3/src/tournament/battleRunner.ts`
- Test: `lib/v3/v3/src/tournament/workerPool.test.ts`

- [ ] **Step 1: Write failing worker pool test**

Create `lib/v3/v3/src/tournament/workerPool.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { runBattleTasks } from "./battleRunner.js";
import type { BattleTask, Team } from "./types.js";

function team(id: number): Team {
  return {
    id,
    mains: ["Jeronimo", "Mia", "Gwen"],
    joiners: ["Jessie", "Seo-yoon", "Lumak", "Logan"],
    ratioLabel: "50-20-30",
    troops: { infantry_t10: 50, lancer_t10: 20, marksman_t10: 30 }
  };
}

test("runBattleTasks handles jobs=1 direct execution", async () => {
  const tasks: BattleTask[] = [{ attacker: team(1), defender: team(2), seed: 1, reps: 1 }];
  const progress: number[] = [];
  const results = await runBattleTasks(tasks, 1, (completed) => progress.push(completed));
  assert.equal(results.length, 1);
  assert.deepEqual(progress, [1]);
});

test("runBattleTasks handles worker execution", async () => {
  const tasks: BattleTask[] = [{ attacker: team(1), defender: team(2), seed: 1, reps: 1 }];
  const results = await runBattleTasks(tasks, 2);
  assert.equal(results[0].attackerId, 1);
  assert.equal(results[0].defenderId, 2);
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
cd lib/v3/v3
npx --yes tsx --test src/tournament/workerPool.test.ts
```

Expected: FAIL because worker functions do not exist.

- [ ] **Step 3: Implement worker entrypoint**

Create `lib/v3/v3/src/tournament/worker.ts`:

```ts
import { parentPort } from "node:worker_threads";

import { loadSimulatorConfig } from "../config.js";
import { runSingleBattleDirect } from "./battleRunner.js";
import type { BattleTask } from "./types.js";

interface WorkerRequest {
  id: number;
  task: BattleTask;
}

if (!parentPort) throw new Error("tournament worker requires parentPort");

const config = loadSimulatorConfig();

parentPort.on("message", (request: WorkerRequest) => {
  try {
    const result = runSingleBattleDirect(request.task, config);
    parentPort!.postMessage({ id: request.id, result });
  } catch (error) {
    parentPort!.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) });
  }
});
```

- [ ] **Step 4: Implement worker pool**

Create `lib/v3/v3/src/tournament/workerPool.ts`:

```ts
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import type { BattleSummary, BattleTask } from "./types.js";

interface WorkerResponse {
  id: number;
  result?: BattleSummary;
  error?: string;
}

interface PendingTask {
  task: BattleTask;
  resolve: (result: BattleSummary) => void;
  reject: (error: Error) => void;
}

interface WorkerState {
  worker: Worker;
  idle: boolean;
  closed: boolean;
  inFlight?: {
    resolve: (result: BattleSummary) => void;
    reject: (error: Error) => void;
  };
}

export class TournamentWorkerPool {
  private readonly workers: WorkerState[];
  private readonly queue: PendingTask[] = [];
  private nextId = 1;

  constructor(size: number) {
    const count = Math.max(1, Math.floor(size || cpus().length || 1));
    this.workers = Array.from({ length: count }, () => this.startWorker());
  }

  run(task: BattleTask): Promise<BattleSummary> {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.pump();
    });
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((state) => state.worker.terminate().then(() => undefined)));
  }

  private startWorker(): WorkerState {
    const worker = new Worker(fileURLToPath(new URL("./worker.ts", import.meta.url)), {
      execArgv: ["--import", "tsx"]
    });
    const state: WorkerState = { worker, idle: true, closed: false };
    worker.on("message", (message: WorkerResponse) => this.handleResponse(state, message));
    worker.on("error", (error) => this.handleFailure(state, error));
    worker.on("exit", (code) => {
      state.closed = true;
      state.idle = false;
      if (code !== 0) this.handleFailure(state, new Error(`Tournament worker exited with code ${code}`));
    });
    return state;
  }

  private handleResponse(state: WorkerState, message: WorkerResponse): void {
    const inFlight = state.inFlight;
    if (!inFlight) return;
    state.inFlight = undefined;
    state.idle = true;
    if (message.error) inFlight.reject(new Error(message.error));
    else if (message.result) inFlight.resolve(message.result);
    else inFlight.reject(new Error(`Malformed tournament worker response for job ${message.id}`));
    this.pump();
  }

  private handleFailure(state: WorkerState, error: Error): void {
    state.closed = true;
    state.idle = false;
    if (state.inFlight) {
      state.inFlight.reject(error);
      state.inFlight = undefined;
    }
    while (this.queue.length > 0) this.queue.shift()!.reject(error);
  }

  private pump(): void {
    for (const state of this.workers) {
      if (!state.idle || state.closed) continue;
      const pending = this.queue.shift();
      if (!pending) return;
      const id = this.nextId;
      this.nextId += 1;
      state.idle = false;
      state.inFlight = { resolve: pending.resolve, reject: pending.reject };
      state.worker.postMessage({ id, task: pending.task });
    }
  }
}
```

- [ ] **Step 5: Add batch runner**

Append to `lib/v3/v3/src/tournament/battleRunner.ts`:

```ts
import { loadSimulatorConfig } from "../config.js";
import { TournamentWorkerPool } from "./workerPool.js";

export async function runBattleTasks(
  tasks: BattleTask[],
  jobs: number,
  onProgress?: (completed: number, total: number) => void
): Promise<BattleSummary[]> {
  const results: BattleSummary[] = [];
  const total = tasks.length;
  if (jobs <= 1) {
    const config = loadSimulatorConfig();
    for (const task of tasks) {
      results.push(runSingleBattleDirect(task, config));
      onProgress?.(results.length, total);
    }
    return results;
  }
  const pool = new TournamentWorkerPool(jobs);
  try {
    let completed = 0;
    await Promise.all(
      tasks.map(async (task) => {
        const result = await pool.run(task);
        results.push(result);
        completed += 1;
        onProgress?.(completed, total);
      })
    );
    return results;
  } finally {
    await pool.close();
  }
}
```

If this creates a circular import between `battleRunner.ts` and `workerPool.ts`, move `runBattleTasks()` into a new `batchRunner.ts` and update imports in later tasks accordingly.

- [ ] **Step 6: Run tests and typecheck**

Run:

```bash
cd lib/v3/v3
npx --yes tsx --test src/tournament/workerPool.test.ts
npm run typecheck
```

Expected: PASS. If the worker loader rejects `execArgv: ["--import", "tsx"]`, use `execArgv: ["--loader", "tsx/esm"]` and keep the test passing.

- [ ] **Step 7: Commit**

Run:

```bash
git -C /home/paul/projects_wsl/wos/battle_sim/lib/v3 add v3/src/tournament/worker.ts v3/src/tournament/workerPool.ts v3/src/tournament/battleRunner.ts v3/src/tournament/workerPool.test.ts
git -C /home/paul/projects_wsl/wos/battle_sim/lib/v3 commit -m "feat(v3): run tournament battles in workers"
```

## Task 6: Implement Swiss And Finals Orchestration

**Files:**
- Create: `lib/v3/v3/src/tournament/dualSwiss.ts`
- Test: `lib/v3/v3/src/tournament/dualSwiss.test.ts`

- [ ] **Step 1: Write failing orchestration tests with a stub runner**

Create `lib/v3/v3/src/tournament/dualSwiss.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { Pool } from "./pools.js";
import {
  aggregateBattleResults,
  createDualRankingTasks,
  createRandomRoundTasks,
  runFinalsRoundRobin
} from "./dualSwiss.js";
import type { BattleSummary, BattleTask, Team } from "./types.js";

function team(id: number): Team {
  return {
    id,
    mains: ["Jeronimo", "Mia", "Gwen"],
    joiners: ["Jessie", "Seo-yoon", "Lumak", "Logan"],
    ratioLabel: "50-20-30",
    troops: { infantry_t10: 50, lancer_t10: 20, marksman_t10: 30 }
  };
}

test("aggregateBattleResults applies asymmetric offense and defense scoring", () => {
  const teams = [team(1), team(2)];
  const attackPool = new Pool(teams);
  const defensePool = new Pool(teams);
  aggregateBattleResults(attackPool, defensePool, [
    { attackerId: 1, defenderId: 2, avgAttackerLeft: 10, avgDefenderLeft: 0 },
    { attackerId: 2, defenderId: 1, avgAttackerLeft: 0, avgDefenderLeft: 8 }
  ]);

  assert.equal(attackPool.getScore(1).wins, 1);
  assert.equal(attackPool.getScore(1).margin, 10);
  assert.equal(defensePool.getScore(1).wins, 1);
  assert.equal(defensePool.getScore(1).margin, 8);
});

test("createDualRankingTasks pairs attackers and defenders by active rank", () => {
  const teams = [team(1), team(2), team(3)];
  const attackPool = new Pool(teams);
  const defensePool = new Pool(teams);
  attackPool.getScore(1).matches = 1;
  attackPool.getScore(1).margin = 30;
  defensePool.getScore(2).matches = 1;
  defensePool.getScore(2).margin = 40;
  const tasks = createDualRankingTasks(attackPool, defensePool, 3, 2, 99);
  assert.deepEqual(tasks.map((task) => [task.attacker.id, task.defender.id, task.seed]), [
    [1, 2, 30099],
    [3, 3, 31099],
    [2, 1, 32099]
  ]);
});

test("createRandomRoundTasks is deterministic", () => {
  const teams = [team(1), team(2), team(3), team(4)];
  const first = createRandomRoundTasks(new Pool(teams), new Pool(teams), 1, 1, 123);
  const second = createRandomRoundTasks(new Pool(teams), new Pool(teams), 1, 1, 123);
  assert.deepEqual(
    first.map((task) => [task.attacker.id, task.defender.id, task.seed]),
    second.map((task) => [task.attacker.id, task.defender.id, task.seed])
  );
});

test("runFinalsRoundRobin scores from scratch", async () => {
  const attackers = [team(1), team(2)];
  const defenders = [team(3)];
  const runner = async (tasks: BattleTask[]): Promise<BattleSummary[]> =>
    tasks.map((task) => ({
      attackerId: task.attacker.id,
      defenderId: task.defender.id,
      avgAttackerLeft: task.attacker.id === 1 ? 10 : 0,
      avgDefenderLeft: task.attacker.id === 1 ? 0 : 5
    }));
  const [attackPool, defensePool] = await runFinalsRoundRobin(attackers, defenders, 1, 1, 10, runner);
  assert.deepEqual(attackPool.finalScoresOrdered.map((score) => score.team.id), [1, 2]);
  assert.deepEqual(defensePool.finalScoresOrdered.map((score) => score.team.id), [3]);
  assert.equal(defensePool.getScore(3).matches, 2);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
cd lib/v3/v3
npx --yes tsx --test src/tournament/dualSwiss.test.ts
```

Expected: FAIL because `dualSwiss.ts` does not exist.

- [ ] **Step 3: Implement dual Swiss orchestration**

Create `lib/v3/v3/src/tournament/dualSwiss.ts`:

```ts
import { runBattleTasks } from "./battleRunner.js";
import { Pool } from "./pools.js";
import { seededShuffle } from "./rng.js";
import type { BattleSummary, BattleTask, Team, TournamentOptions } from "./types.js";

export type BattleTaskRunner = (
  tasks: BattleTask[],
  jobs: number,
  onProgress?: (completed: number, total: number) => void
) => Promise<BattleSummary[]>;

export function createRandomRoundTasks(attackerPool: Pool, defenderPool: Pool, roundNum: number, reps: number, seed: number): BattleTask[] {
  const attackers = seededShuffle(attackerPool.teamsActiveOrdered, seed + roundNum);
  const defenders = seededShuffle(defenderPool.teamsActiveOrdered, seed + roundNum + 100000);
  if (attackers.length !== defenders.length) throw new Error(`Pool size mismatch: ${attackers.length} attackers vs ${defenders.length} defenders`);
  return attackers.map((attacker, index) => ({
    attacker,
    defender: defenders[index],
    seed: seed + roundNum + index * 1000,
    reps
  }));
}

export function createDualRankingTasks(attackerPool: Pool, defenderPool: Pool, roundNum: number, reps: number, seed: number): BattleTask[] {
  const attackers = attackerPool.teamsActiveOrdered;
  const defenders = defenderPool.teamsActiveOrdered;
  if (attackers.length !== defenders.length) throw new Error(`Pool size mismatch: ${attackers.length} attackers vs ${defenders.length} defenders`);
  return attackers.map((attacker, index) => ({
    attacker,
    defender: defenders[index],
    seed: seed + roundNum * 10000 + index * 1000,
    reps
  }));
}

export function aggregateBattleResults(attackerPool: Pool, defenderPool: Pool, results: BattleSummary[]): void {
  for (const result of results) {
    const margin = result.avgAttackerLeft - result.avgDefenderLeft;
    const attackScore = attackerPool.getScore(result.attackerId);
    const defenseScore = defenderPool.getScore(result.defenderId);
    attackScore.matches += 1;
    attackScore.margin += margin;
    if (result.avgAttackerLeft > 0 && result.avgDefenderLeft === 0) attackScore.wins += 1;
    defenseScore.matches += 1;
    defenseScore.margin += -margin;
    if (result.avgDefenderLeft > 0 && result.avgAttackerLeft === 0) defenseScore.wins += 1;
  }
}

export async function runDualSwissTournament(
  attackerPool: Pool,
  defenderPool: Pool,
  options: TournamentOptions,
  runner: BattleTaskRunner = runBattleTasks,
  onProgress?: (label: string, completed: number, total: number) => void
): Promise<[Pool, Pool]> {
  const startedAt = Date.now();
  let round = 1;
  const freezeEnabled = options.freezeRate > 0;
  while (true) {
    const elapsedMins = (Date.now() - startedAt) / 60000;
    const activeAttackers = attackerPool.teamsActiveOrdered;
    const activeDefenders = defenderPool.teamsActiveOrdered;
    if (options.timeLimitMins !== undefined && elapsedMins > options.timeLimitMins) break;
    if (round > options.totalRounds) break;
    if (freezeEnabled && activeAttackers.length < options.minPoolSize && activeDefenders.length < options.minPoolSize) break;
    if (activeAttackers.length === 0 || activeDefenders.length === 0) break;
    const isSeedRound = round <= options.seedRounds;
    const tasks = isSeedRound
      ? createRandomRoundTasks(attackerPool, defenderPool, round, options.reps, options.seed)
      : createDualRankingTasks(attackerPool, defenderPool, round, options.reps, options.seed);
    const label = `Round ${round} (${isSeedRound ? "random" : "Swiss"})`;
    const results = await runner(tasks, options.jobs, (completed, total) => onProgress?.(label, completed, total));
    aggregateBattleResults(attackerPool, defenderPool, results);
    if (freezeEnabled && round >= options.startFreezeRound) {
      attackerPool.freezeBottomTeams(options.freezeRate);
      defenderPool.freezeBottomTeams(options.freezeRate);
    }
    round += 1;
  }
  attackerPool.finalizeRemaining();
  defenderPool.finalizeRemaining();
  return [attackerPool, defenderPool];
}

export async function runFinalsRoundRobin(
  attackerTeams: Team[],
  defenderTeams: Team[],
  reps: number,
  jobs: number,
  seed: number,
  runner: BattleTaskRunner = runBattleTasks,
  onProgress?: (label: string, completed: number, total: number) => void
): Promise<[Pool, Pool]> {
  const attackerPool = new Pool(attackerTeams);
  const defenderPool = new Pool(defenderTeams);
  const tasks: BattleTask[] = [];
  for (const attacker of attackerTeams) {
    for (const defender of defenderTeams) {
      tasks.push({ attacker, defender, seed: seed + 999000 + tasks.length * 1000, reps });
    }
  }
  const results = await runner(tasks, jobs, (completed, total) => onProgress?.("Finals round-robin", completed, total));
  aggregateBattleResults(attackerPool, defenderPool, results);
  attackerPool.finalizeRemaining();
  defenderPool.finalizeRemaining();
  return [attackerPool, defenderPool];
}
```

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
cd lib/v3/v3
npx --yes tsx --test src/tournament/dualSwiss.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git -C /home/paul/projects_wsl/wos/battle_sim/lib/v3 add v3/src/tournament/dualSwiss.ts v3/src/tournament/dualSwiss.test.ts
git -C /home/paul/projects_wsl/wos/battle_sim/lib/v3 commit -m "feat(v3): add dual Swiss tournament orchestration"
```

## Task 7: Add CLI And Package Script

**Files:**
- Create: `lib/v3/v3/src/tournament/dualSwissCli.ts`
- Modify: `lib/v3/v3/package.json`
- Test: `lib/v3/v3/src/tournament/dualSwissCli.test.ts`

- [ ] **Step 1: Write failing CLI parser tests**

Create `lib/v3/v3/src/tournament/dualSwissCli.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseCliArgs } from "./dualSwissCli.js";

test("parseCliArgs applies Python defaults", () => {
  const options = parseCliArgs([]);
  assert.deepEqual(options.ratios, ["50,20,30"]);
  assert.equal(options.total, 100000);
  assert.equal(options.rounds, 10);
  assert.equal(options.seedRounds, 2);
  assert.equal(options.freezeRate, 0.2);
  assert.equal(options.repeatJoiners, false);
});

test("parseCliArgs parses multiple ratios and finals options", () => {
  const options = parseCliArgs([
    "--ratios",
    "50,20,30",
    "60,40,0",
    "--finals-top-m",
    "10",
    "--finals-reps",
    "3",
    "--repeat-joiners"
  ]);
  assert.deepEqual(options.ratios, ["50,20,30", "60,40,0"]);
  assert.equal(options.finalsTopM, 10);
  assert.equal(options.finalsReps, 3);
  assert.equal(options.repeatJoiners, true);
});

test("parseCliArgs rejects finals-only without top m", () => {
  assert.throws(() => parseCliArgs(["--finals-only", "some-dir"]), /requires --finals-top-m > 0/);
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
cd lib/v3/v3
npx --yes tsx --test src/tournament/dualSwissCli.test.ts
```

Expected: FAIL because the CLI module does not exist.

- [ ] **Step 3: Implement CLI**

Create `lib/v3/v3/src/tournament/dualSwissCli.ts`. Export `parseCliArgs(args: string[])` for tests and run `main()` only when invoked as the entrypoint.

Use this CLI option shape:

```ts
export interface CliOptions {
  ratios: string[];
  total: number;
  rounds: number;
  timeLimit?: number;
  seedRounds: number;
  reps: number;
  topN: number;
  jobs: number;
  seed: number;
  freezeRate: number;
  startFreezeRound: number;
  minPoolSize: number;
  finalsTopM: number;
  finalsReps?: number;
  finalsOnly?: string;
  finalsMaxSameHeroes: number;
  repeatJoiners: boolean;
}
```

Parser rules:

```ts
const defaults: CliOptions = {
  ratios: ["50,20,30"],
  total: 100000,
  rounds: 10,
  seedRounds: 2,
  reps: 1,
  topN: 200,
  jobs: cpus().length || 4,
  seed: 1234,
  freezeRate: 0.2,
  startFreezeRound: 8,
  minPoolSize: 200,
  finalsTopM: 0,
  finalsMaxSameHeroes: 0,
  repeatJoiners: false
};
```

Main orchestration:

```ts
async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const finalsReps = args.finalsReps ?? args.reps;
  let topAttackers: Team[] | undefined;
  let topDefenders: Team[] | undefined;
  let outDir: string;

  if (args.finalsOnly) {
    const attackCandidates = loadAllRankedTeamsFromCsv(join(args.finalsOnly, "swiss_off.csv"), args.total);
    const defenseCandidates = loadAllRankedTeamsFromCsv(join(args.finalsOnly, "swiss_def.csv"), args.total);
    if (attackCandidates.length < args.finalsTopM || defenseCandidates.length < args.finalsTopM) {
      throw new Error(`--finals-top-m=${args.finalsTopM} requested, but ${args.finalsOnly} has only ${attackCandidates.length} offense and ${defenseCandidates.length} defense candidates`);
    }
    topAttackers = selectFinalsTeamsByMainLineup(attackCandidates, args.finalsTopM, args.finalsMaxSameHeroes);
    topDefenders = selectFinalsTeamsByMainLineup(defenseCandidates, args.finalsTopM, args.finalsMaxSameHeroes);
    outDir = join("tournament_results", `ds_${deriveResultsLabel(args.finalsOnly)}_${timestamp()}`);
    copyQualifierCsvs(args.finalsOnly, outDir);
  } else {
    const ratioList = args.ratios.map((ratio) => [ratio.replace(/,/g, "-"), parseRatio(ratio, args.total)] as const);
    const teams = generateTeams(ratioList.map(([label, troops]) => [label, troops]), args.repeatJoiners);
    const label = ratioList.length === 1 ? ratioList[0][0] : "mixed";
    outDir = join("tournament_results", `ds_${label}_${timestamp()}`);
    const [attackPool, defensePool] = await runDualSwissTournament(
      new Pool(teams),
      new Pool(teams),
      {
        totalRounds: args.rounds,
        seedRounds: args.seedRounds,
        reps: args.reps,
        jobs: args.jobs,
        seed: args.seed,
        timeLimitMins: args.timeLimit,
        freezeRate: args.freezeRate,
        startFreezeRound: args.startFreezeRound,
        minPoolSize: args.minPoolSize
      },
      runBattleTasks,
      printProgress
    );
    writeResultsCsv(join(outDir, "swiss"), attackPool, defensePool, args.topN);
    if (args.finalsTopM > 0) {
      topAttackers = selectFinalsTeamsByMainLineup(attackPool.finalScoresOrdered.map((score) => score.team), args.finalsTopM, args.finalsMaxSameHeroes);
      topDefenders = selectFinalsTeamsByMainLineup(defensePool.finalScoresOrdered.map((score) => score.team), args.finalsTopM, args.finalsMaxSameHeroes);
    }
  }

  if (topAttackers && topDefenders) {
    const [finalAttackPool, finalDefensePool] = await runFinalsRoundRobin(topAttackers, topDefenders, finalsReps, args.jobs, args.seed, runBattleTasks, printProgress);
    writeResultsCsv(join(outDir, "finals"), finalAttackPool, finalDefensePool, args.finalsTopM, topAttackers, topDefenders);
  }
}
```

Also include:

```ts
function timestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function printProgress(label: string, completed: number, total: number): void {
  const pct = total > 0 ? (completed * 100) / total : 100;
  process.stdout.write(`\r  ${label}: ${pct.toFixed(1)}% (${completed}/${total})`);
  if (completed >= total) process.stdout.write("\n");
}
```

The parser must support value-taking flags exactly as listed in the spec and boolean `--repeat-joiners`.

- [ ] **Step 4: Add package script**

Modify `lib/v3/v3/package.json` scripts:

```json
"tournament:dual-swiss": "npx --yes tsx src/tournament/dualSwissCli.ts"
```

Keep existing scripts unchanged.

- [ ] **Step 5: Run tests and typecheck**

Run:

```bash
cd lib/v3/v3
npx --yes tsx --test src/tournament/dualSwissCli.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git -C /home/paul/projects_wsl/wos/battle_sim/lib/v3 add v3/src/tournament/dualSwissCli.ts v3/src/tournament/dualSwissCli.test.ts v3/package.json
git -C /home/paul/projects_wsl/wos/battle_sim/lib/v3 commit -m "feat(v3): add dual Swiss tournament CLI"
```

## Task 8: End-To-End Verification And Final Fixes

**Files:**
- Modify: any Task 1-7 source file whose verification command fails with a concrete compiler, runtime, or assertion error
- Optional create: `lib/v3/v3/src/tournament/tournamentSmoke.test.ts`

- [ ] **Step 1: Add a small real-simulator smoke test**

Create `lib/v3/v3/src/tournament/tournamentSmoke.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { Pool } from "./pools.js";
import { parseRatio } from "./teamGeneration.js";
import { runDualSwissTournament } from "./dualSwiss.js";
import type { BattleSummary, BattleTask, Team } from "./types.js";

function team(id: number): Team {
  return {
    id,
    mains: ["Jeronimo", "Mia", "Gwen"],
    joiners: ["Jessie", "Seo-yoon", "Lumak", "Logan"],
    ratioLabel: "50-20-30",
    troops: parseRatio("50,20,30", 100)
  };
}

test("small tournament with stubbed battles finalizes offense and defense pools", async () => {
  const teams = [team(1), team(2), team(3)];
  const runner = async (tasks: BattleTask[]): Promise<BattleSummary[]> =>
    tasks.map((task) => ({
      attackerId: task.attacker.id,
      defenderId: task.defender.id,
      avgAttackerLeft: task.attacker.id >= task.defender.id ? 10 : 0,
      avgDefenderLeft: task.attacker.id >= task.defender.id ? 0 : 10
    }));
  const [attackPool, defensePool] = await runDualSwissTournament(
    new Pool(teams),
    new Pool(teams),
    {
      totalRounds: 2,
      seedRounds: 1,
      reps: 1,
      jobs: 1,
      seed: 5,
      freezeRate: 0,
      startFreezeRound: 8,
      minPoolSize: 1
    },
    runner
  );
  assert.equal(attackPool.scoresActive.length, 0);
  assert.equal(defensePool.scoresActive.length, 0);
  assert.equal(attackPool.finalScoresOrdered.length, 3);
  assert.equal(defensePool.finalScoresOrdered.length, 3);
});
```

- [ ] **Step 2: Run the full v3 test suite**

Run:

```bash
cd lib/v3/v3
npm test
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
cd lib/v3/v3
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run a minimal CLI smoke**

Run:

```bash
cd lib/v3/v3
npm run tournament:dual-swiss -- --ratios 50,20,30 --total 300 --rounds 1 --seed-rounds 1 --reps 1 --top-n 5 --jobs 1 --freeze-rate 0
```

Expected: command exits `0` and writes a new directory under `lib/v3/v3/tournament_results/ds_50-20-30_<timestamp>` containing `swiss_off.csv` and `swiss_def.csv`.

- [ ] **Step 5: Run a minimal finals smoke**

Use the directory from Step 4:

```bash
cd lib/v3/v3
npm run tournament:dual-swiss -- --finals-only tournament_results/<directory-from-step-4> --finals-top-m 2 --finals-reps 1 --jobs 1
```

Expected: command exits `0` and writes a new finals directory with copied `swiss_off.csv`, copied `swiss_def.csv`, `finals_off.csv`, and `finals_def.csv`.

- [ ] **Step 6: Inspect generated CSV headers**

Run:

```bash
cd lib/v3/v3
head -n 1 tournament_results/<latest-directory>/swiss_off.csv
head -n 1 tournament_results/<latest-directory>/swiss_def.csv
```

Expected both commands print:

```text
rank,win_rate,avg_margin,matches,formation,hero_1,hero_2,hero_3,joiner_1,joiner_2,joiner_3,joiner_4
```

- [ ] **Step 7: Commit smoke test and fixes**

Run:

```bash
git -C /home/paul/projects_wsl/wos/battle_sim/lib/v3 add v3/src/tournament v3/package.json
git -C /home/paul/projects_wsl/wos/battle_sim/lib/v3 commit -m "test(v3): verify dual Swiss tournament rewrite"
```

## Self-Review Checklist

- The plan covers repeated hero input support, team generation, scoring, freezing, finals, CSV IO, worker execution, CLI parsing, package script, and verification.
- The plan chooses the array-compatible repeated-hero path from the spec.
- The plan avoids Python imports and keeps all new implementation under `lib/v3/v3`.
- The plan keeps CSV schema and output directory naming compatible with the Python script.
- The plan includes exact commands and expected outcomes for each verification step.
