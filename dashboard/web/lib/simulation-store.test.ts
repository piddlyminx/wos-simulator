import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import type {
  SavedSimulationRunListItem,
  BearOptimizeRatioRequestPayload,
  BearOptimizeRatioResult,
  BearSimRequestPayload,
  BearSimResult,
  SimulateRequestPayload,
  SimulateApiResult,
} from "@/lib/simulate-run";
import type { SurfaceSweepPayload, SurfaceSweepResult } from "@/lib/simulator/surface";
import {
  buildSimulationRunTitle,
  buildSimulationShareUrl,
} from "@/lib/simulate-run";

const side = {
  troops: { infantry: 100, lancer: 50, marksman: 25 },
  troop_types: {
    infantry: "infantry_t6",
    lancer: "lancer_t6",
    marksman: "marksman_t6",
  },
  heroes: {
    infantry: { name: "Jeronimo", skills: [5, 5, 5, 5] },
    lancer: { name: "Mia", skills: [5, 5, 5, 5] },
    marksman: { name: "Bradley", skills: [5, 5, 5, 5] },
  },
  joiners: [{ name: "Jasser", skill_1: 5 }],
  stats: {
    inf: [100, 100, 100, 100],
    lanc: [100, 100, 100, 100],
    mark: [100, 100, 100, 100],
  },
} satisfies SimulateRequestPayload["attacker"];

const pvpRequest: SimulateRequestPayload = {
  attacker: side,
  defender: { ...side, heroes: { ...side.heroes, infantry: { name: "Logan", skills: [5, 5, 5, 5] } } },
  replicates: 1,
  rally_mode: true,
};

const pvpResult: SimulateApiResult = {
  replicates: 1,
  summary: {
    mean: 0,
    std: 0,
    best: { value: 0, winner: "draw" },
    worst: { value: 0, winner: "draw" },
    attacker_win_rate: 0,
    avg_skill_activations: 0,
    avg_skill_kills: 0,
    avg_attacker_activations: 0,
    avg_defender_activations: 0,
    avg_attacker_kills: 0,
    avg_defender_kills: 0,
  },
  outcomes: [0],
  per_side_skills: { attacker: [], defender: [] },
};

const bearRequest: BearSimRequestPayload = {
  player: side,
  replicates: 1,
};

const bearResult: BearSimResult = {
  replicates: 1,
  summary: {
    mean: 123,
    std: 0,
    best: { value: 123 },
    worst: { value: 123 },
    avg_skill_activations: 0,
    avg_skill_damage: 0,
  },
  scores: [123],
  skills: [],
};

const bearOptimizeRequest: BearOptimizeRatioRequestPayload = {
  ...bearRequest,
  grid_step: 10,
  search_replicates: 1,
  infantry_min_pct: 0,
  infantry_max_pct: 100,
  top_n: 10,
  search_mode: "grid",
};

const bearOptimizeResult: BearOptimizeRatioResult = {
  total_troops: 175,
  grid_step: 10,
  compositions_tested: 1,
  projected_battles: 1,
  replicates_per_ratio: 1,
  infantry_min_pct: 0,
  infantry_max_pct: 100,
  best: {
    infantry_count: 100,
    lancer_count: 50,
    marksman_count: 25,
    infantry_pct: 57,
    lancer_pct: 29,
    marksman_pct: 14,
    avg_score: 123,
  },
  top_results: [],
  points: [],
};

const surfaceRequest: SurfaceSweepPayload = {
  attacker: pvpRequest.attacker,
  defender: pvpRequest.defender,
  pointsPerEdge: 6,
  attackerTotal: 100_000,
  defenderTotal: 100_000,
  replicates: 2,
  rallyMode: false,
  jobs: 1,
};

const surfaceResult: SurfaceSweepResult = {
  points: [
    { inf: 100_000, lanc: 0, mark: 0 },
    { inf: 0, lanc: 100_000, mark: 0 },
  ],
  winrateMatrix: [0.5, 0.75, 0.25, 0.5],
};

test("saved run helpers route bear snapshots to the bear page", () => {
  assert.equal(buildSimulationShareUrl("abc123", "simulate"), "/simulate?run=abc123");
  assert.equal(buildSimulationShareUrl("abc123", "bear_simulate"), "/bear?run=abc123");
  assert.equal(buildSimulationShareUrl("abc123", "ratio_explorer"), "/simulate?run=abc123");
  assert.match(buildSimulationRunTitle(bearRequest, "bear_simulate"), /^Bear: /);
  assert.match(buildSimulationRunTitle(surfaceRequest, "ratio_explorer"), /^Ratio Explorer: /);
});

test("simulation store filters and pages PvP, bear, and ratio explorer run histories separately", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "wos-sim-runs-"));
  process.env.SIM_RUNS_DIR = dir;
  const store = await import(`./simulation-store.ts?case=${Date.now()}`);

  const pvp = await store.saveSimulationRun("simulate", pvpRequest, pvpResult);
  const bear = await store.saveSimulationRun("bear_simulate", bearRequest, bearResult);
  const bearOpt = await store.saveSimulationRun("bear_optimize_ratio", bearOptimizeRequest, bearOptimizeResult);
  const surface = await store.saveSimulationRun("ratio_explorer", surfaceRequest, surfaceResult);

  assert.equal(pvp.share_url.startsWith("/simulate?run="), true);
  assert.equal(bear.share_url.startsWith("/bear?run="), true);
  assert.equal(bearOpt.share_url.startsWith("/bear?run="), true);
  assert.equal(surface.share_url.startsWith("/simulate?run="), true);

  const pvpPage = await store.listSimulationRunsPage({
    limit: 10,
    kinds: ["simulate", "optimize_ratio"],
  });
  assert.deepEqual(pvpPage.runs.map((run: SavedSimulationRunListItem) => run.kind), ["simulate"]);

  const firstBearPage = await store.listSimulationRunsPage({
    limit: 1,
    offset: 0,
    kinds: ["bear_simulate", "bear_optimize_ratio"],
  });
  assert.equal(firstBearPage.runs.length, 1);
  assert.equal(firstBearPage.has_more, true);
  assert.equal(firstBearPage.next_offset, 1);

  const secondBearPage = await store.listSimulationRunsPage({
    limit: 1,
    offset: firstBearPage.next_offset,
    kinds: ["bear_simulate", "bear_optimize_ratio"],
  });
  assert.equal(secondBearPage.runs.length, 1);
  assert.equal(secondBearPage.has_more, false);
  assert.equal(secondBearPage.runs.every((run: SavedSimulationRunListItem) => run.share_url.startsWith("/bear?run=")), true);

  const ratioExplorerPage = await store.listSimulationRunsPage({
    limit: 10,
    kinds: ["ratio_explorer"],
  });
  assert.deepEqual(ratioExplorerPage.runs.map((run: SavedSimulationRunListItem) => run.kind), ["ratio_explorer"]);
});
