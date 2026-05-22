# V3 Browser Simulate And Optimise Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run `/simulate` battle simulation and ratio optimisation in the browser using the v3 TypeScript simulator, while keeping OCR, saved runs, recent runs, and stat presets server-backed.

**Architecture:** Make the default v3 simulator config bundler-safe through static JSON imports, with Node filesystem loading split into a separate custom-config helper. Add dashboard-side pure adapters/runners, execute them in a Web Worker, then have the React page save completed results through a save-only API.

**Tech Stack:** TypeScript, Next.js 15, React 19, Web Workers, v3 simulator package, Node test runner via `tsx`, Playwright.

---

## File Structure

- Modify `v3/tsconfig.json`: allow JSON config imports.
- Modify `v3/src/config.ts`: export browser-safe default config and shared `buildSimulatorConfig()`.
- Create `v3/src/config-node.ts`: Node-only `loadSimulatorConfigFromDir()` for custom config directories.
- Modify `v3/src/index.ts`: export the shared default config API and keep Node-only APIs out of browser import paths.
- Modify `v3/src/config.test.ts`: use default loader for checked-in config and Node loader for temp directory tests.
- Create `dashboard/web/lib/v3-sim/adapters.ts`: convert dashboard request payloads to v3 `BattleInput`.
- Create `dashboard/web/lib/v3-sim/simulate.ts`: aggregate replicate runs into `SimulateApiResult`.
- Create `dashboard/web/lib/v3-sim/optimise.ts`: TypeScript port of `dashboard/optimize_ratio.py`.
- Create `dashboard/web/lib/v3-sim/worker-protocol.ts`: message and result types shared by UI and worker.
- Create `dashboard/web/app/simulate/simulate.worker.ts`: browser worker entrypoint.
- Create `dashboard/web/lib/v3-sim/worker-client.ts`: React-side worker wrapper.
- Modify `dashboard/web/app/api/simulate/runs/route.ts`: add save-only `POST`.
- Modify `dashboard/web/app/simulate/SimulateClient.tsx`: replace compute API calls with worker calls and save-only API calls.
- Modify `dashboard/web/tsconfig.json`: add an alias for v3 source imports.
- Modify `dashboard/web/next.config.ts`: make dashboard builds accept the v3 source import path.
- Add tests under `dashboard/web/tests` and `dashboard/web/lib/v3-sim/*.test.ts` for the new adapters/runners/API behavior.
- Modify `README_DASHBOARD.md`, `dashboard/web/README.md`, and `docs/wos-sim-production-deployment.md`: update Python/API wording.

## Task 1: Make Default V3 Config Bundler-Safe

**Files:**
- Modify: `v3/tsconfig.json`
- Modify: `v3/src/config.ts`
- Create: `v3/src/config-node.ts`
- Modify: `v3/src/index.ts`
- Modify: `v3/src/config.test.ts`

- [ ] **Step 1: Enable JSON imports in v3 typecheck**

In `v3/tsconfig.json`, add `resolveJsonModule`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 2: Extract raw config builder in `v3/src/config.ts`**

Move all validation/indexing currently inside `loadSimulatorConfig({ configDir })` behind this public builder:

```ts
export interface RawSimulatorConfig {
  troopStats: SimulatorConfig["troopStats"];
  heroGenerationStats: SimulatorConfig["heroGenerationStats"];
  troopSkills: SkillFile;
  heroDefinitions: Record<string, SkillFile>;
  fileLabel?: (kind: "troop_stats" | "hero_generation_stats" | "troop_skills" | "hero_definition", key?: string) => string;
}

export function buildSimulatorConfig(raw: RawSimulatorConfig): SimulatorConfig {
  const diagnostics: ConfigDiagnostics = {
    legacyFields: [],
    effectTypes: {},
    unsupportedEffects: [],
    ambiguousTurnTriggerSelectors: []
  };
  scanLegacyFields(raw.troopStats, raw.fileLabel?.("troop_stats") ?? "config/troop_stats.json", "$", diagnostics);
  scanLegacyFields(raw.heroGenerationStats, raw.fileLabel?.("hero_generation_stats") ?? "config/hero_generation_stats.json", "$", diagnostics);
  scanLegacyFields(raw.troopSkills, raw.fileLabel?.("troop_skills") ?? "config/troop_skills.json", "$", diagnostics);
  for (const [name, hero] of Object.entries(raw.heroDefinitions)) {
    scanLegacyFields(hero, raw.fileLabel?.("hero_definition", name) ?? `config/hero_definitions/${name}.json`, "$", diagnostics);
    if (hero.hero_generation && !raw.heroGenerationStats[hero.hero_generation]) {
      diagnostics.unsupportedEffects.push({
        file: raw.fileLabel?.("hero_definition", name) ?? `config/hero_definitions/${name}.json`,
        skillId: "(hero_generation)",
        effectId: hero.hero_generation,
        type: "missing_hero_generation",
        reason: `Referenced hero_generation ${hero.hero_generation} is not defined`
      });
    }
  }
  collectEffectDiagnostics(raw.troopSkills, raw.fileLabel?.("troop_skills") ?? "config/troop_skills.json", diagnostics);
  for (const [name, hero] of Object.entries(raw.heroDefinitions)) {
    collectEffectDiagnostics(hero, raw.fileLabel?.("hero_definition", name) ?? `config/hero_definitions/${name}.json`, diagnostics);
  }
  const heroAliasIndex = buildHeroAliasIndex(raw.heroDefinitions);
  if (diagnostics.legacyFields.length > 0) {
    const first = diagnostics.legacyFields[0];
    throw new Error(`Legacy field found in v3 config: ${first.field} at ${first.file}:${first.path}`);
  }
  return {
    troopStats: raw.troopStats,
    heroGenerationStats: raw.heroGenerationStats,
    heroDefinitions: raw.heroDefinitions,
    heroAliasIndex,
    troopSkills: raw.troopSkills,
    diagnostics
  };
}
```

- [ ] **Step 3: Replace default config loading with static JSON imports**

At the top of `v3/src/config.ts`, import the checked-in config JSON files. Use the import form that passes `npm --prefix v3 run typecheck`; if TypeScript requires import attributes in this repo, use `with { type: "json" }`.

```ts
import troopStatsJson from "../config/troop_stats.json";
import heroGenerationStatsJson from "../config/hero_generation_stats.json";
import troopSkillsJson from "../config/troop_skills.json";
import Ahmose from "../config/hero_definitions/Ahmose.json";
import Alonso from "../config/hero_definitions/Alonso.json";
import Bahiti from "../config/hero_definitions/Bahiti.json";
import Bradley from "../config/hero_definitions/Bradley.json";
import Edith from "../config/hero_definitions/Edith.json";
import Flint from "../config/hero_definitions/Flint.json";
import Gordon from "../config/hero_definitions/Gordon.json";
import Greg from "../config/hero_definitions/Greg.json";
import Gwen from "../config/hero_definitions/Gwen.json";
import Hector from "../config/hero_definitions/Hector.json";
import Jasser from "../config/hero_definitions/Jasser.json";
import Jeronimo from "../config/hero_definitions/Jeronimo.json";
import Jessie from "../config/hero_definitions/Jessie.json";
import Ling from "../config/hero_definitions/Ling.json";
import Logan from "../config/hero_definitions/Logan.json";
import Lumak from "../config/hero_definitions/Lumak.json";
import Lynn from "../config/hero_definitions/Lynn.json";
import Mia from "../config/hero_definitions/Mia.json";
import Molly from "../config/hero_definitions/Molly.json";
import Natalia from "../config/hero_definitions/Natalia.json";
import Norah from "../config/hero_definitions/Norah.json";
import Patrick from "../config/hero_definitions/Patrick.json";
import Philly from "../config/hero_definitions/Philly.json";
import Reina from "../config/hero_definitions/Reina.json";
import Renee from "../config/hero_definitions/Renee.json";
import SeoYoon from "../config/hero_definitions/Seo-yoon.json";
import Sergey from "../config/hero_definitions/Sergey.json";
import Wayne from "../config/hero_definitions/Wayne.json";
import WuMing from "../config/hero_definitions/WuMing.json";
import Zinman from "../config/hero_definitions/Zinman.json";
```

Then define:

```ts
const DEFAULT_HERO_DEFINITIONS = {
  Ahmose,
  Alonso,
  Bahiti,
  Bradley,
  Edith,
  Flint,
  Gordon,
  Greg,
  Gwen,
  Hector,
  Jasser,
  Jeronimo,
  Jessie,
  Ling,
  Logan,
  Lumak,
  Lynn,
  Mia,
  Molly,
  Natalia,
  Norah,
  Patrick,
  Philly,
  Reina,
  Renee,
  "Seo-yoon": SeoYoon,
  Sergey,
  Wayne,
  WuMing,
  Zinman
} satisfies Record<string, SkillFile>;

export function loadSimulatorConfig(): SimulatorConfig {
  return buildSimulatorConfig({
    troopStats: troopStatsJson as SimulatorConfig["troopStats"],
    heroGenerationStats: heroGenerationStatsJson as SimulatorConfig["heroGenerationStats"],
    troopSkills: troopSkillsJson as SkillFile,
    heroDefinitions: DEFAULT_HERO_DEFINITIONS
  });
}
```

- [ ] **Step 4: Move custom directory loading into `v3/src/config-node.ts`**

Create `v3/src/config-node.ts`:

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { buildSimulatorConfig, type RawSimulatorConfig } from "./config.js";
import type { SimulatorConfig, SkillFile } from "./types.js";

export function loadSimulatorConfigFromDir(configDir: string): SimulatorConfig {
  const root = resolve(configDir);
  const heroDir = join(root, "hero_definitions");
  const heroDefinitions: Record<string, SkillFile> = {};
  for (const file of readdirSync(heroDir).filter((name) => name.endsWith(".json")).sort()) {
    heroDefinitions[file.slice(0, -".json".length)] = readJson(join(heroDir, file)) as SkillFile;
  }
  const raw: RawSimulatorConfig = {
    troopStats: readJson(join(root, "troop_stats.json")) as SimulatorConfig["troopStats"],
    heroGenerationStats: readJson(join(root, "hero_generation_stats.json")) as SimulatorConfig["heroGenerationStats"],
    troopSkills: readJson(join(root, "troop_skills.json")) as SkillFile,
    heroDefinitions,
    fileLabel(kind, key) {
      if (kind === "hero_definition") return relative(process.cwd(), join(heroDir, `${key}.json`));
      if (kind === "troop_stats") return relative(process.cwd(), join(root, "troop_stats.json"));
      if (kind === "hero_generation_stats") return relative(process.cwd(), join(root, "hero_generation_stats.json"));
      return relative(process.cwd(), join(root, "troop_skills.json"));
    }
  };
  return buildSimulatorConfig(raw);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}
```

- [ ] **Step 5: Update custom config tests**

In `v3/src/config.test.ts`, keep default config tests importing `loadSimulatorConfig` from `./config.js`. Import `loadSimulatorConfigFromDir` for temp-directory tests:

```ts
import { loadSimulatorConfig } from "./config.js";
import { loadSimulatorConfigFromDir } from "./config-node.js";
```

Replace every `loadSimulatorConfig({ configDir: root })` call with:

```ts
loadSimulatorConfigFromDir(root)
```

- [ ] **Step 6: Verify v3 config refactor**

Run:

```bash
npm --prefix v3 test -- src/config.test.ts
npm --prefix v3 run typecheck
```

Expected: both commands pass. The typecheck must not report Node imports from `v3/src/config.ts`.

- [ ] **Step 7: Commit config refactor**

```bash
git add v3/tsconfig.json v3/src/config.ts v3/src/config-node.ts v3/src/index.ts v3/src/config.test.ts
git commit -m "Make v3 default config bundler safe"
```

## Task 2: Add Dashboard Payload Adapter And Simulation Aggregator

**Files:**
- Create: `dashboard/web/lib/v3-sim/adapters.ts`
- Create: `dashboard/web/lib/v3-sim/simulate.ts`
- Create: `dashboard/web/lib/v3-sim/adapters.test.ts`
- Create: `dashboard/web/lib/v3-sim/simulate.test.ts`
- Modify: `dashboard/web/tsconfig.json`
- Modify: `dashboard/web/next.config.ts`

- [ ] **Step 1: Add v3 source alias to dashboard TypeScript**

In `dashboard/web/tsconfig.json`, extend `paths`:

```json
"paths": {
  "@/*": ["./*"],
  "@v3/*": ["../../v3/src/*"]
}
```

- [ ] **Step 2: Allow Next to compile the external v3 source path**

In `dashboard/web/next.config.ts`, keep `outputFileTracingRoot` as-is for server output, and add a webpack alias for client builds:

```ts
webpack: (config) => {
  config.resolve = config.resolve ?? {};
  config.resolve.alias = {
    ...(config.resolve.alias ?? {}),
    "@v3": path.resolve(__dirname, "../../v3/src"),
  };
  return config;
},
```

- [ ] **Step 3: Write failing adapter tests**

Create `dashboard/web/lib/v3-sim/adapters.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import type { SimulateRequestPayload } from "@/lib/simulate-run";
import { toBattleInput } from "./adapters";

const request: SimulateRequestPayload = {
  replicates: 3,
  rally_mode: true,
  attacker: {
    troops: { infantry: 100, lancer: 50, marksman: 25 },
    troop_types: { infantry: "infantry_t6", lancer: "lancer_t6", marksman: "marksman_t6" },
    heroes: {
      infantry: { name: "Greg", skills: [5, 4, 3, 2] },
      lancer: { name: null, skills: [0, 0, 0, 0] },
      marksman: { name: "Mia", skills: [1, 2, 3, 4] },
    },
    joiners: [{ name: "Jessie", skill_1: 5 }],
    stats: { inf: [100, 101, 102, 103], lanc: [110, 111, 112, 113], mark: [120, 121, 122, 123] },
    stat_modifiers: { attack: 10, defense: 0, lethality: 5, health: 0, enemy_attack: -20, enemy_defense: -10 },
  },
  defender: {
    troops: { infantry: 90, lancer: 80, marksman: 70 },
    troop_types: { infantry: "infantry_t6", lancer: "lancer_t6", marksman: "marksman_t6" },
    heroes: {
      infantry: { name: null, skills: [0, 0, 0, 0] },
      lancer: { name: null, skills: [0, 0, 0, 0] },
      marksman: { name: null, skills: [0, 0, 0, 0] },
    },
    joiners: [],
    stats: { inf: [100, 100, 100, 100], lanc: [100, 100, 100, 100], mark: [100, 100, 100, 100] },
    stat_modifiers: { attack: 0, defense: 0, lethality: 0, health: 0, enemy_attack: 0, enemy_defense: 0 },
  },
};

test("toBattleInput maps dashboard payload to v3 BattleInput", () => {
  const input = toBattleInput(request, "seed-a");
  assert.equal(input.seed, "seed-a");
  assert.equal(input.mechanics?.engagement_type, "rally");
  assert.deepEqual(input.attacker.troops, { infantry_t6: 100, lancer_t6: 50, marksman_t6: 25 });
  assert.deepEqual(input.attacker.heroes?.Greg, { skill_1: 5, skill_2: 4, skill_3: 3, skill_4: 2 });
  assert.deepEqual(input.attacker.heroes?.Mia, { skill_1: 1, skill_2: 2, skill_3: 3, skill_4: 4 });
  assert.deepEqual(input.attacker.joiner_heroes?.Jessie, { skill_1: 5 });
  assert.equal(input.attacker.stats?.infantry?.attack, 110);
  assert.equal(input.attacker.stats?.infantry?.defense, 111);
  assert.equal(input.attacker.stats?.infantry?.lethality, 107);
  assert.equal(input.attacker.stats?.infantry?.health, 103);
});
```

- [ ] **Step 4: Implement `adapters.ts`**

Create `dashboard/web/lib/v3-sim/adapters.ts`:

```ts
import type { BattleInput, FighterInput, StatBlock, UnitType } from "@v3/types";
import type { SimulateRequestPayload, SimulateSidePayload } from "@/lib/simulate-run";

const CATEGORIES = ["infantry", "lancer", "marksman"] as const;
const STAT_KEYS = ["attack", "defense", "lethality", "health"] as const;

export function toBattleInput(request: SimulateRequestPayload, seed: string | number): BattleInput {
  return {
    attacker: toFighterInput(request.attacker, request.defender),
    defender: toFighterInput(request.defender, request.attacker),
    seed,
    maxRounds: 1500,
    mechanics: request.rally_mode ? { engagement_type: "rally" } : undefined,
  };
}

function toFighterInput(side: SimulateSidePayload, opponent: SimulateSidePayload): FighterInput {
  return {
    troops: Object.fromEntries(CATEGORIES.map((cat) => [side.troop_types[cat], Math.max(0, Math.floor(side.troops[cat] ?? 0))])),
    stats: toStats(side, opponent),
    heroes: toHeroes(side),
    joiner_heroes: toJoinerHeroes(side),
  };
}

function toHeroes(side: SimulateSidePayload): FighterInput["heroes"] {
  const out: NonNullable<FighterInput["heroes"]> = {};
  for (const cat of CATEGORIES) {
    const slot = side.heroes[cat];
    if (!slot?.name) continue;
    out[slot.name] = skillMap(slot.skills);
  }
  return out;
}

function toJoinerHeroes(side: SimulateSidePayload): FighterInput["joiner_heroes"] {
  const out: NonNullable<FighterInput["joiner_heroes"]> = {};
  for (const joiner of side.joiners ?? []) {
    if (!joiner.name) continue;
    out[joiner.name] = { skill_1: Math.max(0, Math.floor(joiner.skill_1 ?? 0)) };
  }
  return out;
}

function skillMap(skills: readonly number[]): Record<string, number> {
  return Object.fromEntries(skills.map((value, index) => [`skill_${index + 1}`, Math.max(0, Math.floor(value || 0))]).filter(([, value]) => value > 0));
}

function toStats(side: SimulateSidePayload, opponent: SimulateSidePayload): Record<UnitType, Partial<StatBlock>> {
  return {
    infantry: tupleToStats(side.stats.inf, side, opponent),
    lancer: tupleToStats(side.stats.lanc, side, opponent),
    marksman: tupleToStats(side.stats.mark, side, opponent),
  };
}

function tupleToStats(tuple: [number, number, number, number], side: SimulateSidePayload, opponent: SimulateSidePayload): StatBlock {
  const own = side.stat_modifiers ?? { attack: 0, defense: 0, lethality: 0, health: 0, enemy_attack: 0, enemy_defense: 0 };
  const opp = opponent.stat_modifiers ?? { attack: 0, defense: 0, lethality: 0, health: 0, enemy_attack: 0, enemy_defense: 0 };
  const modifiers = {
    attack: (own.attack ?? 0) + (opp.enemy_attack ?? 0),
    defense: (own.defense ?? 0) + (opp.enemy_defense ?? 0),
    lethality: own.lethality ?? 0,
    health: own.health ?? 0,
  };
  return Object.fromEntries(STAT_KEYS.map((key, index) => [key, tuple[index] * (1 + modifiers[key] / 100)])) as StatBlock;
}
```

- [ ] **Step 5: Write simulation aggregation tests**

Create `dashboard/web/lib/v3-sim/simulate.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import type { BattleResult } from "@v3/types";
import { aggregateBattleResults, signedOutcome } from "./simulate";

function result(attacker: number, defender: number, activations = 0): BattleResult {
  return {
    winner: attacker > defender ? "attacker" : defender > attacker ? "defender" : "draw",
    rounds: 1,
    remaining: {
      attacker: { infantry: attacker, lancer: 0, marksman: 0 },
      defender: { infantry: defender, lancer: 0, marksman: 0 },
    },
    attacks: [],
    skillReport: {
      attacker: [{ sourceKind: "hero_skill", heroName: "Greg", skillId: "S1", skillName: "S1", level: 5, triggersSeen: activations, skillActivations: activations, effectActivations: activations, unsupportedEffects: [] }],
      defender: [],
    },
    resolved: { attacker: { troops: { infantry: 0, lancer: 0, marksman: 0 }, heroes: [], troopSkillIds: [], diagnostics: [] }, defender: { troops: { infantry: 0, lancer: 0, marksman: 0 }, heroes: [], troopSkillIds: [], diagnostics: [] } },
    effectActivationCounts: { attacker: activations, defender: 0 },
    extraSkillAttackJobsByEffect: {},
    attackControlCounts: { dodge: 0, no_attack: 0 },
    randomness: { deterministic: true, chanceSkillIds: { attacker: [], defender: [] } },
  };
}

test("signedOutcome uses positive attacker survivors and negative defender survivors", () => {
  assert.equal(signedOutcome(result(12, 0)), 12);
  assert.equal(signedOutcome(result(0, 9)), -9);
  assert.equal(signedOutcome(result(10, 7)), 3);
});

test("aggregateBattleResults produces SimulateApiResult summary", () => {
  const aggregate = aggregateBattleResults([result(10, 0, 2), result(0, 4, 0)]);
  assert.equal(aggregate.replicates, 2);
  assert.deepEqual(aggregate.outcomes, [10, -4]);
  assert.equal(aggregate.summary.mean, 3);
  assert.equal(aggregate.summary.attacker_win_rate, 0.5);
  assert.equal(aggregate.per_side_skills.attacker[0].name, "S1");
  assert.equal(aggregate.per_side_skills.attacker[0].avg_activations, 1);
});
```

- [ ] **Step 6: Implement `simulate.ts`**

Create `dashboard/web/lib/v3-sim/simulate.ts`:

```ts
import { loadSimulatorConfig, simulateBattle } from "@v3/index";
import type { BattleResult, SimulatorConfig } from "@v3/types";
import type { SimulateApiResult, SimulateRequestPayload, SimulateSkillSummary } from "@/lib/simulate-run";
import { toBattleInput } from "./adapters";

export interface RunSimulationOptions {
  seedBase?: string;
  onProgress?: (done: number, total: number) => void;
  config?: SimulatorConfig;
}

export function runSimulationInV3(request: SimulateRequestPayload, options: RunSimulationOptions = {}): SimulateApiResult {
  const config = options.config ?? loadSimulatorConfig();
  const total = Math.max(1, Math.min(5000, Math.floor(request.replicates || 1)));
  const results: BattleResult[] = [];
  for (let index = 0; index < total; index += 1) {
    results.push(simulateBattle(toBattleInput(request, `${options.seedBase ?? "dashboard"}:${index}`), config));
    if ((index + 1) % Math.max(1, Math.floor(total / 20)) === 0 || index + 1 === total) {
      options.onProgress?.(index + 1, total);
    }
  }
  return aggregateBattleResults(results);
}

export function signedOutcome(result: BattleResult): number {
  const attacker = totalSide(result.remaining.attacker);
  const defender = totalSide(result.remaining.defender);
  if (attacker > 0 && defender === 0) return attacker;
  if (defender > 0 && attacker === 0) return -defender;
  return attacker - defender;
}

export function aggregateBattleResults(results: BattleResult[]): SimulateApiResult {
  const outcomes = results.map(signedOutcome);
  const replicates = Math.max(1, results.length);
  const mean = outcomes.reduce((sum, value) => sum + value, 0) / replicates;
  const variance = outcomes.reduce((sum, value) => sum + (value - mean) ** 2, 0) / replicates;
  const best = Math.max(...outcomes);
  const worst = Math.min(...outcomes);
  const attackerWins = outcomes.filter((value) => value > 0).length;
  const perSide = {
    attacker: aggregateSkills(results, "attacker"),
    defender: aggregateSkills(results, "defender"),
  };
  const avgAttActivations = perSide.attacker.reduce((sum, row) => sum + row.avg_activations, 0);
  const avgDefActivations = perSide.defender.reduce((sum, row) => sum + row.avg_activations, 0);
  const avgAttKills = perSide.attacker.reduce((sum, row) => sum + row.avg_kills, 0);
  const avgDefKills = perSide.defender.reduce((sum, row) => sum + row.avg_kills, 0);
  return {
    replicates,
    summary: {
      mean,
      std: Math.sqrt(variance),
      best: { value: best, winner: winnerFor(best) },
      worst: { value: worst, winner: winnerFor(worst) },
      attacker_win_rate: attackerWins / replicates,
      avg_skill_activations: avgAttActivations + avgDefActivations,
      avg_skill_kills: avgAttKills + avgDefKills,
      avg_attacker_activations: avgAttActivations,
      avg_defender_activations: avgDefActivations,
      avg_attacker_kills: avgAttKills,
      avg_defender_kills: avgDefKills,
    },
    outcomes,
    per_side_skills: perSide,
  };
}

function aggregateSkills(results: BattleResult[], side: "attacker" | "defender"): SimulateSkillSummary[] {
  const totals = new Map<string, { activations: number; kills: number }>();
  for (const result of results) {
    for (const row of result.skillReport[side]) {
      const entry = totals.get(row.skillName) ?? { activations: 0, kills: 0 };
      entry.activations += row.skillActivations;
      entry.kills += result.attacks.filter((attack) => attack.appliedEffects.some((effect) => effect.source.includes(row.skillId))).reduce((sum, attack) => sum + attack.kills, 0);
      totals.set(row.skillName, entry);
    }
  }
  return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => ({
    name,
    avg_activations: value.activations / Math.max(1, results.length),
    avg_kills: value.kills / Math.max(1, results.length),
  }));
}

function totalSide(side: Record<string, number>): number {
  return Object.values(side).reduce((sum, value) => sum + Math.ceil(value), 0);
}

function winnerFor(value: number): "attacker" | "defender" | "draw" {
  if (value > 0) return "attacker";
  if (value < 0) return "defender";
  return "draw";
}
```

- [ ] **Step 7: Run focused dashboard lib tests**

Run:

```bash
npm --prefix dashboard/web test -- lib/v3-sim/*.test.ts
```

Add this script to `dashboard/web/package.json` before running if it is not already present:

```json
"test": "npx --yes tsx --test \"lib/**/*.test.ts\""
```

Then run:

```bash
npm --prefix dashboard/web test -- lib/v3-sim/*.test.ts
```

- [ ] **Step 8: Commit adapter and simulation aggregator**

```bash
git add dashboard/web/tsconfig.json dashboard/web/next.config.ts dashboard/web/package.json dashboard/web/lib/v3-sim/adapters.ts dashboard/web/lib/v3-sim/simulate.ts dashboard/web/lib/v3-sim/adapters.test.ts dashboard/web/lib/v3-sim/simulate.test.ts
git commit -m "Add browser v3 simulation adapter"
```

## Task 3: Port Ratio Optimisation To TypeScript

**Files:**
- Create: `dashboard/web/lib/v3-sim/optimise.ts`
- Create: `dashboard/web/lib/v3-sim/optimise.test.ts`

- [ ] **Step 1: Write optimiser helper tests**

Create `dashboard/web/lib/v3-sim/optimise.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { compositionGrid, countsForPercentages, rankOptimizeRows, wilsonLowerBound } from "./optimise";

test("countsForPercentages preserves total troops", () => {
  assert.deepEqual(countsForPercentages(101, 30, 30), [30, 30, 41]);
});

test("compositionGrid respects infantry bounds and step", () => {
  assert.deepEqual([...compositionGrid(10, 5, 50, 100)], [
    [5, 0, 5],
    [5, 5, 0],
    [10, 0, 0],
  ]);
});

test("wilsonLowerBound keeps one lucky win below certainty", () => {
  assert.ok(wilsonLowerBound(1, 1) < 0.5);
});

test("rankOptimizeRows sorts by win rate then margin", () => {
  const ranked = rankOptimizeRows([
    { win_rate: 0.5, avg_margin: 10, avg_attacker_left: 5, avg_defender_left: 0 },
    { win_rate: 0.5, avg_margin: 20, avg_attacker_left: 2, avg_defender_left: 0 },
  ], "attacker");
  assert.equal(ranked[0].avg_margin, 20);
});
```

- [ ] **Step 2: Implement optimiser constants and pure helpers**

Create `dashboard/web/lib/v3-sim/optimise.ts` with exported helpers matching the Python constants:

```ts
import type { OptimizeRatioRequestPayload } from "@/lib/simulate-run";
import { MAX_OPTIMIZE_BATTLES, MAX_OPTIMIZE_COMPOSITIONS, type OptimizeRatioPoint, type OptimizeRatioResult } from "@/lib/optimize-ratio";
import type { SimulatorConfig } from "@v3/types";
import { loadSimulatorConfig, simulateBattle } from "@v3/index";
import { toBattleInput } from "./adapters";

const ADAPTIVE_PHASE1_REPLICATES = 30;
const ADAPTIVE_PHASE2_REPLICATES = 10;
const ADAPTIVE_FINAL_REPLICATES = 100;
const ADAPTIVE_MAX_PHASE2_SEEDS = 20;

export function* compositionGrid(total: number, step: number, infantryMinPct: number, infantryMaxPct: number): Iterable<[number, number, number]> {
  const start = Math.ceil(Math.ceil((total * infantryMinPct) / 100) / step) * step;
  const end = Math.floor(Math.floor((total * infantryMaxPct) / 100) / step) * step;
  for (let infantry = start; infantry <= end; infantry += step) {
    const remaining = total - infantry;
    for (let lancer = 0; lancer <= remaining; lancer += step) {
      yield [infantry, lancer, total - infantry - lancer];
    }
  }
}

export function countsForPercentages(total: number, infantryPct: number, lancerPct: number): [number, number, number] {
  const marksmanPct = 100 - infantryPct - lancerPct;
  const raw = [(total * infantryPct) / 100, (total * lancerPct) / 100, (total * marksmanPct) / 100];
  const counts = raw.map(Math.floor);
  let remainder = total - counts.reduce((sum, value) => sum + value, 0);
  const order = raw.map((value, index) => ({ index, frac: value - counts[index] })).sort((a, b) => b.frac - a.frac || a.index - b.index);
  for (const row of order) {
    if (remainder <= 0) break;
    counts[row.index] += 1;
    remainder -= 1;
  }
  return [counts[0], counts[1], counts[2]];
}

export function wilsonLowerBound(wins: number, n: number): number {
  const z = 1.96;
  const p = wins / Math.max(1, n);
  const denominator = 1 + (z * z) / Math.max(1, n);
  const centre = p + (z * z) / (2 * Math.max(1, n));
  const spread = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * Math.max(1, n))) / Math.max(1, n));
  return (centre - spread) / denominator;
}
```

- [ ] **Step 3: Implement composition evaluation**

Add to `optimise.ts`:

```ts
function evaluateComposition(
  request: OptimizeRatioRequestPayload,
  composition: [number, number, number],
  phaseReplicates: number,
  config: SimulatorConfig,
  seedBase: string
): OptimizeRatioPoint {
  const optimizeSide = request.optimize_side ?? "attacker";
  const candidate: OptimizeRatioRequestPayload = structuredClone(request);
  const side = optimizeSide === "defender" ? candidate.defender : candidate.attacker;
  side.troops = { infantry: composition[0], lancer: composition[1], marksman: composition[2] };
  let wins = 0;
  const outcomes: number[] = [];
  let totalAttackerLeft = 0;
  let totalDefenderLeft = 0;
  for (let index = 0; index < phaseReplicates; index += 1) {
    const result = simulateBattle(toBattleInput(candidate, `${seedBase}:${composition.join("-")}:${index}`), config);
    const attackerLeft = totalSide(result.remaining.attacker);
    const defenderLeft = totalSide(result.remaining.defender);
    const margin = optimizeSide === "attacker" ? attackerLeft - defenderLeft : defenderLeft - attackerLeft;
    outcomes.push(margin);
    totalAttackerLeft += attackerLeft;
    totalDefenderLeft += defenderLeft;
    if (margin > 0) wins += 1;
  }
  const total = Math.max(1, composition[0] + composition[1] + composition[2]);
  const avgMargin = mean(outcomes);
  const marginStd = sampleStd(outcomes);
  const winRate = wins / Math.max(1, phaseReplicates);
  return {
    infantry_count: composition[0],
    lancer_count: composition[1],
    marksman_count: composition[2],
    infantry_pct: (composition[0] / total) * 100,
    lancer_pct: (composition[1] / total) * 100,
    marksman_pct: (composition[2] / total) * 100,
    win_rate: winRate,
    win_rate_pct: winRate * 100,
    avg_margin: avgMargin,
    margin_std: marginStd,
    conservative_win_rate: wilsonLowerBound(wins, phaseReplicates),
    conservative_win_rate_pct: wilsonLowerBound(wins, phaseReplicates) * 100,
    conservative_margin: avgMargin - 1.96 * (marginStd / Math.sqrt(Math.max(1, phaseReplicates))),
    avg_attacker_left: totalAttackerLeft / Math.max(1, phaseReplicates),
    avg_defender_left: totalDefenderLeft / Math.max(1, phaseReplicates),
  };
}
```

Add `mean`, `sampleStd`, and `totalSide` helpers in the same file.

- [ ] **Step 4: Implement grid mode**

Add:

```ts
export function runOptimizeRatioInV3(
  request: OptimizeRatioRequestPayload,
  options: { config?: SimulatorConfig; seedBase?: string; onProgress?: (done: number, total: number) => void } = {}
): OptimizeRatioResult {
  const config = options.config ?? loadSimulatorConfig();
  const optimizeSide = request.optimize_side ?? "attacker";
  const optimized = optimizeSide === "defender" ? request.defender : request.attacker;
  const total = optimized.troops.infantry + optimized.troops.lancer + optimized.troops.marksman;
  if (total <= 0) throw new Error(`${optimizeSide === "defender" ? "Defender" : "Attacker"} must have at least one troop to optimize a ratio.`);
  if (request.infantry_min_pct > request.infantry_max_pct) throw new Error("Infantry max % must be greater than or equal to infantry min %.");
  return (request.search_mode ?? "adaptive") === "grid"
    ? runGridOptimize(request, total, config, options)
    : runAdaptiveOptimize(request, total, config, options);
}
```

Implement `runGridOptimize()` with `compositionGrid()`, budget checks using `MAX_OPTIMIZE_COMPOSITIONS` and `MAX_OPTIMIZE_BATTLES`, per-composition progress, phase tag `"grid"`, `replicates_per_ratio` equal to `request.search_replicates`, and `phase_counts: { grid: compositionCount }`.

- [ ] **Step 5: Implement adaptive mode**

Implement `runAdaptiveOptimize()` to mirror Python:

1. build 5% percentage grid inside infantry bounds
2. evaluate phase 1 with 30 replicates and tag `coarse`
3. take top 10 by normal rank and top 10 by margin
4. create local neighbours with `inf_delta` and `lanc_delta` from `-3` through `3`
5. evaluate phase 2 with 10 replicates and tag `local`
6. take top 20 by conservative win and top 20 by conservative margin
7. rerun finalists with 100 replicates and tag `finalist`
8. choose best from finalist results

The returned result must set:

```ts
phase_counts: {
  phase1: phase1Compositions.length,
  phase2: phase2Candidates.length,
  finalists: finalists.length,
}
```

- [ ] **Step 6: Run optimiser tests**

Run:

```bash
npm --prefix dashboard/web test -- lib/v3-sim/optimise.test.ts
```

Expected: all helper tests pass.

- [ ] **Step 7: Commit optimiser port**

```bash
git add dashboard/web/lib/v3-sim/optimise.ts dashboard/web/lib/v3-sim/optimise.test.ts
git commit -m "Port ratio optimisation to browser v3"
```

## Task 4: Add Browser Worker Protocol And Client Wrapper

**Files:**
- Create: `dashboard/web/lib/v3-sim/worker-protocol.ts`
- Create: `dashboard/web/app/simulate/simulate.worker.ts`
- Create: `dashboard/web/lib/v3-sim/worker-client.ts`

- [ ] **Step 1: Create worker protocol types**

Create `dashboard/web/lib/v3-sim/worker-protocol.ts`:

```ts
import type { OptimizeRatioRequestPayload, OptimizeRatioResult, SimulateApiResult, SimulateRequestPayload } from "@/lib/simulate-run";

export type V3WorkerRequest =
  | { id: number; type: "simulate"; payload: SimulateRequestPayload }
  | { id: number; type: "optimizeRatio"; payload: OptimizeRatioRequestPayload }
  | { id: number; type: "cancel" };

export type V3WorkerResponse =
  | { id: number; type: "progress"; done: number; total: number }
  | { id: number; type: "simulateResult"; data: SimulateApiResult }
  | { id: number; type: "optimizeResult"; data: OptimizeRatioResult }
  | { id: number; type: "error"; message: string };
```

- [ ] **Step 2: Create worker entrypoint**

Create `dashboard/web/app/simulate/simulate.worker.ts`:

```ts
import { runOptimizeRatioInV3 } from "@/lib/v3-sim/optimise";
import { runSimulationInV3 } from "@/lib/v3-sim/simulate";
import type { V3WorkerRequest, V3WorkerResponse } from "@/lib/v3-sim/worker-protocol";

let activeJobId: number | null = null;

self.onmessage = (event: MessageEvent<V3WorkerRequest>) => {
  const request = event.data;
  if (request.type === "cancel") {
    if (activeJobId === request.id) activeJobId = null;
    return;
  }
  activeJobId = request.id;
  try {
    if (request.type === "simulate") {
      const data = runSimulationInV3(request.payload, {
        seedBase: `simulate:${request.id}`,
        onProgress: (done, total) => postIfActive(request.id, { id: request.id, type: "progress", done, total }),
      });
      postIfActive(request.id, { id: request.id, type: "simulateResult", data });
    } else {
      const data = runOptimizeRatioInV3(request.payload, {
        seedBase: `optimize:${request.id}`,
        onProgress: (done, total) => postIfActive(request.id, { id: request.id, type: "progress", done, total }),
      });
      postIfActive(request.id, { id: request.id, type: "optimizeResult", data });
    }
  } catch (error) {
    postIfActive(request.id, { id: request.id, type: "error", message: error instanceof Error ? error.message : String(error) });
  } finally {
    if (activeJobId === request.id) activeJobId = null;
  }
};

function postIfActive(id: number, message: V3WorkerResponse): void {
  if (activeJobId !== id) return;
  self.postMessage(message);
}
```

- [ ] **Step 3: Create React-side worker wrapper**

Create `dashboard/web/lib/v3-sim/worker-client.ts`:

```ts
import type { OptimizeRatioRequestPayload, OptimizeRatioResult, SimulateApiResult, SimulateRequestPayload } from "@/lib/simulate-run";
import type { V3WorkerRequest, V3WorkerResponse } from "./worker-protocol";

let nextJobId = 1;

export function runWorkerSimulation(
  payload: SimulateRequestPayload,
  onProgress: (done: number, total: number) => void
): { promise: Promise<SimulateApiResult>; cancel: () => void } {
  return runWorkerJob<SimulateApiResult>({ type: "simulate", payload }, "simulateResult", onProgress);
}

export function runWorkerOptimizeRatio(
  payload: OptimizeRatioRequestPayload,
  onProgress: (done: number, total: number) => void
): { promise: Promise<OptimizeRatioResult>; cancel: () => void } {
  return runWorkerJob<OptimizeRatioResult>({ type: "optimizeRatio", payload }, "optimizeResult", onProgress);
}

function runWorkerJob<T>(
  request: Omit<Extract<V3WorkerRequest, { type: "simulate" | "optimizeRatio" }>, "id">,
  resultType: V3WorkerResponse["type"],
  onProgress: (done: number, total: number) => void
): { promise: Promise<T>; cancel: () => void } {
  const id = nextJobId++;
  const worker = new Worker(new URL("../../app/simulate/simulate.worker.ts", import.meta.url), { type: "module" });
  const promise = new Promise<T>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<V3WorkerResponse>) => {
      const message = event.data;
      if (message.id !== id) return;
      if (message.type === "progress") onProgress(message.done, message.total);
      else if (message.type === resultType && "data" in message) resolve(message.data as T);
      else if (message.type === "error") reject(new Error(message.message));
    };
    worker.onerror = (event) => reject(new Error(event.message));
    worker.postMessage({ id, ...request } satisfies V3WorkerRequest);
  }).finally(() => worker.terminate());
  return {
    promise,
    cancel() {
      worker.postMessage({ id, type: "cancel" } satisfies V3WorkerRequest);
      worker.terminate();
    },
  };
}
```

- [ ] **Step 4: Run Next build smoke**

Run:

```bash
npm --prefix dashboard/web run build
```

Expected: Next compiles the worker and v3 imports without module resolution errors.

- [ ] **Step 5: Commit worker plumbing**

```bash
git add dashboard/web/app/simulate/simulate.worker.ts dashboard/web/lib/v3-sim/worker-protocol.ts dashboard/web/lib/v3-sim/worker-client.ts
git commit -m "Add browser worker for v3 simulation jobs"
```

## Task 5: Add Save-Only Simulation Run API

**Files:**
- Modify: `dashboard/web/app/api/simulate/runs/route.ts`
- Create: `dashboard/web/tests/simulation-runs-api.spec.ts`

- [ ] **Step 1: Add POST route handler**

In `dashboard/web/app/api/simulate/runs/route.ts`, import save helpers:

```ts
import { saveSimulationRun } from "@/lib/simulation-store";
import type { SavedSimulationKind, SavedSimulationRequest, SavedSimulationResult } from "@/lib/simulate-run";
```

Add:

```ts
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      kind?: SavedSimulationKind;
      request?: SavedSimulationRequest;
      result?: SavedSimulationResult;
    };
    if (body.kind !== "simulate" && body.kind !== "optimize_ratio") {
      return NextResponse.json({ error: "kind must be simulate or optimize_ratio" }, { status: 400 });
    }
    if (!body.request || typeof body.request !== "object") {
      return NextResponse.json({ error: "request is required" }, { status: 400 });
    }
    if (!body.result || typeof body.result !== "object") {
      return NextResponse.json({ error: "result is required" }, { status: 400 });
    }
    const saved = await saveSimulationRun(body.kind, body.request, body.result);
    return NextResponse.json({
      saved_run_id: saved.id,
      saved_at: saved.created_at,
      saved_kind: saved.kind,
      share_url: saved.share_url,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 2: Add API test**

Create `dashboard/web/tests/simulation-runs-api.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("POST /api/simulate/runs saves a computed simulation result", async ({ request }) => {
  const response = await request.post("/api/simulate/runs", {
    data: {
      kind: "simulate",
      request: {
        attacker: { troops: { infantry: 1, lancer: 0, marksman: 0 }, troop_types: { infantry: "infantry_t6", lancer: "lancer_t6", marksman: "marksman_t6" }, heroes: {}, joiners: [], stats: { inf: [100, 100, 100, 100], lanc: [100, 100, 100, 100], mark: [100, 100, 100, 100] } },
        defender: { troops: { infantry: 1, lancer: 0, marksman: 0 }, troop_types: { infantry: "infantry_t6", lancer: "lancer_t6", marksman: "marksman_t6" }, heroes: {}, joiners: [], stats: { inf: [100, 100, 100, 100], lanc: [100, 100, 100, 100], mark: [100, 100, 100, 100] } },
        replicates: 1,
        rally_mode: false,
      },
      result: { replicates: 1, summary: { mean: 0, std: 0, best: { value: 0, winner: "draw" }, worst: { value: 0, winner: "draw" }, attacker_win_rate: 0, avg_skill_activations: 0, avg_skill_kills: 0, avg_attacker_activations: 0, avg_defender_activations: 0, avg_attacker_kills: 0, avg_defender_kills: 0 }, outcomes: [0], per_side_skills: { attacker: [], defender: [] } },
    },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.saved_kind).toBe("simulate");
  expect(body.share_url).toMatch(/^\/simulate\?run=/);
});
```

- [ ] **Step 3: Run API test**

Run:

```bash
npm --prefix dashboard/web run build
npm --prefix dashboard/web exec playwright test tests/simulation-runs-api.spec.ts
```

Expected: build passes and API test passes.

- [ ] **Step 4: Commit save-only API**

```bash
git add dashboard/web/app/api/simulate/runs/route.ts dashboard/web/tests/simulation-runs-api.spec.ts
git commit -m "Add save-only simulation run API"
```

## Task 6: Wire SimulateClient To Worker And Save API

**Files:**
- Modify: `dashboard/web/app/simulate/SimulateClient.tsx`

- [ ] **Step 1: Import worker client helpers**

Add:

```ts
import { runWorkerOptimizeRatio, runWorkerSimulation } from "@/lib/v3-sim/worker-client";
```

- [ ] **Step 2: Add save helper in component**

Inside `SimulateClient`, add:

```ts
async function saveComputedRun(
  kind: SavedSimulationKind,
  request: SimulateRequestPayload | OptimizeRatioRequestPayload,
  computedResult: SimulateApiResponse | OptimizeRatioApiResponse,
): Promise<SaveMetaPayload | null> {
  const res = await fetch("/api/simulate/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, request, result: computedResult }),
  });
  const data = (await res.json()) as SaveMetaPayload | { error?: string };
  if (!res.ok) {
    throw new Error(("error" in data && data.error) || `Saved run request failed with ${res.status}`);
  }
  return data as SaveMetaPayload;
}
```

- [ ] **Step 3: Replace `runSimulation()` fetch logic**

Keep payload creation and state reset. Replace the `/api/simulate` fetch/NDJSON loop with:

```ts
const job = runWorkerSimulation(payload, (done, total) => setSimulateProgress({ done, total }));
const computed = await job.promise;
setResult(computed);
try {
  const saveMeta = await saveComputedRun("simulate", payload, computed);
  if (saveMeta) maybeActivateSavedRun(saveMeta, payload);
} catch (saveErr) {
  setSavedRunError(saveErr instanceof Error ? saveErr.message : "Simulation completed but failed to save");
}
```

Remove `handleSimulateEvent()` after no call sites remain.

- [ ] **Step 4: Replace `runOptimizeRatio()` fetch logic**

Keep payload creation and validation. Replace the `/api/simulate/optimize-ratio` fetch/NDJSON loop with:

```ts
const job = runWorkerOptimizeRatio(payload, (done, total) => setOptimizeProgress({ done, total }));
const computed = await job.promise;
setOptimizeResult(computed);
try {
  const saveMeta = await saveComputedRun("optimize_ratio", payload, computed);
  if (saveMeta) maybeActivateSavedRun(saveMeta, payload);
} catch (saveErr) {
  setSavedRunError(saveErr instanceof Error ? saveErr.message : "Ratio search completed but failed to save");
}
```

Remove `handleOptimizeEvent()` after no call sites remain.

- [ ] **Step 5: Remove pending request refs only used by old stream handlers**

Delete:

```ts
const pendingSimulateRequestRef = useRef<SimulateRequestPayload | null>(null);
const pendingOptimizeRequestRef = useRef<OptimizeRatioRequestPayload | null>(null);
```

Delete assignments to those refs inside `runSimulation()` and `runOptimizeRatio()`.

- [ ] **Step 6: Run TypeScript/build verification**

Run:

```bash
npm --prefix dashboard/web run build
```

Expected: build passes and worker import resolves.

- [ ] **Step 7: Commit UI worker integration**

```bash
git add dashboard/web/app/simulate/SimulateClient.tsx
git commit -m "Run simulate page calculations in browser worker"
```

## Task 7: Update Playwright Coverage For No Compute API Calls

**Files:**
- Modify: `dashboard/web/tests/smoke.spec.ts`
- Create: `dashboard/web/tests/browser-v3-simulate.spec.ts`

- [ ] **Step 1: Remove old compute API mocks from simulate tests**

In `dashboard/web/tests/smoke.spec.ts`, replace tests that mock:

```ts
page.route("**/api/simulate", ...)
page.route("**/api/simulate/optimize-ratio", ...)
```

with tests that either:

- rely on the browser worker result directly, or
- mock only `POST /api/simulate/runs` for save metadata.

- [ ] **Step 2: Add explicit no-compute-API test**

Create `dashboard/web/tests/browser-v3-simulate.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("/simulate uses browser worker for simulation and saves afterward", async ({ page }) => {
  const forbidden: string[] = [];
  await page.route("**/api/simulate", async (route) => {
    forbidden.push(route.request().url());
    await route.abort();
  });
  await page.route("**/api/simulate/optimize-ratio", async (route) => {
    forbidden.push(route.request().url());
    await route.abort();
  });
  await page.route("**/api/simulate/runs", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ saved_run_id: "browser-sim", saved_at: "2026-05-22T00:00:00.000Z", saved_kind: "simulate", share_url: "/simulate?run=browser-sim" }),
      });
      return;
    }
    await route.continue();
  });
  await page.goto("/simulate");
  await page.getByRole("spinbutton", { name: /replicates/i }).fill("1");
  await page.getByRole("button", { name: /^Simulate$/i }).click();
  await expect(page.getByTestId("simulate-outcome-chart")).toBeVisible();
  expect(forbidden).toEqual([]);
});
```

- [ ] **Step 3: Add optimise no-compute-API test**

Append:

```ts
test("/simulate uses browser worker for optimise ratio and saves afterward", async ({ page }) => {
  const forbidden: string[] = [];
  await page.route("**/api/simulate", async (route) => {
    forbidden.push(route.request().url());
    await route.abort();
  });
  await page.route("**/api/simulate/optimize-ratio", async (route) => {
    forbidden.push(route.request().url());
    await route.abort();
  });
  await page.route("**/api/simulate/runs", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ saved_run_id: "browser-opt", saved_at: "2026-05-22T00:00:00.000Z", saved_kind: "optimize_ratio", share_url: "/simulate?run=browser-opt" }),
      });
      return;
    }
    await route.continue();
  });
  await page.goto("/simulate");
  await page.getByRole("button", { name: /optimise ratio/i }).click();
  await expect(page.getByTestId("optimize-results")).toBeVisible();
  expect(forbidden).toEqual([]);
});
```

If current markup lacks `data-testid="optimize-results"`, add that test id to the optimiser results container in `SimulateClient.tsx`.

- [ ] **Step 4: Run targeted Playwright tests**

Run:

```bash
npm --prefix dashboard/web run build
npm --prefix dashboard/web exec playwright test tests/browser-v3-simulate.spec.ts
```

Expected: both tests pass without hitting the old compute routes.

- [ ] **Step 5: Commit Playwright updates**

```bash
git add dashboard/web/tests/smoke.spec.ts dashboard/web/tests/browser-v3-simulate.spec.ts dashboard/web/app/simulate/SimulateClient.tsx
git commit -m "Cover browser-side simulate calculations"
```

## Task 8: Update Documentation And Remove Old Compute Route Reliance

**Files:**
- Modify: `README_DASHBOARD.md`
- Modify: `dashboard/web/README.md`
- Modify: `docs/wos-sim-production-deployment.md`
- Optional Modify: `dashboard/web/app/api/simulate/route.ts`
- Optional Modify: `dashboard/web/app/api/simulate/optimize-ratio/route.ts`

- [ ] **Step 1: Update dashboard README wording**

In `README_DASHBOARD.md`, replace the current wording that says `/simulate` spawns Python with:

```md
- The `/simulate` page runs battle simulation and ratio optimisation in a browser Web Worker using the v3 TypeScript simulator.
- Saved `/simulate` share links, recent runs, stat presets, and OCR upload remain server-backed.
- OCR/report upload still needs the Python/OCR runtime where that route is enabled.
```

- [ ] **Step 2: Update web README**

In `dashboard/web/README.md`, add:

```md
The Simulate and Optimise Ratio buttons do not call server compute routes. They run v3 TypeScript calculations in a browser worker, then POST completed results to `/api/simulate/runs` for share-link persistence.
```

- [ ] **Step 3: Update production deployment spec**

In `docs/wos-sim-production-deployment.md`, replace public compute route language for `/api/simulate` and `/api/simulate/optimize-ratio` with:

```md
Public simulate APIs are limited to saved-run persistence/loading, stat presets, and OCR upload. Browser-side v3 workers handle battle and ratio calculations.
```

- [ ] **Step 4: Decide old compute route behavior**

Keep `dashboard/web/app/api/simulate/route.ts` and `dashboard/web/app/api/simulate/optimize-ratio/route.ts` for one release as deprecated fallback endpoints, but remove them from public navigation/docs. Add a response header to both:

```ts
"X-WOS-Deprecated": "browser-v3-worker"
```

Do not delete these routes until Playwright and production smoke tests have passed with browser-side calculation.

- [ ] **Step 5: Run documentation grep**

Run:

```bash
rg -n "spawns .*simulate_battle|optimize_ratio.py|/api/simulate/optimize-ratio|/api/simulate route spawns|Python.*simulate" README_DASHBOARD.md dashboard/web/README.md docs/wos-sim-production-deployment.md docker-compose*.yml
```

Expected: remaining matches either document OCR/Python correctly or identify deprecated fallback routes explicitly.

- [ ] **Step 6: Commit docs**

```bash
git add README_DASHBOARD.md dashboard/web/README.md docs/wos-sim-production-deployment.md dashboard/web/app/api/simulate/route.ts dashboard/web/app/api/simulate/optimize-ratio/route.ts
git commit -m "Document browser-side v3 simulate execution"
```

## Task 9: Full Verification And Completion

**Files:**
- No required edits unless verification exposes failures.

- [ ] **Step 1: Run v3 verification**

```bash
npm --prefix v3 test
npm --prefix v3 run typecheck
```

Expected: all v3 tests and typecheck pass.

- [ ] **Step 2: Run dashboard unit/build verification**

```bash
npm --prefix dashboard/web test
npm --prefix dashboard/web run build
```

Expected: dashboard lib tests and build pass.

- [ ] **Step 3: Run dashboard Playwright smoke**

```bash
npm --prefix dashboard/web exec playwright test
```

Expected: all Playwright tests pass. In particular, `/simulate` tests must not mock or rely on `/api/simulate` or `/api/simulate/optimize-ratio` for calculation.

- [ ] **Step 4: Manual browser smoke**

Start the dashboard:

```bash
npm --prefix dashboard/web run dev
```

Open `http://localhost:3000/simulate` and verify:

- clicking `Simulate` shows progress and results
- clicking `Optimise ratio` shows progress and results
- applying best ratio updates the selected side's troop counts
- a saved-run URL is pushed after a successful save
- refreshing a saved-run URL hydrates request and result from the server
- upload/report and stat preset flows still call their existing APIs

- [ ] **Step 5: Check final diff**

```bash
git status --short
git log --oneline -8
```

Expected: only intentional files are changed, and all implementation commits are present.
