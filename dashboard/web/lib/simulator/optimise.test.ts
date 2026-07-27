import assert from "node:assert/strict";
import { test } from "node:test";

import { loadSimulatorConfig } from "@simulator/config";
import type { BattleResult, SimulationOptions } from "@simulator/types";
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
    { win_rate: 0.6, avg_margin: 10, avg_attacker_left: 5, avg_defender_left: 0 },
    { win_rate: 0.5, avg_margin: 20, avg_attacker_left: 2, avg_defender_left: 0 },
  ], "attacker");
  assert.equal(ranked[0].win_rate, 0.6);
});

test("rankOptimizeRows can sort by margin before win rate", () => {
  const ranked = rankOptimizeRows([
    { win_rate: 0.6, avg_margin: 10, avg_attacker_left: 5, avg_defender_left: 0 },
    { win_rate: 0.5, avg_margin: 20, avg_attacker_left: 2, avg_defender_left: 0 },
  ], "attacker", "margin");
  assert.equal(ranked[0].avg_margin, 20);
});

test("runOptimizeRatio evaluates candidate battles in fast simulator mode", async () => {
  const calls: SimulationOptions[] = [];
  const result = await runOptimizeRatio(sampleOptimizePayload(), {
    config: loadSimulatorConfig(),
    runBattles: (_input, _config, seeds, options: SimulationOptions) => {
      calls.push(...seeds.map(() => options));
      return seeds.map(() => fakeBattleResult());
    },
  });

  assert.equal(result.best.infantry_count, 10);
  assert.equal(result.rank_by, "win_rate");
  assert.ok(calls.length > 0);
  assert.deepEqual(calls.map((options) => options.mode), calls.map(() => "fast"));
});

test("adaptive progress is battle-weighted and tightens totals after deduplication", async () => {
  const progress: Array<[number, number]> = [];
  const timings: Array<{ stage: string; compositions: number; replicatesPerComposition: number; simulations: number; totalMs: number }> = [];
  const payload = {
    ...sampleOptimizePayload(),
    search_mode: "adaptive" as const,
    adaptive_phase1_replicates: 2,
    adaptive_phase2_replicates: 3,
    adaptive_final_replicates: 5,
  };

  await runOptimizeRatio(payload, {
    config: loadSimulatorConfig(),
    runBattles: (_input, _config, seeds) => seeds.map(() => fakeBattleResult()),
    onProgress: (done, total) => progress.push([done, total]),
    onStageTiming: (timing) => timings.push(timing),
  });

  assert.deepEqual(progress.at(-1), [10, 10]);
  assert.ok(progress.some(([done, total]) => done === 5 && total === 205));
  assert.ok(progress.some(([done, total]) => done === 5 && total === 10));
  assert.equal(progress.every(([done, total]) => done <= total), true);
  assert.deepEqual(
    timings.map(({ stage, compositions, replicatesPerComposition, simulations }) => ({
      stage,
      compositions,
      replicatesPerComposition,
      simulations,
    })),
    [
      { stage: "coarse", compositions: 1, replicatesPerComposition: 2, simulations: 2 },
      { stage: "local", compositions: 1, replicatesPerComposition: 3, simulations: 3 },
      { stage: "finalist", compositions: 1, replicatesPerComposition: 5, simulations: 5 },
    ],
  );
  assert.equal(timings.every(({ totalMs }) => totalMs >= 0), true);
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
