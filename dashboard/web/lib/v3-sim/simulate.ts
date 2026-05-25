import { loadSimulatorConfig } from "@v3/config";
import { simulateBattle } from "@v3/simulator";
import type { AppliedEffectTrace, AttackOutcome, BattleResult, SimulatorConfig, UnitType } from "@v3/types";
import type {
  SimulateApiResult,
  SimulateOutcomeRun,
  SimulateRequestPayload,
  SimulateSkillSummary,
  SimulateTrace,
  SimulateTraceEffect,
  SimulateTraceUnit,
} from "@/lib/simulate-run";
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
  const outcomeRuns: SimulateOutcomeRun[] = [];
  for (let index = 0; index < total; index += 1) {
    const seed = `${options.seedBase ?? "dashboard"}:${index}`;
    const result = simulateBattle(toBattleInput(request, seed), config);
    results.push(result);
    outcomeRuns.push({ outcome: signedOutcome(result), seed });
    if ((index + 1) % Math.max(1, Math.floor(total / 20)) === 0 || index + 1 === total) {
      options.onProgress?.(index + 1, total);
    }
  }
  return { ...aggregateBattleResults(results), outcome_runs: outcomeRuns };
}

export function runSimulationTraceInV3(
  request: SimulateRequestPayload,
  seed: string | number,
  options: RunSimulationOptions = {},
): SimulateTrace {
  const config = options.config ?? loadSimulatorConfig();
  const result = simulateBattle({ ...toBattleInput(request, seed), trace: true }, config, { detail: "full" });
  options.onProgress?.(1, 1);
  return battleResultToTrace(result, seed);
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
      entry.kills += row.skillKills;
      totals.set(row.skillName, entry);
    }
  }
  return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => ({
    name,
    avg_activations: value.activations / Math.max(1, results.length),
    avg_kills: value.kills / Math.max(1, results.length),
  }));
}

export function battleResultToTrace(result: BattleResult, seed: string | number): SimulateTrace {
  const attacksByRound = attacksGroupedByRound(result);
  const rounds = (result.trace?.rounds ?? []).map((roundTrace) => {
    const sideRounds = {
      attacker: emptySideRound(roundTrace.roundStartTroops.attacker),
      defender: emptySideRound(roundTrace.roundStartTroops.defender),
    };
    for (const attack of attacksByRound.get(roundTrace.round) ?? []) {
      const sourceUnit = traceUnit(attack.attackerUnit);
      const targetUnit = traceUnit(attack.defenderUnit);
      sideRounds[attack.attackerSide].kills[sourceUnit][targetUnit] += attack.kills;
      for (const effect of uniqueEffects(attack.appliedEffects)) {
        sideRounds[attack.attackerSide].effects.push(traceEffect(effect, attack, 1));
      }
    }
    return { round: roundTrace.round, attacker: sideRounds.attacker, defender: sideRounds.defender };
  });

  return {
    seed,
    outcome: signedOutcome(result),
    rounds,
    skill_kills: skillKills(result),
    effect_usage: effectUsage(result),
    total_kills: totalKills(result),
  };
}

function attacksGroupedByRound(result: BattleResult): Map<number, AttackOutcome[]> {
  const roundsByJob = new Map<string, number>();
  for (const round of result.trace?.rounds ?? []) {
    for (const job of round.jobs) roundsByJob.set(job.id, round.round);
  }
  const grouped = new Map<number, AttackOutcome[]>();
  for (const attack of result.attacks) {
    const round = roundsByJob.get(attack.jobId);
    if (round === undefined) continue;
    const list = grouped.get(round) ?? [];
    list.push(attack);
    grouped.set(round, list);
  }
  return grouped;
}

function emptySideRound(troops: Record<UnitType, number>): SimulateTrace["rounds"][number]["attacker"] {
  return {
    troops: {
      inf: troops.infantry ?? 0,
      lanc: troops.lancer ?? 0,
      mark: troops.marksman ?? 0,
    },
    kills: emptyKillMatrix(),
    effects: [],
  };
}

function emptyKillMatrix(): Record<SimulateTraceUnit, Record<SimulateTraceUnit, number>> {
  return {
    inf: { inf: 0, lanc: 0, mark: 0 },
    lanc: { inf: 0, lanc: 0, mark: 0 },
    mark: { inf: 0, lanc: 0, mark: 0 },
  };
}

function totalKills(result: BattleResult): SimulateTrace["total_kills"] {
  const totals = { attacker: emptyKillMatrix(), defender: emptyKillMatrix() };
  for (const attack of result.attacks) {
    totals[attack.attackerSide][traceUnit(attack.attackerUnit)][traceUnit(attack.defenderUnit)] += attack.kills;
  }
  return totals;
}

function skillKills(result: BattleResult): SimulateTrace["skill_kills"] {
  const grouped: SimulateTrace["skill_kills"] = { attacker: {}, defender: {} };
  for (const side of ["attacker", "defender"] as const) {
    for (const row of result.skillReport[side]) {
      const kills = row.skillKills;
      const triggers = row.triggersSeen;
      if (kills <= 0 && triggers <= 0) continue;
      const hero = row.heroName ?? (row.troopType ? unitLabel(row.troopType) : "Troop skill");
      const heroRows = grouped[side][hero] ?? {};
      const existing = heroRows[row.skillName] ?? { triggers: 0, kills: 0 };
      heroRows[row.skillName] = {
        triggers: existing.triggers + triggers,
        kills: existing.kills + kills,
      };
      grouped[side][hero] = heroRows;
    }
  }
  return grouped;
}

function effectUsage(result: BattleResult): SimulateTrace["effect_usage"] {
  const grouped: SimulateTrace["effect_usage"] = { attacker: {}, defender: {} };
  for (const attack of result.attacks) {
    for (const effect of uniqueEffects(attack.appliedEffects)) {
      const unit = unitLabel(attack.attackerUnit);
      const unitRows = grouped[attack.attackerSide][unit] ?? {};
      unitRows[effectLabel(effect)] = (unitRows[effectLabel(effect)] ?? 0) + 1;
      grouped[attack.attackerSide][unit] = unitRows;
    }
  }
  return grouped;
}

function traceEffect(effect: AppliedEffectTrace, attack: AttackOutcome, uses: number): SimulateTraceEffect {
  const sourceParts = effect.source.split("/");
  const hero = sourceParts[0] || unitLabel(attack.attackerUnit);
  const skillName = sourceParts[1] || effect.effectId;
  return {
    id: `${effect.effectId}:${effect.bucket}:${effect.source}`,
    hero,
    skill_name: skillName,
    effect_name: effect.effectId,
    effect_type: effect.bucket,
    benefit_on: effect.bucket,
    extra_attack: attack.kind === "skill",
    used: true,
    uses_count: uses,
    trigger_count: uses,
    value: effect.valuePct,
    for_units: [traceUnit(attack.attackerUnit)],
    vs_units: [traceUnit(attack.defenderUnit)],
  };
}

function uniqueEffects(effects: AppliedEffectTrace[]): AppliedEffectTrace[] {
  const seen = new Set<string>();
  return effects.filter((effect) => {
    const key = `${effect.effectId}:${effect.bucket}:${effect.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function effectLabel(effect: AppliedEffectTrace): string {
  return `${effect.source}/${effect.effectId}`;
}

function traceUnit(unit: UnitType): SimulateTraceUnit {
  if (unit === "infantry") return "inf";
  if (unit === "lancer") return "lanc";
  return "mark";
}

function unitLabel(unit: UnitType): string {
  if (unit === "infantry") return "Infantry";
  if (unit === "lancer") return "Lancers";
  return "Marksmen";
}

function totalSide(side: Record<string, number>): number {
  return Object.values(side).reduce((sum, value) => sum + Math.ceil(value), 0);
}

function winnerFor(value: number): "attacker" | "defender" | "draw" {
  if (value > 0) return "attacker";
  if (value < 0) return "defender";
  return "draw";
}
