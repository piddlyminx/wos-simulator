import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  OptimizeRatioRequestPayload,
  SavedSimulationRunResponse,
  SimulateApiResult,
  SimulateRequestPayload,
  SimulateSidePayload,
} from "@/lib/simulate-run";
import type { SurfaceSweepPayload } from "@/lib/simulator/surface";
import {
  DEFAULT_SURFACE_JOBS,
  DEFAULT_SURFACE_POINTS_PER_EDGE,
  DEFAULT_SURFACE_REPLICATES,
  defaultSavedRunFormState,
  savedRunToFormState,
  withSaveMeta,
} from "./saved-run-state";

test("defaultSavedRunFormState carries the initial load error only", () => {
  const state = defaultSavedRunFormState("not found");

  assert.equal(state.savedRunError, "not found");
  assert.equal(state.result, null);
  assert.equal(state.optimizeResult, null);
  assert.equal(state.surfaceResult, null);
  assert.equal(state.surfacePointsPerEdge, DEFAULT_SURFACE_POINTS_PER_EDGE);
  assert.equal(state.surfaceReplicates, DEFAULT_SURFACE_REPLICATES);
  assert.equal(state.surfaceJobs, DEFAULT_SURFACE_JOBS);
});

test("savedRunToFormState hydrates simulate runs and clamps replicates", () => {
  const saved = savedRun("simulate", {
    ...baseRequest(),
    replicates: 9000,
  });

  const state = savedRunToFormState(saved);

  assert.equal(state.replicates, 5000);
  assert.equal(state.result?.saved_run_id, "run-1");
  assert.equal(state.result?.share_url, "/simulate?run=run-1");
  assert.equal(state.loadedPresetNames.attacker, "att");
  assert.equal(state.loadedPresetNames.defender, null);
  assert.equal(state.savedRunMeta?.title.includes("vs"), true);
});

test("savedRunToFormState hydrates optimize settings from a single parser", () => {
  const base = baseRequest();
  const saved = savedRun("optimize_ratio", {
    attacker: base.attacker,
    defender: base.defender,
    rally_mode: base.rally_mode,
    grid_step: 2500,
    search_replicates: 900,
    adaptive_phase1_replicates: 0,
    adaptive_phase2_replicates: 12,
    adaptive_final_replicates: 600,
    infantry_min_pct: 25,
    infantry_max_pct: 75,
    top_n: 10,
    search_mode: "grid",
    optimize_side: "defender",
  } satisfies OptimizeRatioRequestPayload);

  const state = savedRunToFormState(saved);

  assert.equal(state.replicates, 1000);
  assert.equal(state.optimizeReplicates, 500);
  assert.equal(state.optimizeStepInput, "2500");
  assert.equal(state.adaptivePhase1Replicates, 1);
  assert.equal(state.adaptivePhase2Replicates, 12);
  assert.equal(state.adaptiveFinalReplicates, 600);
  assert.equal(state.optimizeInfantryMinPct, 25);
  assert.equal(state.optimizeInfantryMaxPct, 75);
  assert.equal(state.optimizeSearchMode, "grid");
  assert.equal(state.optimizeSide, "defender");
  assert.equal(state.optimizeResult?.saved_kind, "optimize_ratio");
});

test("savedRunToFormState ignores legacy optimize simulate replicates", () => {
  const saved = savedRun("optimize_ratio", {
    ...baseRequest(),
    replicates: 321,
    grid_step: 2500,
    search_replicates: 20,
    infantry_min_pct: 25,
    infantry_max_pct: 75,
    top_n: 10,
  } satisfies OptimizeRatioRequestPayload);

  const state = savedRunToFormState(saved);

  assert.equal(state.replicates, 1000);
  assert.equal(state.optimizeReplicates, 20);
});

test("savedRunToFormState hydrates surface settings and clamps them", () => {
  const base = baseRequest();
  const saved = savedRun("ratio_explorer", {
    attacker: base.attacker,
    defender: base.defender,
    attackerTotal: 3000,
    defenderTotal: 3000,
    pointsPerEdge: 50,
    replicates: 0,
    rallyMode: true,
    jobs: 99,
  } satisfies SurfaceSweepPayload);

  const state = savedRunToFormState(saved);

  assert.equal(state.surfacePointsPerEdge, 21);
  assert.equal(state.surfaceShownPointsPerEdge, 21);
  assert.equal(state.surfaceReplicates, DEFAULT_SURFACE_REPLICATES);
  assert.equal(state.surfaceJobs, 16);
  assert.equal(state.rallyMode, true);
  assert.equal(state.surfaceResult?.saved_run_id, "run-1");
});

test("savedRunToFormState keeps explorer replicates out of simulate settings", () => {
  const base = baseRequest();
  const saved = savedRun("ratio_explorer", {
    attacker: base.attacker,
    defender: base.defender,
    attackerTotal: 3000,
    defenderTotal: 3000,
    pointsPerEdge: 11,
    replicates: 37,
    rallyMode: false,
    jobs: 4,
  } satisfies SurfaceSweepPayload);

  const state = savedRunToFormState(saved);

  assert.equal(state.replicates, 1000);
  assert.equal(state.surfaceReplicates, 37);
});

test("withSaveMeta attaches canonical saved-run metadata", () => {
  const saved = savedRun("simulate", baseRequest());
  const result = withSaveMeta({ value: 1 }, saved);

  assert.deepEqual(result, {
    value: 1,
    saved_run_id: "run-1",
    saved_at: "2026-01-02T03:04:05.000Z",
    saved_kind: "simulate",
    share_url: "/simulate?run=run-1",
  });
});

function savedRun(
  kind: SavedSimulationRunResponse["kind"],
  request: SavedSimulationRunResponse["request"],
): SavedSimulationRunResponse {
  return {
    version: 1,
    id: "run-1",
    kind,
    created_at: "2026-01-02T03:04:05.000Z",
    share_url: "/simulate?run=run-1",
    request,
    result:
      kind === "ratio_explorer"
        ? { points: [], winrateMatrix: [] }
        : kind === "optimize_ratio"
          ? optimizeResult()
          : simulateResult(),
  };
}

function baseRequest(): SimulateRequestPayload {
  return {
    attacker: sidePayload("att"),
    defender: sidePayload(null),
    replicates: 1000,
    rally_mode: false,
  };
}

function sidePayload(statProfileName: string | null): SimulateSidePayload {
  return {
    troops: { infantry: 1000, lancer: 1000, marksman: 1000 },
    troop_types: {
      infantry: "infantry_t11_fc10",
      lancer: "lancer_t11_fc10",
      marksman: "marksman_t11_fc10",
    },
    heroes: {
      infantry: { name: null, skills: [0, 0, 0, 0] },
      lancer: { name: null, skills: [0, 0, 0, 0] },
      marksman: { name: null, skills: [0, 0, 0, 0] },
    },
    joiners: [],
    stat_profile_name: statProfileName,
    stats: {
      inf: [100, 100, 100, 100],
      lanc: [100, 100, 100, 100],
      mark: [100, 100, 100, 100],
    },
  };
}

function simulateResult(): SimulateApiResult {
  return {
    replicates: 1000,
    summary: {
      mean: 0,
      std: 0,
      best: { value: 0, winner: "draw" },
      worst: { value: 0, winner: "draw" },
      attacker_win_rate: 0.5,
      avg_rounds: 1,
      avg_skill_activations: 0,
      avg_skill_kills: 0,
      avg_attacker_activations: 0,
      avg_defender_activations: 0,
      avg_attacker_kills: 0,
      avg_defender_kills: 0,
    },
    outcomes: [],
    per_side_skills: { attacker: [], defender: [] },
  };
}

function optimizeResult() {
  return {
    total_troops: 3000,
    grid_step: 2500,
    compositions_tested: 1,
    projected_battles: 1,
    replicates_per_ratio: 20,
    infantry_min_pct: 25,
    infantry_max_pct: 75,
    best: optimizePoint(),
    top_results: [optimizePoint()],
    points: [optimizePoint()],
  };
}

function optimizePoint() {
  return {
    infantry_count: 1000,
    lancer_count: 1000,
    marksman_count: 1000,
    infantry_pct: 33.3,
    lancer_pct: 33.3,
    marksman_pct: 33.4,
    win_rate: 0.5,
    win_rate_pct: 50,
    avg_margin: 0,
    avg_attacker_left: 0,
    avg_defender_left: 0,
  };
}
