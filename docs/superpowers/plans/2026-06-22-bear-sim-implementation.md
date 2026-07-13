# Bear Sim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/bear` page that runs and optimises 10-round uncapped bear score simulations from one player army.

**Architecture:** Add a simulator-core bear battle entry point that reuses normal fighter resolution, skill triggers, target selection, damage math, recorder output, and trace shape, but skips defender kill caps and defender loss commits for bear scoring. Add dashboard bear request/result adapters and worker messages, then build a Bear Sim page by reusing/extracting simulator form, chart, trace, preset, and optimise UI behavior where practical.

**Tech Stack:** TypeScript, Node test runner, Next.js App Router, web workers, existing WOS simulator core.

---

### Task 1: Simulator Bear Battle Core

**Files:**
- Modify: `simulator/src/types.ts`
- Modify: `simulator/src/simulator.ts`
- Modify: `simulator/src/index.ts`
- Test: `simulator/src/simulator.test.ts`

- [ ] **Step 1: Write failing tests for fixed 10 rounds and uncapped bear score**

Add tests near the existing simulator tests:

```ts
test("simulateBearBattle runs exactly 10 rounds and leaves the bear army unchanged", () => {
  const input: BattleInput = {
    attacker: {
      troops: { infantry_t6: 100 },
      stats: {
        infantry: { attack: 100, defense: 100, lethality: 100, health: 100 },
      },
    },
    defender: {
      troops: {},
    },
    seed: "bear-fixed",
  };

  const result = simulateBearBattle(input.attacker, minimalConfig(), "bear-fixed");

  assert.equal(result.rounds, 10);
  assert.equal(result.remaining.defender.infantry, 5000);
  assert.equal(result.remaining.defender.lancer, 0);
  assert.equal(result.remaining.defender.marksman, 0);
  assert.ok(result.score > 5000);
});
```

Add a second test for rally-only effects:

```ts
test("simulateBearBattle always resolves the player army as a rally attacker", () => {
  const config = sameEffectStackingConfig("RallyHero", "add", "active.hero.lethality.up");
  config.heroDefinitions.RallyHero.skills[0].requirements = [
    { type: "engagement", value: "rally" },
  ];
  const player: FighterInput = {
    troops: { marksman_t6: 100 },
    stats: {
      marksman: { attack: 100, defense: 100, lethality: 100, health: 100 },
    },
    heroes: { RallyHero: { skill_1: 1 } },
  };

  const result = simulateBearBattle(player, config, "bear-rally");

  assert.ok(result.skillReport.attacker.some((row) => row.skillName === "RallyHero"));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd simulator && npx --yes tsx --test src/simulator.test.ts --test-name-pattern "simulateBearBattle"`

Expected: FAIL because `simulateBearBattle` is not exported.

- [ ] **Step 3: Add bear result types and exported function**

Add to `simulator/src/types.ts`:

```ts
export interface BearBattleResult extends BattleResult {
  score: number;
}
```

Add to `simulator/src/simulator.ts`:

```ts
const BEAR_ROUNDS = 10;
const BEAR_DEFENSE = 100;

export function bearFighterInput(): FighterInput {
  return {
    troops: { infantry_t1: 5000 },
    stats: {
      infantry: { attack: 0, defense: BEAR_DEFENSE, lethality: 0, health: 10 },
      lancer: { attack: 0, defense: BEAR_DEFENSE, lethality: 0, health: 10 },
      marksman: { attack: 0, defense: BEAR_DEFENSE, lethality: 0, health: 10 },
    },
  };
}

export function simulateBearBattle(
  player: FighterInput,
  config: SimulatorConfig,
  seed: string | number = "bear-default",
  options: SimulationOptions = {},
): BearBattleResult {
  const input: BattleInput = {
    attacker: player,
    defender: bearFighterInput(),
    seed,
    maxRounds: BEAR_ROUNDS,
    engagement_type: "rally",
  };
  const run = runBattle(input, config, options);
  return { ...buildBattleResult(run), score: bearScore(run.attacks) };
}
```

Add helper:

```ts
function bearScore(attacks: AttackOutcome[]): number {
  return attacks
    .filter((attack) => attack.attackerSide === "attacker" && attack.defenderSide === "defender")
    .reduce((sum, attack) => sum + attack.kills, 0);
}
```

Add export in `simulator/src/index.ts`:

```ts
export { simulateBearBattle, bearFighterInput, prepareBattle, runPrepared, signedRemainingScore } from "./simulator";
```

- [ ] **Step 4: Change the loop to support bear score semantics**

Refactor `runLoop` through an internal options object:

```ts
interface RunLoopOptions {
  capRoundKills: boolean;
  commitLosses: boolean;
}
```

Normal battle calls `runLoop(..., { capRoundKills: true, commitLosses: true })`.
Bear battle calls `runLoop(..., { capRoundKills: false, commitLosses: false })`.

Inside the loop:

```ts
if (loopOptions.capRoundKills) capRoundKills(results, roundStartTroops);
if (loopOptions.commitLosses) commitRound(cancelled, results, fighters, runtime);
else commitRoundCounters(cancelled, results, runtime);
```

Extract counter updates from `commitRound` into `commitRoundCounters` and keep the normal loss application in `commitRound`.

- [ ] **Step 5: Run simulator bear tests**

Run: `cd simulator && npx --yes tsx --test src/simulator.test.ts --test-name-pattern "simulateBearBattle"`

Expected: PASS.

### Task 2: Dashboard Bear Simulation Library and Worker

**Files:**
- Modify: `dashboard/web/lib/simulate-run.ts`
- Create: `dashboard/web/lib/simulator/bear.ts`
- Modify: `dashboard/web/lib/simulator/worker-protocol.ts`
- Modify: `dashboard/web/lib/simulator/worker-client.ts`
- Modify: `dashboard/web/app/simulate/simulate.worker.ts`
- Test: `dashboard/web/lib/simulator/bear.test.ts`

- [ ] **Step 1: Write failing bear library tests**

Create `dashboard/web/lib/simulator/bear.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { BearBattleResult } from "@simulator/types";
import type { BearSimRequestPayload } from "@/lib/simulate-run";
import { aggregateBearResults, toBearBattlePlayerInput } from "./bear";

const request: BearSimRequestPayload = {
  player: {
    troops: { infantry: 100, lancer: 50, marksman: 25 },
    troop_types: { infantry: "infantry_t6", lancer: "lancer_t6", marksman: "marksman_t6" },
    heroes: {
      infantry: { name: null, skills: [0, 0, 0, 0] },
      lancer: { name: null, skills: [0, 0, 0, 0] },
      marksman: { name: null, skills: [0, 0, 0, 0] },
    },
    joiners: [],
    stats: { inf: [100, 101, 102, 103], lanc: [110, 111, 112, 113], mark: [120, 121, 122, 123] },
  },
  replicates: 2,
};

test("toBearBattlePlayerInput maps one dashboard side to simulator fighter input", () => {
  const fighter = toBearBattlePlayerInput(request);
  assert.deepEqual(fighter.troops, { infantry_t6: 100, lancer_t6: 50, marksman_t6: 25 });
  assert.equal(fighter.stats?.infantry?.defense, 101);
});

test("aggregateBearResults summarizes bear scores and per-seed runs", () => {
  const sample = (score: number): BearBattleResult => ({
    score,
    winner: "draw",
    rounds: 10,
    remaining: { attacker: { infantry: 0, lancer: 0, marksman: 0 }, defender: { infantry: 5000, lancer: 0, marksman: 0 } },
    attacks: [],
    skillReport: { attacker: [], defender: [] },
    resolved: { attacker: { troops: { infantry: 0, lancer: 0, marksman: 0 }, heroes: [], troopSkillIds: [], diagnostics: [] }, defender: { troops: { infantry: 5000, lancer: 0, marksman: 0 }, heroes: [], troopSkillIds: [], diagnostics: [] } },
    effectActivationCounts: { attacker: 0, defender: 0 },
    extraSkillAttackJobsByEffect: {},
    attackControlCounts: { dodge: 0, no_attack: 0 },
    randomness: { deterministic: true, chanceSkillIds: { attacker: [], defender: [] } },
  });

  const result = aggregateBearResults([sample(10), sample(20)], ["a", "b"]);

  assert.equal(result.summary.mean, 15);
  assert.deepEqual(result.score_runs, [{ score: 10, seed: "a" }, { score: 20, seed: "b" }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dashboard/web && npx --yes tsx --test lib/simulator/bear.test.ts`

Expected: FAIL because `./bear` does not exist.

- [ ] **Step 3: Add bear payload/result types**

Add to `dashboard/web/lib/simulate-run.ts`:

```ts
export interface BearSimRequestPayload {
  player: SimulateSidePayload;
  replicates: number;
  trace_seed?: number;
}

export interface BearScoreRun {
  score: number;
  seed: string | number;
}

export interface BearSimResult {
  replicates: number;
  summary: {
    mean: number;
    std: number;
    best: { value: number };
    worst: { value: number };
    avg_skill_activations: number;
    avg_skill_damage: number;
  };
  scores: number[];
  score_runs?: BearScoreRun[];
  trace?: SimulateTrace;
  skills: SimulateSkillSummary[];
}
```

- [ ] **Step 4: Implement `dashboard/web/lib/simulator/bear.ts`**

Implement:

```ts
export function toBearBattlePlayerInput(request: BearSimRequestPayload): FighterInput;
export function runBearSimulation(request: BearSimRequestPayload, options?: BearSimulationOptions): BearSimResult;
export function runBearSimulationTrace(request: BearSimRequestPayload, seed: string | number, options?: BearSimulationOptions): SimulateTrace;
export function aggregateBearResults(results: BearBattleResult[], seeds?: (string | number)[]): BearSimResult;
```

Reuse `simulateBearBattle`, `loadSimulatorConfig`, `battleResultToTrace`, and the same side conversion rules as `toBattleInput`.

- [ ] **Step 5: Wire worker messages**

Add worker request/response variants:

```ts
| { id: number; type: "bearSim"; payload: BearSimRequestPayload }
| { id: number; type: "bearTrace"; payload: BearSimRequestPayload; seed: string | number }
| { id: number; type: "bearResult"; data: BearSimResult }
| { id: number; type: "bearTraceResult"; data: SimulateTrace }
```

Add client helpers:

```ts
export function runWorkerBearSimulation(
  payload: BearSimRequestPayload,
  onProgress: (done: number, total: number) => void,
): { promise: Promise<BearSimResult>; cancel: () => void }

export function runWorkerBearSimulationTrace(
  payload: BearSimRequestPayload,
  seed: string | number,
  onProgress: (done: number, total: number) => void,
): { promise: Promise<SimulateTrace>; cancel: () => void }
```

Handle both message types in `simulate.worker.ts`.

- [ ] **Step 6: Run dashboard bear library test**

Run: `cd dashboard/web && npx --yes tsx --test lib/simulator/bear.test.ts`

Expected: PASS.

### Task 3: Bear Optimise Library and Worker

**Files:**
- Modify: `dashboard/web/lib/simulator/bear.ts`
- Modify: `dashboard/web/lib/simulator/worker-protocol.ts`
- Modify: `dashboard/web/lib/simulator/worker-client.ts`
- Modify: `dashboard/web/app/simulate/simulate.worker.ts`
- Test: `dashboard/web/lib/simulator/bear.test.ts`

- [ ] **Step 1: Add failing optimise test**

Add to `bear.test.ts`:

```ts
test("runBearOptimizeRatio ranks troop mixes by average bear score", () => {
  const result = runBearOptimizeRatio(
    {
      ...request,
      grid_step: 25,
      search_replicates: 1,
      infantry_min_pct: 0,
      infantry_max_pct: 100,
      top_n: 3,
      search_mode: "grid",
    },
    {
      scoreCandidate: (candidate) => candidate.marksman_count,
    },
  );

  assert.equal(result.best.marksman_count, 175);
  assert.equal(result.top_results[0].avg_score, 175);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dashboard/web && npx --yes tsx --test lib/simulator/bear.test.ts`

Expected: FAIL because `runBearOptimizeRatio` does not exist.

- [ ] **Step 3: Add bear optimise types and implementation**

Use the existing optimise result shape where possible, with score fields:

```ts
export interface BearOptimizeRatioRequestPayload extends BearSimRequestPayload {
  grid_step: number;
  search_replicates: number;
  infantry_min_pct: number;
  infantry_max_pct: number;
  top_n: number;
  search_mode?: OptimizeSearchMode;
}
```

Implement `runBearOptimizeRatio` by adapting the existing grid/adaptive candidate generation from `optimise.ts`, scoring candidates with `runBearSimulation`, and ranking highest average score.

- [ ] **Step 4: Wire bear optimise worker messages**

Add `bearOptimize` request and `bearOptimizeResult` response.

- [ ] **Step 5: Run bear tests**

Run: `cd dashboard/web && npx --yes tsx --test lib/simulator/bear.test.ts`

Expected: PASS.

### Task 4: Shared Simulator UI Extraction

**Files:**
- Modify: `dashboard/web/app/simulate/SimulateClient.tsx`
- Create: `dashboard/web/app/simulate/simulator-ui.tsx`

- [ ] **Step 1: Extract shared UI and state helpers without behavior changes**

Move these exports to `simulator-ui.tsx`:

```ts
export type Side = "attacker" | "defender";
export interface SideState {
  troops: Record<TroopCategory, number>;
  tiers: Record<TroopCategory, string>;
  heroes: Record<TroopCategory, HeroSlotState>;
  joiners: JoinerSlotState[];
  stats: Record<TroopCategory, Record<string, number>>;
  statModifiers: StatModifierState;
  petModifiers: PetModifierState;
}
export function defaultSide(): SideState;
export function toApiPayload(
  attacker: SideState,
  defender: SideState,
  replicates: number,
  rallyMode: boolean,
  statProfileNames?: Record<Side, string | null>,
): SimulateRequestPayload;
export function sideFromPayload(side: SimulateSidePayload): SideState;
export function mergeSideFromOcr(
  prev: SideState,
  ocrSide: OcrSideData,
  heroes: Record<TroopCategory, string | null>,
  rallyMode: boolean,
  which: Side,
  skill4Levels: Record<TroopCategory, number>,
  ownActiveModifiers: UploadActiveModifiers,
  opponentActiveModifiers: UploadActiveModifiers,
): SideState;
export function sideWithPresetStats(side: SideState, preset: PlayerStatPreset): SideState;
export function heroAdjustedStats(side: SideState, mode: "subtract" | "add"): StatPresetValues;
export function loadLocalStatPresets(): PlayerStatPreset[];
export function saveLocalStatPresets(presets: PlayerStatPreset[]): void;
export function newStatPresetId(): string;
export function SidePanel(props: {
  title: string;
  which: Side;
  state: SideState;
  opponent: SideState;
  setState: (updater: (prev: SideState) => SideState) => void;
  rallyMode: boolean;
  syncStatsOnHeroChange: boolean;
  onStatSync: StatSyncHandler;
  loadedPresetName: string | null;
  onOpenPreset: () => void;
}): JSX.Element;
export function ProgressBar(props: { active: boolean; done: number; total: number }): JSX.Element;
export function ResultCard(props: { label: string; value: string }): JSX.Element;
```

Update `SimulateClient.tsx` imports and keep its behavior unchanged.

- [ ] **Step 2: Run existing browser simulator tests**

Run: `cd dashboard/web && npx --yes tsx --test lib/simulator/simulate.test.ts lib/simulator/adapters.test.ts`

Expected: PASS.

### Task 5: Bear Page UI

**Files:**
- Create: `dashboard/web/app/bear/page.tsx`
- Create: `dashboard/web/app/bear/BearSimClient.tsx`
- Modify: `dashboard/web/components/SiteNav.tsx`
- Test: `dashboard/web/tests/smoke.spec.ts`

- [ ] **Step 1: Add `/bear` route and nav link**

Add `dashboard/web/app/bear/page.tsx`:

```tsx
import BearSimClient from "./BearSimClient";

export default function BearPage() {
  return <BearSimClient />;
}
```

Add `{ href: "/bear", label: "Bear Sim" }` to both dashboard and simulate public-surface nav lists.

- [ ] **Step 2: Build BearSimClient using shared components**

Create one user army state, fixed rally mode, stat presets, upload modal, run panel, chart, trace details, skills table, optimise panel, and recent chart/example battle interactions using the shared simulator components.

- [ ] **Step 3: Add OCR left/right import mode**

Reuse `UploadReportModal` with a bear-specific prop or a new lightweight wrapper so the parsed left or right OCR side is merged into the single user army.

- [ ] **Step 4: Add Playwright smoke coverage**

Add a test that visits `/bear`, sees the Bear Sim heading, sees one army panel, opens the stat preset modal, and sees optimise controls.

- [ ] **Step 5: Run UI checks**

Run: `cd dashboard/web && npm run typecheck`

Expected: PASS.

Run: `cd dashboard/web && npx playwright test tests/smoke.spec.ts --grep "bear"`

Expected: PASS.

### Task 6: Final Verification

**Files:**
- All touched files

- [ ] **Step 1: Run simulator package verification**

Run: `cd simulator && npm test && npm run typecheck`

Expected: PASS.

- [ ] **Step 2: Run dashboard targeted verification**

Run: `cd dashboard/web && npx --yes tsx --test lib/simulator/bear.test.ts lib/simulator/simulate.test.ts lib/simulator/adapters.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 3: Inspect git diff**

Run: `git diff --stat && git status --short`

Expected: only bear sim implementation files plus pre-existing unrelated hero definition modifications.
