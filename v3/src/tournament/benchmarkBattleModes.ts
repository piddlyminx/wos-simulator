import { loadSimulatorConfig } from "../config.js";
import { simulateBattle } from "../simulator.js";
import type { BattleResult, SimulationDetail, SimulatorConfig } from "../types.js";
import { generateTeams, parseRatio } from "./teamGeneration.js";
import { teamToBattleInput } from "./teamInput.js";
import type { BattleTask } from "./types.js";

interface BenchmarkSummary {
  battles: number;
  elapsedMs: number;
  msPerBattle: number;
  averageRounds: number;
  averageAttackOutcomes?: number;
}

const battleCount = parseBattleCount(process.argv[2] ?? "60");
const config = loadSimulatorConfig();
const tasks = buildTasks(battleCount);

const full = benchmark(tasks, config, "full");
const fast = benchmark(tasks, config, "fast");

printSummary("full", full);
printSummary("fast", fast);

function benchmark(tasks: BattleTask[], config: SimulatorConfig, detail: SimulationDetail): BenchmarkSummary {
  let totalRounds = 0;
  let totalAttackOutcomes = 0;
  const start = Date.now();
  for (const task of tasks) {
    for (let rep = 0; rep < task.reps; rep += 1) {
      const input = teamToBattleInput(task.attacker, task.defender, task.seed + rep, config);
      const result: BattleResult = simulateBattle(input, config, { detail });
      totalRounds += result.rounds;
      totalAttackOutcomes += result.attacks.length;
    }
  }
  const elapsedMs = Date.now() - start;
  const battles = tasks.reduce((sum, task) => sum + task.reps, 0);
  return {
    battles,
    elapsedMs,
    msPerBattle: elapsedMs / battles,
    averageRounds: totalRounds / battles,
    averageAttackOutcomes: detail === "full" ? totalAttackOutcomes / battles : undefined
  };
}

function buildTasks(count: number): BattleTask[] {
  const teams = generateTeams([["50,20,30", parseRatio("50,20,30", 1000)]], true).slice(0, Math.max(2, Math.ceil(Math.sqrt(count)) + 1));
  const tasks: BattleTask[] = [];
  let seed = 20260523;
  for (const attacker of teams) {
    for (const defender of teams) {
      if (attacker.id === defender.id) continue;
      tasks.push({ attacker, defender, seed, reps: 1 });
      seed += 1;
      if (tasks.length >= count) return tasks;
    }
  }
  if (tasks.length === 0) throw new Error(`No benchmark tasks could be built from ${teams.length} teams`);
  return tasks;
}

function parseBattleCount(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Battle count must be a positive integer, got ${JSON.stringify(value)}`);
  return parsed;
}

function printSummary(label: SimulationDetail, summary: BenchmarkSummary): void {
  const fields = [
    `${label}:`,
    `battles=${summary.battles}`,
    `elapsed_ms=${summary.elapsedMs.toFixed(2)}`,
    `ms_per_battle=${summary.msPerBattle.toFixed(3)}`,
    `avg_rounds=${summary.averageRounds.toFixed(2)}`
  ];
  if (summary.averageAttackOutcomes !== undefined) fields.push(`avg_attack_outcomes=${summary.averageAttackOutcomes.toFixed(2)}`);
  console.log(fields.join(" "));
}
