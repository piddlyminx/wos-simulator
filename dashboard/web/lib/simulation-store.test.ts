import assert from "node:assert/strict";
import { appendFile, mkdtemp, readdir, writeFile } from "node:fs/promises";
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
import type { TournamentRequestPayload, TournamentResult } from "@/lib/tournament";
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

const tournamentRequest: TournamentRequestPayload = {
  groups: [{
    label: "Test batch",
    infantryMains: ["Hector"],
    lancerMains: ["Mia"],
    marksmanMains: ["Bradley"],
    joiners: ["Jessie", "Seo-yoon", "Lumak", "Ling"],
    ratios: ["50,20,30"],
    allowRepeatedJoiners: false,
    excludeMainHeroesFromJoiners: true,
  }],
  totalTroops: 100_000,
  rounds: 2,
  seedRounds: 1,
  reps: 1,
  jobs: 1,
  seed: 1234,
  freezeRate: 0.2,
  freezeLossesGte: null,
  startFreezeRound: 2,
  minPoolSize: 2,
  topN: 10,
  finalsTopM: 0,
  finalsReps: 1,
  finalsMaxSameMainLineup: 10,
};

const tournamentResult: TournamentResult = {
  generatedTeams: 2,
  swiss: {
    offense: { rows: [], totalRows: 0 },
    defense: { rows: [], totalRows: 0 },
  },
};

test("saved run helpers route snapshots to their owning pages", () => {
  assert.equal(buildSimulationShareUrl("abc123", "simulate"), "/simulate?run=abc123");
  assert.equal(buildSimulationShareUrl("abc123", "bear_simulate"), "/bear?run=abc123");
  assert.equal(buildSimulationShareUrl("abc123", "ratio_explorer"), "/simulate?run=abc123");
  assert.equal(buildSimulationShareUrl("abc123", "tournament"), "/tournament?run=abc123");
  assert.match(buildSimulationRunTitle(bearRequest, "bear_simulate"), /^Bear: /);
  assert.match(buildSimulationRunTitle(surfaceRequest, "ratio_explorer"), /^Ratio Explorer: /);
  assert.equal(buildSimulationRunTitle(tournamentRequest, "tournament"), "Tournament: Test batch (2 rounds)");
});

test("simulation store filters and pages each run history separately", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "wos-sim-runs-"));
  process.env.SIM_RUNS_DIR = dir;
  const store = await import(`./simulation-store.ts?case=${Date.now()}`);

  const pvp = await store.saveSimulationRun("simulate", pvpRequest, pvpResult);
  const bear = await store.saveSimulationRun("bear_simulate", bearRequest, bearResult);
  const bearOpt = await store.saveSimulationRun("bear_optimize_ratio", bearOptimizeRequest, bearOptimizeResult);
  const surface = await store.saveSimulationRun("ratio_explorer", surfaceRequest, surfaceResult);
  const tournament = await store.saveSimulationRun("tournament", tournamentRequest, tournamentResult);

  assert.equal(pvp.share_url.startsWith("/simulate?run="), true);
  assert.equal(bear.share_url.startsWith("/bear?run="), true);
  assert.equal(bearOpt.share_url.startsWith("/bear?run="), true);
  assert.equal(surface.share_url.startsWith("/simulate?run="), true);
  assert.equal(tournament.share_url.startsWith("/tournament?run="), true);

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

  const tournamentPage = await store.listSimulationRunsPage({
    limit: 10,
    kinds: ["tournament"],
  });
  assert.deepEqual(tournamentPage.runs.map((run: SavedSimulationRunListItem) => run.kind), ["tournament"]);
  assert.equal(tournamentPage.runs[0]?.share_url.startsWith("/tournament?run="), true);

  const files = await readdir(dir);
  assert.equal(files.includes(".runs-index.json"), true);
  assert.equal(files.includes(`${pvp.id}.json.gz`), true);
  assert.equal(files.includes(`${pvp.id}.meta.json`), true);
  assert.equal(files.includes(`${pvp.id}.json`), false);
  assert.deepEqual((await store.readSimulationRun(pvp.id))?.result, pvpResult);
});

test("simulation run index persists without rereading legacy result files", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "wos-sim-runs-"));
  process.env.SIM_RUNS_DIR = dir;
  const store = await import(`./simulation-store.ts?case=${Date.now()}`);

  const id = "legacy-run-1234";
  await writeFile(
    path.join(dir, `${id}.json`),
    `${JSON.stringify({
      version: 1,
      id,
      kind: "tournament",
      created_at: new Date().toISOString(),
      request: tournamentRequest,
      result: tournamentResult,
    }, null, 2)}\n`,
    "utf8",
  );
  assert.deepEqual((await store.readSimulationRun(id))?.result, tournamentResult);
  await appendFile(
    path.join(dir, `${id}.json`),
    "this makes the result payload invalid JSON",
    "utf8",
  );

  const page = await store.listSimulationRunsPage({
    limit: 20,
    kinds: ["tournament"],
  });
  assert.equal(page.runs.length, 1);
  assert.equal(page.runs[0]?.id, id);

  // A fresh server process can list from the persisted index without opening
  // any of the large legacy run bodies again.
  await writeFile(path.join(dir, `${id}.json`), "not JSON", "utf8");
  const freshStore = await import(`./simulation-store.ts?case=${Date.now()}-fresh`);
  const indexedPage = await freshStore.listSimulationRunsPage({
    limit: 20,
    kinds: ["tournament"],
  });
  assert.equal(indexedPage.runs.length, 1);
  assert.equal(indexedPage.runs[0]?.id, id);
});

test("cleanup enforces age and size limits but preserves kept runs", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "wos-sim-runs-"));
  process.env.SIM_RUNS_DIR = dir;
  const store = await import(`./simulation-store.ts?case=${Date.now()}`);

  const disposable = await store.saveSimulationRun("simulate", pvpRequest, pvpResult);
  const kept = await store.saveSimulationRun("bear_simulate", bearRequest, bearResult);
  assert.equal(await store.setSimulationRunKept(kept.id, true), true);

  const pageBefore = await store.listSimulationRunsPage({ limit: 20 });
  assert.equal(pageBefore.runs.find((run: SavedSimulationRunListItem) => run.id === kept.id)?.kept, true);
  const cleanup = await store.cleanupSimulationRuns({
    retentionDays: 30,
    maxStorageBytes: 0,
    now: Date.now() + 31 * 24 * 60 * 60 * 1000,
  });

  assert.equal(cleanup.deleted_runs, 1);
  assert.equal(cleanup.kept_runs, 1);
  assert.equal(await store.readSimulationRun(disposable.id), null);
  assert.equal((await store.readSimulationRun(kept.id))?.kept, true);

  const overLimit = await store.saveSimulationRun("simulate", pvpRequest, pvpResult);
  const sizeCleanup = await store.cleanupSimulationRuns({
    retentionDays: 0,
    maxStorageBytes: 1,
  });
  assert.equal(sizeCleanup.deleted_runs, 1);
  assert.equal(await store.readSimulationRun(overLimit.id), null);
  assert.equal((await store.readSimulationRun(kept.id))?.kept, true);

  assert.equal(await store.setSimulationRunKept(kept.id, false), false);
  const finalCleanup = await store.cleanupSimulationRuns({
    retentionDays: 30,
    maxStorageBytes: 0,
    now: Date.now() + 31 * 24 * 60 * 60 * 1000,
  });
  assert.equal(finalCleanup.deleted_runs, 1);
  assert.equal(await store.readSimulationRun(kept.id), null);
});
