import assert from "node:assert/strict";
import { test } from "node:test";

import { loadSimulatorConfig } from "@simulator/config";
import type { BattleInput, BattleResult, SimulationOptions, SimulatorConfig } from "@simulator/types";
import type { OptimizeRatioRequestPayload } from "@/lib/simulate-run";
import { compositionGrid, countsForPercentages, rankOptimizeRows, runOptimizeRatio, wilsonLowerBound } from "./optimise";

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

test("runOptimizeRatio evaluates candidate battles in fast simulator mode", () => {
  const calls: SimulationOptions[] = [];
  const result = runOptimizeRatio(sampleOptimizePayload(), {
    config: loadSimulatorConfig(),
    simulateBattle: (_input: BattleInput, _config: SimulatorConfig, options?: SimulationOptions) => {
      calls.push(options ?? {});
      return fakeBattleResult();
    },
  });

  assert.equal(result.best.infantry_count, 10);
  assert.ok(calls.length > 0);
  assert.deepEqual(calls.map((options) => options.detail), calls.map(() => "fast"));
});

function sampleOptimizePayload(): OptimizeRatioRequestPayload {
  return {
    attacker: sampleSide({ infantry: 10, lancer: 0, marksman: 0 }),
    defender: sampleSide({ infantry: 10, lancer: 0, marksman: 0 }),
    replicates: 1,
    rally_mode: false,
    grid_step: 10,
    search_replicates: 1,
    infantry_min_pct: 100,
    infantry_max_pct: 100,
    top_n: 1,
    search_mode: "grid",
    optimize_side: "attacker",
  };
}

function sampleSide(troops: Record<"infantry" | "lancer" | "marksman", number>): OptimizeRatioRequestPayload["attacker"] {
  return {
    troops,
    troop_types: {
      infantry: "infantry_t10",
      lancer: "lancer_t10",
      marksman: "marksman_t10",
    },
    heroes: {
      infantry: { name: null, skills: [0, 0, 0, 0] },
      lancer: { name: null, skills: [0, 0, 0, 0] },
      marksman: { name: null, skills: [0, 0, 0, 0] },
    },
    joiners: [],
    stats: {
      inf: [0, 0, 0, 0],
      lanc: [0, 0, 0, 0],
      mark: [0, 0, 0, 0],
    },
  };
}

function fakeBattleResult(): BattleResult {
  return {
    remaining: {
      attacker: { infantry: 10, lancer: 0, marksman: 0 },
      defender: { infantry: 0, lancer: 0, marksman: 0 },
    },
  } as BattleResult;
}
