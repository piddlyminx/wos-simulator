import assert from "node:assert/strict";
import { test } from "node:test";

import { runBenchmarkFinals, selectProportionalPanel } from "./benchmarkFinals";
import type { BenchmarkFinalsOptions, BenchmarkStage } from "./benchmarkFinals";
import type { BattleTaskRunner } from "./dualSwiss";
import { avgMargin, winRate } from "./pools";
import type { BattleSummary, BattleTask, Team } from "./types";

function team(id: number, formation = "A", ratioLabel = "50-20-30"): Team {
  return {
    id,
    mains: [formation, "Mia", "Bradley"],
    joiners: [`variant-${id}`, "Seo-yoon", "Lumak", "Ling"],
    ratioLabel,
    troops: { infantry_t10: 50, lancer_t10: 20, marksman_t10: 30 }
  };
}

function options(overrides: Partial<BenchmarkFinalsOptions> = {}): BenchmarkFinalsOptions {
  return {
    screenTopM: 10000,
    screenReps: 2,
    benchmarkTopM: 1000,
    benchmarkSize: 1,
    finalsTopM: 1000,
    finalsReps: 4,
    refinementTopM: 0,
    refinementReps: 0,
    jobs: 2,
    batchSize: 2,
    seed: 100,
    ...overrides
  };
}

function result(task: BattleTask, attackerWins: number, margin: number, defenderWins = task.reps - attackerWins): BattleSummary {
  return {
    attackerId: task.attacker.id,
    defenderId: task.defender.id,
    games: task.reps,
    attackerWins,
    defenderWins,
    avgAttackerLeft: Math.max(0, margin),
    avgDefenderLeft: Math.max(0, -margin)
  };
}

function model(outcome: (task: BattleTask) => BattleSummary): BattleTaskRunner {
  return async (tasks) => tasks.map(outcome);
}

for (const [sourceSize, panelSize, expected] of [
  [200, 60, [36, 18, 6]],
  [1000, 200, [120, 60, 20]]
] as const) {
  test(`proportional panel assigns exact formation quotas for ${panelSize} seats`, () => {
    const source = Array.from({ length: sourceSize }, (_, index) => team(index, index < sourceSize * 0.6 ? "A" : index < sourceSize * 0.9 ? "B" : "C"));
    const panel = selectProportionalPanel(source, sourceSize, panelSize);
    assert.deepEqual(["A", "B", "C"].map((formation) => panel.filter((entry) => entry.mains[0] === formation).length), expected);
    assert.deepEqual(panel.map((entry) => entry.id), [
      ...Array.from({ length: expected[0] }, (_, index) => index),
      ...Array.from({ length: expected[1] }, (_, index) => sourceSize * 0.6 + index),
      ...Array.from({ length: expected[2] }, (_, index) => sourceSize * 0.9 + index)
    ]);
  });
}

test("largest-remainder ties follow first source rank and preserve ranked return order", () => {
  const source = [team(8, "B"), team(3, "A"), team(9, "C"), team(1, "A"), team(2, "B"), team(4, "C")];
  assert.deepEqual(selectProportionalPanel(source, 6, 2).map((entry) => entry.id), [8, 3]);
  assert.deepEqual(selectProportionalPanel(source, 6, 4).map((entry) => entry.id), [8, 3, 9, 2]);
});

test("formation identity includes ordered mains and ratio, but not joiner variants", () => {
  const a = team(1);
  const swapped = { ...team(2), mains: ["Mia", "A", "Bradley"] as Team["mains"] };
  const ratio = team(3, "A", "60-10-30");
  const source = [a, swapped, ratio, team(4), team(5), team(6)];
  // Four variants of the same trio+ratio receive two seats; the other two
  // formations tie for the remaining seat, resolved by the earlier swapped trio.
  assert.deepEqual(selectProportionalPanel(source, 6, 3).map((entry) => entry.id), [1, 2, 4]);
});

test("panels clamp to the source prefix without a within-formation candidate cap", () => {
  const source = Array.from({ length: 250 }, (_, index) => team(index));
  assert.deepEqual(selectProportionalPanel(source, 3, 100).map((entry) => entry.id), [0, 1, 2]);
  assert.deepEqual(selectProportionalPanel(source, 1000, 200).map((entry) => entry.id), Array.from({ length: 200 }, (_, index) => index));
  assert.throws(() => selectProportionalPanel([], 10, 5), /empty category/);
  for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => selectProportionalPanel(source, invalid, 5), /sourceTopM/);
    assert.throws(() => selectProportionalPanel(source, 5, invalid), /panelSize/);
  }
});

test("duplicate builds do not consume panel quotas or screening places", async () => {
  const first = team(1, "A");
  const duplicate = { ...first, id: 99, joiners: [...first.joiners].reverse() as Team["joiners"] };
  const source = [first, duplicate, team(2, "B"), team(3, "B"), team(4, "B")];
  assert.deepEqual(selectProportionalPanel(source, 4, 2).map(entry => entry.id), [1, 2]);
  const stages: BenchmarkStage[] = [];
  const [attack] = await runBenchmarkFinals(
    source, [team(11)],
    options({ screenTopM: 2, finalsTopM: 2 }),
    model(task => result(task, task.attacker.id === 2 ? task.reps : 0, task.attacker.id === 2 ? 10 : -10)),
    undefined, stage => stages.push(stage)
  );
  assert.deepEqual(attack.teamsFinalOrdered.map(entry => entry.id), [2, 1]);
  assert.deepEqual(stages.map(stage => stage.games), [6, 12]);
});

test("benchmark scores exclude incidental opponent appearances including panel intersections", async () => {
  const stages: BenchmarkStage[] = [];
  const outcomes: Record<string, [number, number]> = {
    "1:11": [0.5, 5],
    "2:11": [1, 30],
    "1:12": [0, -20],
    "2:12": [0.25, -10]
  };
  const runner = model((task) => {
    const [rate, margin] = outcomes[`${task.attacker.id}:${task.defender.id}`];
    return result(task, rate * task.reps, margin);
  });
  const [attack, defense] = await runBenchmarkFinals([team(1), team(2)], [team(11), team(12)], options({ screenReps: 4 }), runner, undefined, (stage) => stages.push(stage));
  const screen = stages[0];
  assert.equal(winRate(screen.attackPool.getScore(1)), 0.5);
  assert.equal(avgMargin(screen.attackPool.getScore(1)), 5);
  assert.equal(screen.attackPool.getScore(1).games, 4);
  assert.equal(winRate(screen.defensePool.getScore(11)), 0.5);
  assert.equal(avgMargin(screen.defensePool.getScore(11)), -5);
  assert.equal(screen.defensePool.getScore(11).games, 4);
  assert.equal(screen.games, 16);
  assert.deepEqual(attack.teamsFinalOrdered.map((entry) => entry.id), [2, 1]);
  assert.deepEqual(defense.teamsFinalOrdered.map((entry) => entry.id), [12, 11]);
  assert.equal(winRate(attack.getScore(2)), 0.25);
  assert.equal(winRate(defense.getScore(12)), 0.75);
  assert.equal(attack.getScore(2).games, 4);
  assert.equal(defense.getScore(12).games, 4);
});

test("common opponents give equal weight and use only own-side win rates and margins", async () => {
  const stages: BenchmarkStage[] = [];
  const outcomes: Record<string, [number, number]> = {
    "1:11": [1, 20], "1:12": [0, -10], "1:13": [0.5, 0],
    "2:11": [0.5, 8], "2:12": [0.5, 8], "2:13": [0.5, 0],
    "3:11": [0, -50], "3:12": [1, 10], "3:13": [0.5, 0]
  };
  await runBenchmarkFinals([team(1), team(2), team(3)], [team(11), team(12), team(13)], options({ benchmarkSize: 2, screenReps: 4 }), model((task) => {
    const [rate, margin] = outcomes[`${task.attacker.id}:${task.defender.id}`];
    return result(task, task.reps * rate, margin);
  }), undefined, (stage) => stages.push(stage));
  const screen = stages[0];
  assert.deepEqual(screen.attackPool.teamsFinalOrdered.map((entry) => entry.id), [2, 1, 3]);
  assert.equal(winRate(screen.attackPool.getScore(2)), 0.5);
  assert.equal(avgMargin(screen.attackPool.getScore(2)), 8);
  assert.equal(avgMargin(screen.attackPool.getScore(1)), 5);
  assert.deepEqual(screen.defensePool.teamsFinalOrdered.map((entry) => entry.id), [12, 13, 11]);
  assert.equal(winRate(screen.defensePool.getScore(12)), 0.75);
  assert.equal(screen.attackPool.getScore(2).games, 8);
  assert.equal(screen.defensePool.getScore(12).games, 8);
  assert.equal(screen.games, 48);
});

test("screen winners promote into finals and rebuild panels from screening ranks", async () => {
  const stages: BenchmarkStage[] = [];
  const outcomes: Record<string, [number, number]> = {
    "1:11": [0.5, 0], "2:11": [1, 30], "3:11": [0, -30],
    "1:12": [0, -20], "1:13": [1, 20], "2:12": [0, -40]
  };
  const [attack, defense] = await runBenchmarkFinals([team(1), team(2), team(3)], [team(11), team(12), team(13)], options({ benchmarkTopM: 1, finalsTopM: 1 }), model((task) => {
    const [rate, margin] = outcomes[`${task.attacker.id}:${task.defender.id}`];
    return result(task, task.reps * rate, margin);
  }), undefined, (stage) => stages.push(stage));
  assert.deepEqual(stages.map((stage) => stage.name), ["screening", "reranking"]);
  assert.deepEqual(stages[0].attackPanel.map((entry) => entry.id), [1]);
  assert.deepEqual(stages[0].defensePanel.map((entry) => entry.id), [11]);
  assert.deepEqual(stages[1].attackPanel.map((entry) => entry.id), [2]);
  assert.deepEqual(stages[1].defensePanel.map((entry) => entry.id), [12]);
  assert.deepEqual(attack.teamsFinalOrdered.map((entry) => entry.id), [2]);
  assert.deepEqual(defense.teamsFinalOrdered.map((entry) => entry.id), [12]);
  assert.equal(winRate(attack.getScore(2)), 0);
  assert.equal(avgMargin(attack.getScore(2)), -40);
  assert.equal(winRate(defense.getScore(12)), 1);
  assert.equal(stages[1].games, 8);
});

test("all same-formation candidates remain eligible beyond a shell cap", async () => {
  const attackers = Array.from({ length: 70 }, (_, index) => team(index + 1));
  const [attack] = await runBenchmarkFinals(attackers, [team(100)], options(), model((task) => result(task, task.attacker.id === 70 ? task.reps : 0, task.attacker.id === 70 ? 10 : -10)));
  assert.deepEqual(attack.teamsFinalOrdered.map((entry) => entry.id), [70, ...Array.from({ length: 69 }, (_, index) => index + 1)]);
  assert.equal(winRate(attack.getScore(70)), 1);
  assert.equal(attack.getScore(1).games, 4);
});

test("refinement pools unequal rep counts, keeps fixed panels and globally reranks all candidates", async () => {
  const attackers = [team(1), team(2), team(3)];
  const defenders = [team(11), team(12), team(13)];
  const runOptions = options({ screenReps: 1, finalsReps: 4, refinementTopM: 2, refinementReps: 12, jobs: 1, batchSize: 2 });
  async function execute() {
    const stages: BenchmarkStage[] = [];
    const seeds: string[] = [];
    const progress: Array<[string, number, number, number]> = [];
    let maxChunk = 0;
    const runner: BattleTaskRunner = async (tasks, _jobs, onProgress) => {
      maxChunk = Math.max(maxChunk, tasks.length);
      const results = tasks.map((task) => {
        for (let index = 0; index < task.reps; index += 1) seeds.push(index === 0 ? String(task.seed) : `${task.seed}#${index}`);
        const key = `${task.attacker.id}:${task.defender.id}`;
        if (task.reps === 1) {
          const outcomes: Record<string, [number, number, number]> = {
            "1:11": [0, 0, 0], "2:11": [0, -10, 1], "3:11": [0, -20, 1],
            "1:12": [1, 10, 0], "1:13": [1, 20, 0]
          };
          const [wins, margin, defenderWins] = outcomes[key];
          return result(task, wins, margin, defenderWins);
        }
        if (task.reps === 4) {
          const outcomes: Record<string, [number, number]> = {
            "1:11": [2, 0], "2:11": [4, 20], "3:11": [3, 10],
            "1:12": [1, -10], "1:13": [0, -20]
          };
          const [wins, margin] = outcomes[key];
          return result(task, wins, margin);
        }
        return result(task, task.defender.id === 11 ? 0 : task.reps, task.defender.id === 11 ? -40 : 40);
      });
      onProgress?.(tasks.length, tasks.length);
      return results;
    };
    const pools = await runBenchmarkFinals(attackers, defenders, runOptions, runner, (label, completed, total, battlesCompleted) => progress.push([label, completed, total, battlesCompleted]), (stage) => stages.push(stage));
    return { pools, stages, seeds, progress, maxChunk };
  }
  const first = await execute();
  const [attack, defense] = first.pools;
  assert.deepEqual(first.stages[1].attackPool.teamsFinalOrdered.map((entry) => entry.id), [2, 3, 1]);
  assert.deepEqual(first.stages[1].defensePool.teamsFinalOrdered.map((entry) => entry.id), [13, 12, 11]);
  assert.deepEqual(attack.teamsFinalOrdered.map((entry) => entry.id), [1, 2, 3]);
  assert.deepEqual(defense.teamsFinalOrdered.map((entry) => entry.id), [11, 13, 12]);
  assert.equal(winRate(attack.getScore(2)), 4 / 16);
  assert.equal(winRate(attack.getScore(3)), 3 / 16);
  assert.equal(winRate(defense.getScore(13)), 4 / 16);
  assert.equal(avgMargin(attack.getScore(2)), -25);
  assert.equal(avgMargin(defense.getScore(12)), -27.5);
  assert.equal(attack.getScore(1).games, 4);
  assert.equal(attack.getScore(2).games, 16);
  assert.equal(defense.getScore(11).games, 4);
  assert.equal(defense.getScore(12).games, 16);
  assert.equal(first.stages[1].attackPool.getScore(2).games, 4);
  assert.deepEqual(first.stages.map((stage) => stage.games), [6, 24, 48]);
  assert.deepEqual(first.stages[2].attackPanel.map((entry) => entry.id), [1]);
  assert.deepEqual(first.stages[2].defensePanel.map((entry) => entry.id), [11]);
  assert.equal(new Set(first.seeds).size, 78);
  assert.equal(first.maxChunk, 2);
  assert.deepEqual(first.progress.filter((entry) => entry[1] === 0), [
    ["Benchmark screening", 0, 6, 0], ["Benchmark reranking", 0, 6, 0], ["Benchmark refinement", 0, 4, 0]
  ]);
  assert.deepEqual(first.progress.at(-1), ["Benchmark refinement", 4, 4, 48]);
  assert.deepEqual(
    ["Benchmark screening", "Benchmark reranking", "Benchmark refinement"].map(label =>
      first.progress.find(entry => entry[0] === label && entry[1] === entry[2])?.[3]
    ),
    [6, 24, 48]
  );
  const second = await execute();
  assert.deepEqual(second.seeds, first.seeds);
  assert.deepEqual(second.pools.map((pool) => pool.finalScoresOrdered.map((score) => [score.team.id, winRate(score), avgMargin(score), score.games])), first.pools.map((pool) => pool.finalScoresOrdered.map((score) => [score.team.id, winRate(score), avgMargin(score), score.games])));
});

test("multiple fixed opponents retain equal exposure after unequal refinement batches", async () => {
  const stages: BenchmarkStage[] = [];
  const [attack, defense] = await runBenchmarkFinals([team(1)], [team(11), team(12)], options({
    benchmarkSize: 2, finalsReps: 4, refinementTopM: 2, refinementReps: 12
  }), model((task) => {
    if (task.reps === 12) return result(task, task.defender.id === 11 ? 0 : 6, task.defender.id === 11 ? -20 : 4);
    return result(task, task.defender.id === 11 ? task.reps : 0, task.defender.id === 11 ? 12 : -8);
  }), undefined, (stage) => stages.push(stage));
  assert.equal(winRate(attack.getScore(1)), 10 / 32);
  assert.equal(avgMargin(attack.getScore(1)), -5.5);
  assert.equal(attack.getScore(1).games, 32);
  assert.equal(attack.getScore(1).matches, 2);
  assert.deepEqual(defense.teamsFinalOrdered.map((entry) => entry.id), [11, 12]);
  assert.equal(winRate(defense.getScore(11)), 0.75);
  assert.equal(winRate(defense.getScore(12)), 0.625);
  assert.equal(stages[2].games, 48);
  assert.deepEqual(stages[2].defensePanel.map((entry) => entry.id), stages[1].defensePanel.map((entry) => entry.id));
});

test("exact score ties retain source rank across stages and replay ID remapping", async () => {
  const attackers = [team(10), team(1), team(20)];
  const defenders = [team(110), team(101), team(120)];
  const runOptions = options({ benchmarkSize: 2, finalsTopM: 2, refinementTopM: 1, refinementReps: 6 });
  const runner = model((task) => result(task, task.reps / 2, 0));
  const originalStages: BenchmarkStage[] = [];
  const replayStages: BenchmarkStage[] = [];
  const original = await runBenchmarkFinals(attackers, defenders, runOptions, runner, undefined, (stage) => originalStages.push(stage));
  const replay = await runBenchmarkFinals(
    attackers.map((entry, index) => ({ ...entry, id: [999, 3, 1001][index] })),
    defenders.map((entry, index) => ({ ...entry, id: [1, 888, 777][index] })),
    runOptions, runner, undefined, (stage) => replayStages.push(stage)
  );
  assert.deepEqual(original[0].teamsFinalOrdered.map((entry) => entry.joiners[0]), ["variant-10", "variant-1"]);
  assert.deepEqual(original[1].teamsFinalOrdered.map((entry) => entry.joiners[0]), ["variant-110", "variant-101"]);
  assert.deepEqual(replay.map((pool) => pool.teamsFinalOrdered.map((entry) => entry.joiners[0])), original.map((pool) => pool.teamsFinalOrdered.map((entry) => entry.joiners[0])));
  assert.deepEqual(replayStages.map((stage) => [stage.attackPanel.map((entry) => entry.joiners[0]), stage.defensePanel.map((entry) => entry.joiners[0])]), originalStages.map((stage) => [stage.attackPanel.map((entry) => entry.joiners[0]), stage.defensePanel.map((entry) => entry.joiners[0])]));
  assert.equal(winRate(replay[0].getScore(999)), 0.5);
  assert.equal(avgMargin(replay[0].getScore(999)), 0);
  assert.equal(replay[0].getScore(999).games, 20);
  assert.equal(replay[0].getScore(3).games, 8);
});

test("invalid API sizes and empty categories reject before evaluating battles", async () => {
  const runner = model((task) => result(task, task.reps, 10));
  await assert.rejects(runBenchmarkFinals([], [team(2)], options(), runner), /attackers category must not be empty/);
  await assert.rejects(runBenchmarkFinals([team(1)], [], options(), runner), /defenders category must not be empty/);
  for (const name of ["screenTopM", "screenReps", "benchmarkTopM", "benchmarkSize", "finalsTopM", "finalsReps", "jobs", "batchSize"] as const) {
    await assert.rejects(runBenchmarkFinals([team(1)], [team(2)], options({ [name]: 0 }), runner), new RegExp(name));
  }
  await assert.rejects(runBenchmarkFinals([team(1)], [team(2)], options({ refinementReps: -1 }), runner), /refinementReps/);
  await assert.rejects(runBenchmarkFinals([team(1), team(1)], [team(2)], options(), runner), /duplicate team ids/);
});
