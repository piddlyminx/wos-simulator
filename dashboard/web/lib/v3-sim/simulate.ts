import { loadSimulatorConfig } from "@v3/config";
import { simulateBattle } from "@v3/simulator";
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
      entry.kills += result.attacks
        .filter((attack) => attack.appliedEffects.some((effect) => effect.source.includes(row.skillId)))
        .reduce((sum, attack) => sum + attack.kills, 0);
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
