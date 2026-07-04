import assert from "node:assert/strict";
import { test } from "node:test";

import {
  progressiveSurfaceStages,
  runProgressiveSurfaceSweep,
  runSurfaceSweep,
  type SurfaceBatchResult,
  type SurfaceSweepPayload,
} from "./surface";

test("runSurfaceSweep lets batch runners report live progress without replaying from zero", async () => {
  const progress: Array<[number, number]> = [];

  const result = await runSurfaceSweep(samplePayload(), {
    onProgress: (done, total) => progress.push([done, total]),
    runBatches: async (tasks, onProgress) => {
      onProgress?.(1, 9);
      onProgress?.(3, 9);
      return tasks.map<SurfaceBatchResult>((task) => ({
        attIdx: task.attIdx,
        defIdx: task.defIdx,
        winrate: task.attIdx === task.defIdx ? 0.5 : 0.75,
      }));
    },
  });

  assert.deepEqual(progress, [
    [1, 9],
    [3, 9],
  ]);
  assert.equal(result.points.length, 3);
  assert.equal(result.winrateMatrix.length, 9);
});

test("progressiveSurfaceStages ramps through previews up to the requested final density", () => {
  assert.deepEqual(progressiveSurfaceStages(11), [6, 11]);
  assert.deepEqual(progressiveSurfaceStages(21), [6, 11, 21]);
  assert.deepEqual(progressiveSurfaceStages(31), [6, 11, 21, 31]);
  assert.deepEqual(progressiveSurfaceStages(41), [6, 11, 21, 41]);
});

test("runProgressiveSurfaceSweep emits previews and reuses completed pair results", async () => {
  const taskCounts: number[] = [];
  const stages: number[] = [];
  const progress: Array<[number, number]> = [];

  const result = await runProgressiveSurfaceSweep(
    { ...samplePayload(), pointsPerEdge: 11 },
    {
      onStage: (stage) => stages.push(stage.pointsPerEdge),
      onProgress: (done, total) => progress.push([done, total]),
      runBatches: async (tasks, onProgress) => {
        taskCounts.push(tasks.length);
        onProgress?.(tasks.length, tasks.length);
        return tasks.map((task) => ({
          attIdx: task.attIdx,
          defIdx: task.defIdx,
          winrate: task.attIdx === task.defIdx ? 0.5 : 0.75,
        }));
      },
    },
  );

  assert.deepEqual(stages, [6, 11]);
  assert.deepEqual(taskCounts, [441, 3915]);
  assert.deepEqual(progress.at(-1), [4356, 4356]);
  assert.equal(result.points.length, 66);
  assert.equal(result.winrateMatrix.length, 4356);
});

test("runSurfaceSweep preserves per-side troop tiers while varying counts", async () => {
  const attacker = {
    ...sampleSide(),
    troop_types: {
      infantry: "infantry_t11_fc10",
      lancer: "lancer_t10",
      marksman: "marksman_t9",
    },
  };
  const defender = {
    ...sampleSide(),
    troop_types: {
      infantry: "infantry_t8",
      lancer: "lancer_t7",
      marksman: "marksman_t6",
    },
  };

  await runSurfaceSweep(
    {
      ...samplePayload(),
      attacker,
      defender,
      attackerTotal: 90,
      defenderTotal: 60,
    },
    {
      runBatches: async (tasks) => {
        assert.deepEqual(Object.keys(tasks[0].attFighter.troops).sort(), [
          "infantry_t11_fc10",
          "lancer_t10",
          "marksman_t9",
        ]);
        assert.deepEqual(Object.keys(tasks[0].defFighter.troops).sort(), [
          "infantry_t8",
          "lancer_t7",
          "marksman_t6",
        ]);
        assert.equal(
          Object.values(tasks[0].attFighter.troops).reduce((sum, value) => sum + value, 0),
          90,
        );
        assert.equal(
          Object.values(tasks[0].defFighter.troops).reduce((sum, value) => sum + value, 0),
          60,
        );
        return tasks.map<SurfaceBatchResult>((task) => ({
          attIdx: task.attIdx,
          defIdx: task.defIdx,
          winrate: 0.5,
        }));
      },
    },
  );
});

function samplePayload(): SurfaceSweepPayload {
  return {
    attacker: sampleSide(),
    defender: sampleSide(),
    pointsPerEdge: 2,
    attackerTotal: 10,
    defenderTotal: 10,
    replicates: 1,
    rallyMode: false,
    jobs: 2,
  };
}

function sampleSide(): SurfaceSweepPayload["attacker"] {
  return {
    troops: { infantry: 0, lancer: 0, marksman: 0 },
    troop_types: {
      infantry: "infantry_t1",
      lancer: "lancer_t1",
      marksman: "marksman_t1",
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
