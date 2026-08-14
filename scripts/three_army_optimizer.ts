#!/usr/bin/env tsx
import { readFileSync } from "node:fs";
import { cpus } from "node:os";
import { pathToFileURL } from "node:url";

import { BattleInputBuilder } from "../simulator/src/battleInputBuilder";
import { loadSimulatorConfig } from "../simulator/src/config-node";
import { removeHeroGenerationStats } from "../simulator/src/fighterResolution";
import { simulateBattles } from "../simulator/src/simulator";
import { BatchWorkerPool } from "../simulator/src/workerPool";
import type {
  BattleResult,
  FighterInput,
  HeroInputEntry,
  SimulatorConfig,
  SkillFile,
  UnitType
} from "../simulator/src/types";
import { WorkerThreadBatchWorker } from "./workerThreadBatchWorker";

export type TeamSide = "attacker" | "defender";

export interface ArmyDefinition {
  name: string;
  fighter: FighterInput;
}

export interface HeroPools {
  infantry: string[];
  lancer: string[];
  marksman: string[];
}

export interface OptimizationDefinition {
  side: TeamSide;
  hero_pools?: HeroPools;
  per_army_hero_pools?: [HeroPools, HeroPools, HeroPools];
  hero_skill_levels: number[];
  unique_heroes?: boolean;
}

export interface TroopOptimizationDefinition {
  coarse_step_percent: number;
  fine_step_percent: number;
  fine_radius_percent: number;
  passes: number;
}

export interface ThreeArmyDefinition {
  attacker: [ArmyDefinition, ArmyDefinition, ArmyDefinition];
  defender: [ArmyDefinition, ArmyDefinition, ArmyDefinition];
  max_rounds?: number;
  input_stats_include_hero_generation: Record<TeamSide, boolean>;
  optimization?: OptimizationDefinition;
  troop_optimization?: TroopOptimizationDefinition;
}

export interface MatchResult {
  winner: TeamSide | "draw";
  attackerRemaining: number;
  defenderRemaining: number;
  battles: number;
}

export interface EvaluationResult {
  scenarios: number;
  attackerWins: number;
  defenderWins: number;
  draws: number;
  attackerWinRate: number;
  defenderWinRate: number;
  averageAttackerRemaining: number;
  averageDefenderRemaining: number;
  averageAttackerMargin: number;
  averageBattles: number;
}

export interface OptimizationResult {
  rank: number;
  heroes: string[][];
  evaluation: EvaluationResult;
  winRate: number;
  scoreRate: number;
  averageMargin: number;
}

export interface TroopCounts {
  infantry: number;
  lancer: number;
  marksman: number;
  total: number;
}

export interface TroopOptimizationResult {
  side: TeamSide;
  heroes: string[][];
  initialTroops: TroopCounts[];
  troops: TroopCounts[];
  initialEvaluation: EvaluationResult;
  evaluation: EvaluationResult;
  winRate: number;
  scoreRate: number;
  averageMargin: number;
  evaluatedCandidates: number;
  search: TroopOptimizationDefinition;
}

export interface TroopOptimizationProgress {
  stage: "coarse" | "fine";
  pass: number;
  armyIndex: number;
  completed: number;
  total: number;
}

interface CliOptions {
  command: "simulate" | "optimize";
  configPath: string;
  reps: number;
  seed: number;
  top: number;
  maxCandidates: number;
  jobs: number;
  json: boolean;
}

export interface OptimizationWorkerTask {
  definition: ThreeArmyDefinition;
  heroes: string[][];
  side: TeamSide;
  reps: number;
  seed: number;
}

interface MutableArmy {
  name: string;
  slot: number;
  fighter: FighterInput;
}

type Order = readonly [number, number, number];
type BattleResolver = (attacker: FighterInput, defender: FighterInput, seed: string) => BattleResult;

const UNIT_TYPES: UnitType[] = ["infantry", "lancer", "marksman"];
const ORDERS = permutations([0, 1, 2]) as unknown as Order[];

export function parseDefinition(raw: unknown, simulatorConfig: SimulatorConfig): ThreeArmyDefinition {
  if (!isRecord(raw)) throw new Error("Configuration must be a JSON object");
  const attacker = parseArmies(raw.attacker, "attacker", simulatorConfig);
  const defender = parseArmies(raw.defender, "defender", simulatorConfig);
  const maxRounds = raw.max_rounds === undefined ? 600 : positiveInteger(raw.max_rounds, "max_rounds");
  if (raw.engagement_type !== undefined) {
    throw new Error("This three-army mode is not a rally or garrison; remove engagement_type");
  }
  if (raw.add_hero_generation_stats !== undefined) {
    throw new Error("add_hero_generation_stats has been replaced by input_stats_include_hero_generation");
  }
  const inputStatsIncludeHeroGeneration = parseInputStatsProvenance(raw.input_stats_include_hero_generation);
  const optimization = raw.optimization === undefined ? undefined : parseOptimization(raw.optimization, simulatorConfig);
  const troopOptimization = raw.troop_optimization === undefined
    ? undefined
    : parseTroopOptimization(raw.troop_optimization);
  if (troopOptimization && !optimization) {
    throw new Error("troop_optimization requires optimization so there is a winning hero setup to refine");
  }
  for (const side of ["attacker", "defender"] as const) {
    if (!inputStatsIncludeHeroGeneration[side]) continue;
    const armies = side === "attacker" ? attacker : defender;
    for (const [index, army] of armies.entries()) {
      if (!army.fighter.stats || mainHeroNames(army.fighter).length !== 3) {
        throw new Error(
          `${side}[${index}] must specify its input stats and three original main heroes because its input stats include hero generation`
        );
      }
    }
  }
  return {
    attacker,
    defender,
    max_rounds: maxRounds,
    input_stats_include_hero_generation: inputStatsIncludeHeroGeneration,
    ...(optimization ? { optimization } : {}),
    ...(troopOptimization ? { troop_optimization: troopOptimization } : {})
  };
}

export function simulateThreeArmyMatch(
  definition: ThreeArmyDefinition,
  simulatorConfig: SimulatorConfig,
  attackerOrder: Order,
  defenderOrder: Order,
  seed: string,
  resolveBattle?: BattleResolver
): MatchResult {
  const normalizedDefinition = normalizeDefinitionHeroStats(definition, simulatorConfig);
  const attacker = orderedArmies(normalizedDefinition.attacker, attackerOrder);
  const defender = orderedArmies(normalizedDefinition.defender, defenderOrder);
  const battleResolver = resolveBattle ?? createBattleResolver(normalizedDefinition, simulatorConfig);
  let battles = 0;

  const fight = (left: MutableArmy, right: MutableArmy): "ok" | "draw" => {
    const result = battleResolver(left.fighter, right.fighter, `${seed}:battle:${battles}`);
    battles += 1;
    if (result.winner === "draw") {
      left.fighter = withRemainingTroops(left.fighter, result.remaining.attacker, simulatorConfig);
      right.fighter = withRemainingTroops(right.fighter, result.remaining.defender, simulatorConfig);
      return "draw";
    }
    if (result.winner === "attacker") {
      left.fighter = withRemainingTroops(left.fighter, result.remaining.attacker, simulatorConfig);
      removeArmy(defender, right);
    } else {
      right.fighter = withRemainingTroops(right.fighter, result.remaining.defender, simulatorConfig);
      removeArmy(attacker, left);
    }
    return "ok";
  };

  // Opening fights are paired by the random slot assigned to each army.
  for (let slot = 1; slot <= 3; slot += 1) {
    const left = attacker.find((army) => army.slot === slot);
    const right = defender.find((army) => army.slot === slot);
    if (!left || !right) throw new Error(`Internal error: missing opening army in slot ${slot}`);
    if (fight(left, right) === "draw") return drawResult(attacker, defender, battles);
  }

  // Thereafter, the lowest-numbered live armies meet until one team is eliminated.
  while (attacker.length > 0 && defender.length > 0) {
    attacker.sort(bySlot);
    defender.sort(bySlot);
    if (fight(attacker[0], defender[0]) === "draw") return drawResult(attacker, defender, battles);
  }

  return {
    winner: attacker.length > 0 ? "attacker" : defender.length > 0 ? "defender" : "draw",
    attackerRemaining: remainingForTeam(attacker),
    defenderRemaining: remainingForTeam(defender),
    battles
  };
}

export function evaluateDefinition(
  definition: ThreeArmyDefinition,
  simulatorConfig: SimulatorConfig,
  reps: number,
  seed: number,
  resolveBattle?: BattleResolver
): EvaluationResult {
  if (!Number.isInteger(reps) || reps < 1) throw new Error("reps must be at least 1");
  const normalizedDefinition = normalizeDefinitionHeroStats(definition, simulatorConfig);
  let attackerWins = 0;
  let defenderWins = 0;
  let draws = 0;
  let attackerRemaining = 0;
  let defenderRemaining = 0;
  let battles = 0;
  let scenario = 0;
  for (const attackerOrder of ORDERS) {
    for (const defenderOrder of ORDERS) {
      for (let rep = 0; rep < reps; rep += 1) {
        const result = simulateThreeArmyMatch(
          normalizedDefinition,
          simulatorConfig,
          attackerOrder,
          defenderOrder,
          `${seed}:scenario:${scenario}:rep:${rep}`,
          resolveBattle
        );
        scenario += 1;
        if (result.winner === "attacker") attackerWins += 1;
        else if (result.winner === "defender") defenderWins += 1;
        else draws += 1;
        attackerRemaining += result.attackerRemaining;
        defenderRemaining += result.defenderRemaining;
        battles += result.battles;
      }
    }
  }
  return {
    scenarios: scenario,
    attackerWins,
    defenderWins,
    draws,
    attackerWinRate: attackerWins / scenario,
    defenderWinRate: defenderWins / scenario,
    averageAttackerRemaining: attackerRemaining / scenario,
    averageDefenderRemaining: defenderRemaining / scenario,
    averageAttackerMargin: (attackerRemaining - defenderRemaining) / scenario,
    averageBattles: battles / scenario
  };
}

export function generateOptimizationCandidates(
  definition: ThreeArmyDefinition,
  simulatorConfig: SimulatorConfig,
  maxCandidates = 100_000
): Array<{ definition: ThreeArmyDefinition; heroes: string[][] }> {
  const optimization = definition.optimization;
  if (!optimization) throw new Error("The configuration has no optimization section");
  const normalizedDefinition = normalizeDefinitionHeroStats(definition, simulatorConfig);
  const sourceArmies = normalizedDefinition[optimization.side];
  const choices = sourceArmies.map((_, armyIndex) =>
    heroLineups(
      optimization.per_army_hero_pools?.[armyIndex] ?? optimization.hero_pools!,
      optimization.hero_skill_levels,
      simulatorConfig
    )
  );
  const output: Array<{ definition: ThreeArmyDefinition; heroes: string[][] }> = [];
  const selected: HeroInputEntry[][] = [];
  const selectedNames = new Set<string>();
  const uniqueHeroes = optimization.unique_heroes ?? true;

  const visit = (armyIndex: number): void => {
    if (armyIndex === sourceArmies.length) {
      const armies = sourceArmies.map((army, index) => ({
        ...army,
        fighter: { ...army.fighter, heroes: selected[index].map(cloneHero) }
      })) as [ArmyDefinition, ArmyDefinition, ArmyDefinition];
      output.push({
        definition: { ...normalizedDefinition, [optimization.side]: armies },
        heroes: selected.map((lineup) => lineup.map((hero) => hero.name))
      });
      if (output.length > maxCandidates) {
        throw new Error(`Optimization exceeds --max-candidates=${maxCandidates}; narrow the hero pools or raise the limit`);
      }
      return;
    }
    for (const lineup of choices[armyIndex]) {
      const normalized = lineup.map((hero) => normalizeHeroName(hero.name));
      if (uniqueHeroes && normalized.some((name) => selectedNames.has(name))) continue;
      selected.push(lineup);
      if (uniqueHeroes) normalized.forEach((name) => selectedNames.add(name));
      visit(armyIndex + 1);
      if (uniqueHeroes) normalized.forEach((name) => selectedNames.delete(name));
      selected.pop();
    }
  };
  visit(0);
  if (output.length === 0) {
    throw new Error("Hero pools produce no valid candidates (unique_heroes may leave too few heroes for three armies)");
  }
  return output;
}

export function optimizeDefinition(
  definition: ThreeArmyDefinition,
  simulatorConfig: SimulatorConfig,
  reps: number,
  seed: number,
  maxCandidates = 100_000,
  onProgress?: (completed: number, total: number) => void
): OptimizationResult[] {
  const optimization = definition.optimization;
  if (!optimization) throw new Error("The configuration has no optimization section");
  const candidates = generateOptimizationCandidates(definition, simulatorConfig, maxCandidates);
  const results = candidates.map((candidate, index) => {
    const evaluation = evaluateDefinition(candidate.definition, simulatorConfig, reps, seed);
    onProgress?.(index + 1, candidates.length);
    return optimizationResult(candidate.heroes, evaluation, optimization.side);
  });
  return rankOptimizationResults(results);
}

export async function optimizeDefinitionParallel(
  definition: ThreeArmyDefinition,
  simulatorConfig: SimulatorConfig,
  reps: number,
  seed: number,
  jobs: number,
  maxCandidates = 100_000,
  onProgress?: (completed: number, total: number) => void
): Promise<OptimizationResult[]> {
  if (jobs <= 1) return optimizeDefinition(definition, simulatorConfig, reps, seed, maxCandidates, onProgress);
  const optimization = definition.optimization;
  if (!optimization) throw new Error("The configuration has no optimization section");
  const candidates = generateOptimizationCandidates(definition, simulatorConfig, maxCandidates);
  const pool = new BatchWorkerPool<OptimizationWorkerTask, OptimizationResult>(
    Math.min(Math.floor(jobs), candidates.length),
    () => new WorkerThreadBatchWorker(new URL("./three_army_optimizer.worker.ts", import.meta.url))
  );
  let completed = 0;
  try {
    const results = await Promise.all(candidates.map(async (candidate) => {
      const result = await pool.runTask({
        definition: candidate.definition,
        heroes: candidate.heroes,
        side: optimization.side,
        reps,
        seed
      });
      completed += 1;
      onProgress?.(completed, candidates.length);
      return result;
    }));
    return rankOptimizationResults(results);
  } finally {
    await pool.close();
  }
}

export function generateTroopCompositions(total: number, stepPercent: number): TroopCounts[] {
  const safeTotal = Math.floor(total);
  if (safeTotal < 1) throw new Error("Troop total must be at least 1");
  if (!Number.isInteger(stepPercent) || stepPercent < 1 || stepPercent > 100) {
    throw new Error("Troop percentage step must be an integer between 1 and 100");
  }
  const output = new Map<string, TroopCounts>();
  for (let infantryPercent = 0; infantryPercent <= 100; infantryPercent += stepPercent) {
    for (let lancerPercent = 0; lancerPercent <= 100 - infantryPercent; lancerPercent += stepPercent) {
      const composition = countsForPercentages(safeTotal, infantryPercent, lancerPercent);
      output.set(troopCountsKey(composition), composition);
    }
  }
  return [...output.values()];
}

export function applyTroopComposition(
  definition: ThreeArmyDefinition,
  side: TeamSide,
  armyIndex: number,
  composition: TroopCounts,
  simulatorConfig: SimulatorConfig
): ThreeArmyDefinition {
  if (!Number.isInteger(armyIndex) || armyIndex < 0 || armyIndex >= 3) throw new Error("armyIndex must be 0, 1, or 2");
  for (const unitType of UNIT_TYPES) {
    if (!Number.isInteger(composition[unitType]) || composition[unitType] < 0) {
      throw new Error(`Troop composition ${unitType} count must be a non-negative integer`);
    }
  }
  const compositionTotal = UNIT_TYPES.reduce((sum, unitType) => sum + composition[unitType], 0);
  if (composition.total !== compositionTotal) throw new Error("Troop composition counts must add up to its total");
  const originalTotal = troopCountsForArmy(definition[side][armyIndex], simulatorConfig, `${side}[${armyIndex}]`).total;
  if (composition.total !== originalTotal) {
    throw new Error(`Troop composition must preserve ${side}[${armyIndex}] total of ${originalTotal}`);
  }
  const armies = definition[side].map((army, index) => {
    if (index !== armyIndex) return army;
    const ids = troopIdsByType(army, simulatorConfig, `${side}[${armyIndex}]`);
    return {
      ...army,
      fighter: {
        ...army.fighter,
        troops: {
          [ids.infantry]: composition.infantry,
          [ids.lancer]: composition.lancer,
          [ids.marksman]: composition.marksman
        }
      }
    };
  }) as [ArmyDefinition, ArmyDefinition, ArmyDefinition];
  return { ...definition, [side]: armies };
}

export async function optimizeWinningTroopsParallel(
  definition: ThreeArmyDefinition,
  heroResults: readonly OptimizationResult[],
  simulatorConfig: SimulatorConfig,
  reps: number,
  seed: number,
  jobs: number,
  onProgress?: (progress: TroopOptimizationProgress) => void
): Promise<TroopOptimizationResult> {
  const search = definition.troop_optimization;
  const optimization = definition.optimization;
  const heroWinner = heroResults[0];
  if (!search) throw new Error("The configuration has no troop_optimization section");
  if (!optimization || !heroWinner) throw new Error("Troop optimization requires a winning hero result");

  const side = optimization.side;
  let currentDefinition = definitionWithHeroLineups(definition, heroWinner.heroes, simulatorConfig);
  let currentResult = heroWinner;
  const initialTroops = troopCountsForTeam(currentDefinition[side], simulatorConfig, side);
  let evaluatedCandidates = 0;
  const pool = jobs > 1
    ? new BatchWorkerPool<OptimizationWorkerTask, OptimizationResult>(
      Math.max(1, Math.floor(jobs)),
      () => new WorkerThreadBatchWorker(new URL("./three_army_optimizer.worker.ts", import.meta.url))
    )
    : undefined;

  const evaluateCandidates = async (
    candidates: Array<{ definition: ThreeArmyDefinition; troops: TroopCounts }>,
    progress: Omit<TroopOptimizationProgress, "completed" | "total">
  ): Promise<Array<{ definition: ThreeArmyDefinition; troops: TroopCounts; result: OptimizationResult }>> => {
    let completed = 0;
    const evaluate = async (candidate: { definition: ThreeArmyDefinition; troops: TroopCounts }) => {
      const task: OptimizationWorkerTask = {
        definition: candidate.definition,
        heroes: heroWinner.heroes,
        side,
        reps,
        seed
      };
      const result = pool
        ? await pool.runTask(task)
        : evaluateOptimizationWorkerTask(task, simulatorConfig);
      completed += 1;
      evaluatedCandidates += 1;
      onProgress?.({ ...progress, completed, total: candidates.length });
      return { ...candidate, result };
    };
    return Promise.all(candidates.map(evaluate));
  };

  try {
    for (const stage of ["coarse", "fine"] as const) {
      for (let pass = 1; pass <= search.passes; pass += 1) {
        let changed = false;
        for (let armyIndex = 0; armyIndex < 3; armyIndex += 1) {
          const currentTroops = troopCountsForArmy(currentDefinition[side][armyIndex], simulatorConfig, `${side}[${armyIndex}]`);
          const variants = stage === "coarse"
            ? generateTroopCompositions(currentTroops.total, search.coarse_step_percent)
            : generateLocalTroopCompositions(
              currentTroops,
              search.fine_step_percent,
              search.fine_radius_percent
            );
          const unique = new Map<string, TroopCounts>();
          unique.set(troopCountsKey(currentTroops), currentTroops);
          for (const variant of variants) unique.set(troopCountsKey(variant), variant);
          const candidates = [...unique.values()].map((troops) => ({
            definition: applyTroopComposition(currentDefinition, side, armyIndex, troops, simulatorConfig),
            troops
          }));
          const ranked = await evaluateCandidates(candidates, { stage, pass, armyIndex });
          ranked.sort((left, right) => compareOptimizationResults(left.result, right.result));
          const best = ranked[0];
          if (troopCountsKey(best.troops) !== troopCountsKey(currentTroops)) changed = true;
          currentDefinition = best.definition;
          currentResult = best.result;
        }
        if (!changed) break;
      }
    }
  } finally {
    await pool?.close();
  }

  return {
    side,
    heroes: heroWinner.heroes,
    initialTroops,
    troops: troopCountsForTeam(currentDefinition[side], simulatorConfig, side),
    initialEvaluation: heroWinner.evaluation,
    evaluation: currentResult.evaluation,
    winRate: currentResult.winRate,
    scoreRate: currentResult.scoreRate,
    averageMargin: currentResult.averageMargin,
    evaluatedCandidates,
    search
  };
}

export function evaluateOptimizationWorkerTask(task: OptimizationWorkerTask, simulatorConfig: SimulatorConfig): OptimizationResult {
  const evaluation = evaluateDefinition(task.definition, simulatorConfig, task.reps, task.seed);
  return optimizationResult(task.heroes, evaluation, task.side);
}

export function parseCliArgs(argv: string[]): CliOptions {
  const [command, configPath, ...rest] = argv;
  if (command !== "simulate" && command !== "optimize") throw new Error(helpText());
  if (!configPath || configPath.startsWith("--")) throw new Error(helpText());
  const options: CliOptions = {
    command,
    configPath,
    reps: 10,
    seed: 1234,
    top: 20,
    maxCandidates: 100_000,
    jobs: Math.max(1, Math.min(8, Math.floor(cpus().length / 2))),
    json: false
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const read = (): string => {
      const value = rest[++index];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      return value;
    };
    switch (arg) {
      case "--reps": options.reps = positiveInteger(read(), arg); break;
      case "--seed": options.seed = integerValue(read(), arg); break;
      case "--top": options.top = positiveInteger(read(), arg); break;
      case "--max-candidates": options.maxCandidates = positiveInteger(read(), arg); break;
      case "--jobs": options.jobs = positiveInteger(read(), arg); break;
      case "--json": options.json = true; break;
      case "--help":
      case "-h": throw new Error(helpText());
      default: throw new Error(`Unknown option ${arg}\n\n${helpText()}`);
    }
  }
  return options;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseCliArgs(argv);
  const simulatorConfig = loadSimulatorConfig();
  const definition = parseDefinition(JSON.parse(readFileSync(args.configPath, "utf8")), simulatorConfig);
  if (args.command === "simulate") {
    const result = evaluateDefinition(definition, simulatorConfig, args.reps, args.seed);
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else printEvaluation(result);
    return;
  }

  let lastPct = -1;
  const results = await optimizeDefinitionParallel(definition, simulatorConfig, args.reps, args.seed, args.jobs, args.maxCandidates, (completed, total) => {
    const pct = Math.floor((completed * 100) / total);
    if (!args.json && pct !== lastPct) {
      process.stderr.write(`\rEvaluating hero setups: ${completed}/${total} (${pct}%)`);
      lastPct = pct;
      if (completed === total) process.stderr.write("\n");
    }
  });
  const top = results.slice(0, args.top);
  let troopResult: TroopOptimizationResult | undefined;
  if (definition.troop_optimization) {
    let progressKey = "";
    troopResult = await optimizeWinningTroopsParallel(
      definition,
      results,
      simulatorConfig,
      args.reps,
      args.seed,
      args.jobs,
      (progress) => {
        if (args.json) return;
        const key = `${progress.stage}:${progress.pass}:${progress.armyIndex}`;
        const pct = Math.floor((progress.completed * 100) / progress.total);
        if (key !== progressKey || pct !== lastPct) {
          process.stderr.write(
            `\rOptimizing troops (${progress.stage}, pass ${progress.pass}, army ${progress.armyIndex + 1}): ` +
            `${progress.completed}/${progress.total} (${pct}%)`
          );
          progressKey = key;
          lastPct = pct;
          if (progress.completed === progress.total) process.stderr.write("\n");
        }
      }
    );
  }
  if (args.json) {
    console.log(JSON.stringify(troopResult ? { heroOptimization: top, troopOptimization: troopResult } : top, null, 2));
  } else {
    printOptimization(top, definition, definition.optimization!.side);
    if (troopResult) printTroopOptimization(troopResult, definition);
  }
}

function createBattleResolver(definition: ThreeArmyDefinition, simulatorConfig: SimulatorConfig): BattleResolver {
  return (attacker, defender, seed) => {
    const builder = new BattleInputBuilder(simulatorConfig)
      .fighter("attacker", attacker)
      .fighter("defender", defender)
      .seed(seed)
      .maxRounds(definition.max_rounds ?? 600)
      .addHeroGenerationStats();
    return simulateBattles(builder.build(), simulatorConfig, { mode: "fast", count: 1 })[0];
  };
}

function orderedArmies(armies: readonly ArmyDefinition[], order: Order): MutableArmy[] {
  return order.map((armyIndex, slotIndex) => ({
    name: armies[armyIndex].name,
    slot: slotIndex + 1,
    fighter: cloneFighter(armies[armyIndex].fighter)
  }));
}

function withRemainingTroops(
  fighter: FighterInput,
  remaining: Record<UnitType, number>,
  simulatorConfig: SimulatorConfig
): FighterInput {
  const troops: Record<string, number> = {};
  for (const unitType of UNIT_TYPES) {
    const entries = Object.entries(fighter.troops)
      .filter(([id, count]) => count > 0 && simulatorConfig.troopStats[id]?.type === unitType);
    const target = Math.max(0, Math.round(remaining[unitType] ?? 0));
    const total = entries.reduce((sum, [, count]) => sum + count, 0);
    if (target === 0 || total === 0) continue;
    const allocations = entries.map(([id, count]) => {
      const exact = (target * count) / total;
      return { id, count: Math.floor(exact), remainder: exact - Math.floor(exact) };
    });
    let unallocated = target - allocations.reduce((sum, entry) => sum + entry.count, 0);
    allocations.sort((left, right) => right.remainder - left.remainder || left.id.localeCompare(right.id));
    for (let index = 0; index < allocations.length && unallocated > 0; index += 1, unallocated -= 1) {
      allocations[index].count += 1;
    }
    for (const allocation of allocations) if (allocation.count > 0) troops[allocation.id] = allocation.count;
  }
  return { ...fighter, troops };
}

function heroLineups(pools: HeroPools, skillLevels: readonly number[], simulatorConfig: SimulatorConfig): HeroInputEntry[][] {
  const byRole = UNIT_TYPES.map((role) => pools[role].map((name) => heroAtLevels(name, role, skillLevels, simulatorConfig)));
  const lineups: HeroInputEntry[][] = [];
  for (const infantry of byRole[0]) {
    for (const lancer of byRole[1]) {
      for (const marksman of byRole[2]) lineups.push([infantry, lancer, marksman]);
    }
  }
  return lineups;
}

function definitionWithHeroLineups(
  definition: ThreeArmyDefinition,
  lineups: readonly string[][],
  simulatorConfig: SimulatorConfig
): ThreeArmyDefinition {
  const optimization = definition.optimization;
  if (!optimization) throw new Error("The configuration has no optimization section");
  if (lineups.length !== 3 || lineups.some((lineup) => lineup.length !== 3)) {
    throw new Error("The winning hero result must contain three complete army lineups");
  }
  const normalized = normalizeDefinitionHeroStats(definition, simulatorConfig);
  const armies = normalized[optimization.side].map((army, armyIndex) => ({
    ...army,
    fighter: {
      ...army.fighter,
      heroes: lineups[armyIndex].map((name, roleIndex) =>
        heroAtLevels(name, UNIT_TYPES[roleIndex], optimization.hero_skill_levels, simulatorConfig)
      )
    }
  })) as [ArmyDefinition, ArmyDefinition, ArmyDefinition];
  return { ...normalized, [optimization.side]: armies };
}

function heroAtLevels(
  name: string,
  role: UnitType,
  skillLevels: readonly number[],
  simulatorConfig: SimulatorConfig
): HeroInputEntry {
  const [key, definition] = findHero(name, simulatorConfig);
  if (!definition) throw new Error(`Unknown hero ${JSON.stringify(name)} in optimization hero pools`);
  if (definition.troop_type !== role) {
    throw new Error(`Hero ${JSON.stringify(name)} is ${definition.troop_type ?? "untyped"}, not ${role}`);
  }
  const levels: Record<string, number> = {};
  Object.keys(definition.skills ?? {}).forEach((skillId, index) => {
    const level = skillLevels[index] ?? 0;
    if (level <= 0) return;
    levels[`skill_${index + 1}`] = level;
    levels[skillId] = level;
  });
  return { name: definition.name || key, levels };
}

function findHero(name: string, simulatorConfig: SimulatorConfig): [string, SkillFile | undefined] {
  const direct = simulatorConfig.heroDefinitions[name];
  if (direct) return [name, direct];
  const normalized = normalizeHeroName(name);
  const alias = simulatorConfig.heroAliasIndex?.[normalized];
  if (alias) return [alias, simulatorConfig.heroDefinitions[alias]];
  const entry = Object.entries(simulatorConfig.heroDefinitions).find(([key, value]) =>
    normalizeHeroName(key) === normalized || normalizeHeroName(value.name) === normalized || value.aliases?.some((item) => normalizeHeroName(item) === normalized)
  );
  return entry ?? [name, undefined];
}

function parseArmies(value: unknown, side: TeamSide, simulatorConfig: SimulatorConfig): [ArmyDefinition, ArmyDefinition, ArmyDefinition] {
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`${side} must contain exactly three armies`);
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`${side}[${index}] must be an object`);
    if (typeof entry.name !== "string" || entry.name.trim() === "") throw new Error(`${side}[${index}].name must be a non-empty string`);
    if (!isRecord(entry.fighter) || !isRecord(entry.fighter.troops)) throw new Error(`${side}[${index}].fighter.troops must be an object`);
    if (entry.fighter.joiner_heroes !== undefined) {
      throw new Error(`${side}[${index}].fighter.joiner_heroes is not supported in this non-rally mode`);
    }
    let supportedTroops = 0;
    for (const [id, count] of Object.entries(entry.fighter.troops)) {
      if (!simulatorConfig.troopStats[id]) throw new Error(`${side}[${index}] uses unknown troop id ${JSON.stringify(id)}`);
      if (typeof count !== "number" || !Number.isFinite(count) || count < 0) throw new Error(`${side}[${index}].fighter.troops.${id} must be a non-negative number`);
      supportedTroops += count;
    }
    if (supportedTroops <= 0) throw new Error(`${side}[${index}] must contain troops`);
    return { name: entry.name, fighter: entry.fighter as unknown as FighterInput };
  }) as [ArmyDefinition, ArmyDefinition, ArmyDefinition];
}

function parseOptimization(value: unknown, simulatorConfig: SimulatorConfig): OptimizationDefinition {
  if (!isRecord(value)) throw new Error("optimization must be an object");
  if (value.side !== "attacker" && value.side !== "defender") throw new Error("optimization.side must be attacker or defender");
  const heroPools = value.hero_pools === undefined
    ? undefined
    : parseHeroPools(value.hero_pools, "optimization.hero_pools", simulatorConfig);
  let perArmy: [HeroPools, HeroPools, HeroPools] | undefined;
  if (value.per_army_hero_pools !== undefined) {
    if (!Array.isArray(value.per_army_hero_pools) || value.per_army_hero_pools.length !== 3) {
      throw new Error("optimization.per_army_hero_pools must contain exactly three pool objects");
    }
    perArmy = value.per_army_hero_pools.map((entry, index) =>
      parseHeroPools(entry, `optimization.per_army_hero_pools[${index}]`, simulatorConfig)
    ) as [HeroPools, HeroPools, HeroPools];
  }
  if (!heroPools && !perArmy) throw new Error("optimization requires hero_pools or per_army_hero_pools");
  if (value.hero_level !== undefined) {
    throw new Error("optimization.hero_level has been replaced by optimization.hero_skill_levels");
  }
  if (!Array.isArray(value.hero_skill_levels) || value.hero_skill_levels.length === 0) {
    throw new Error("optimization.hero_skill_levels must be a non-empty array");
  }
  const heroSkillLevels = value.hero_skill_levels.map((level, index) => {
    const parsed = integerValue(level, `optimization.hero_skill_levels[${index}]`);
    if (parsed < 0 || parsed > 5) {
      throw new Error(`optimization.hero_skill_levels[${index}] must be between 0 and 5`);
    }
    return parsed;
  });
  const uniqueHeroes = value.unique_heroes === undefined ? true : booleanValue(value.unique_heroes, "optimization.unique_heroes");
  return {
    side: value.side,
    ...(heroPools ? { hero_pools: heroPools } : {}),
    hero_skill_levels: heroSkillLevels,
    unique_heroes: uniqueHeroes,
    ...(perArmy ? { per_army_hero_pools: perArmy } : {})
  };
}

function parseTroopOptimization(value: unknown): TroopOptimizationDefinition {
  if (!isRecord(value)) throw new Error("troop_optimization must be an object");
  const coarseStep = value.coarse_step_percent === undefined
    ? 10
    : percentageInteger(value.coarse_step_percent, "troop_optimization.coarse_step_percent");
  const fineStep = value.fine_step_percent === undefined
    ? 2
    : percentageInteger(value.fine_step_percent, "troop_optimization.fine_step_percent");
  const fineRadius = value.fine_radius_percent === undefined
    ? 4
    : percentageInteger(value.fine_radius_percent, "troop_optimization.fine_radius_percent");
  const passes = value.passes === undefined ? 2 : positiveInteger(value.passes, "troop_optimization.passes");
  return {
    coarse_step_percent: coarseStep,
    fine_step_percent: fineStep,
    fine_radius_percent: fineRadius,
    passes
  };
}

function parseHeroPools(value: unknown, label: string, simulatorConfig: SimulatorConfig): HeroPools {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  const result = {} as HeroPools;
  for (const role of UNIT_TYPES) {
    const pool = value[role];
    if (!Array.isArray(pool) || pool.length === 0 || pool.some((name) => typeof name !== "string" || name.trim() === "")) {
      throw new Error(`${label}.${role} must be a non-empty array of hero names`);
    }
    result[role] = pool as string[];
    for (const name of result[role]) heroAtLevels(name, role, [1], simulatorConfig);
  }
  return result;
}

function parseInputStatsProvenance(value: unknown): Record<TeamSide, boolean> {
  if (!isRecord(value)) {
    throw new Error("input_stats_include_hero_generation must specify attacker and defender booleans");
  }
  return {
    attacker: booleanValue(value.attacker, "input_stats_include_hero_generation.attacker"),
    defender: booleanValue(value.defender, "input_stats_include_hero_generation.defender")
  };
}

function normalizeDefinitionHeroStats(
  definition: ThreeArmyDefinition,
  simulatorConfig: SimulatorConfig
): ThreeArmyDefinition {
  const provenance = definition.input_stats_include_hero_generation;
  if (!provenance.attacker && !provenance.defender) return definition;
  const normalizeSide = (side: TeamSide): [ArmyDefinition, ArmyDefinition, ArmyDefinition] =>
    definition[side].map((army) => ({
      ...army,
      fighter: provenance[side] ? removeHeroGenerationStats(army.fighter, simulatorConfig) : army.fighter
    })) as [ArmyDefinition, ArmyDefinition, ArmyDefinition];
  return {
    ...definition,
    attacker: normalizeSide("attacker"),
    defender: normalizeSide("defender"),
    input_stats_include_hero_generation: { attacker: false, defender: false }
  };
}

function mainHeroNames(fighter: FighterInput): string[] {
  if (!fighter.heroes) return [];
  return Array.isArray(fighter.heroes)
    ? fighter.heroes.map((hero) => hero.name)
    : Object.keys(fighter.heroes);
}

function printEvaluation(result: EvaluationResult): void {
  console.log(`Scenarios: ${result.scenarios} (36 orderings × ${result.scenarios / 36} reps)`);
  console.log(`Attacker: ${percent(result.attackerWinRate)} wins (${result.attackerWins})`);
  console.log(`Defender: ${percent(result.defenderWinRate)} wins (${result.defenderWins})`);
  console.log(`Draws: ${percent(result.draws / result.scenarios)} (${result.draws})`);
  console.log(`Average survivors: attacker ${result.averageAttackerRemaining.toFixed(1)}, defender ${result.averageDefenderRemaining.toFixed(1)}`);
  console.log(`Average attacker margin: ${signed(result.averageAttackerMargin)}`);
  console.log(`Average battles per scenario: ${result.averageBattles.toFixed(2)}`);
}

function printOptimization(results: OptimizationResult[], definition: ThreeArmyDefinition, side: TeamSide): void {
  const armyNames = definition[side].map((army) => army.name);
  console.log(`Top ${results.length} hero setups for ${side}:`);
  for (const result of results) {
    const lineups = result.heroes.map((heroes, index) => `${armyNames[index]}=[${heroes.join(", ")}]`).join("  ");
    console.log(`${String(result.rank).padStart(3)}  win=${percent(result.winRate)} score=${percent(result.scoreRate)} margin=${signed(result.averageMargin)}  ${lineups}`);
  }
}

function printTroopOptimization(result: TroopOptimizationResult, definition: ThreeArmyDefinition): void {
  const armyNames = definition[result.side].map((army) => army.name);
  console.log(`\nTroop optimization for the rank 1 hero setup (${result.side}; opposing team unchanged):`);
  console.log(
    `Baseline: win=${percent(winRateForSide(result.initialEvaluation, result.side))} ` +
    `margin=${signed(marginForSide(result.initialEvaluation, result.side))}`
  );
  console.log(`Optimized: win=${percent(result.winRate)} score=${percent(result.scoreRate)} margin=${signed(result.averageMargin)}`);
  result.troops.forEach((troops, index) => {
    const initial = result.initialTroops[index];
    console.log(
      `  ${armyNames[index]}: infantry=${troops.infantry} lancer=${troops.lancer} marksman=${troops.marksman} ` +
      `(total=${troops.total}; was ${initial.infantry}/${initial.lancer}/${initial.marksman})`
    );
  });
  console.log(
    `Evaluated ${result.evaluatedCandidates} coordinate candidates ` +
    `(coarse ${result.search.coarse_step_percent}%, fine ${result.search.fine_step_percent}% ` +
    `within ±${result.search.fine_radius_percent}%, up to ${result.search.passes} passes).`
  );
}

function troopCountsForTeam(
  armies: readonly ArmyDefinition[],
  simulatorConfig: SimulatorConfig,
  side: TeamSide
): TroopCounts[] {
  return armies.map((army, index) => troopCountsForArmy(army, simulatorConfig, `${side}[${index}]`));
}

function troopCountsForArmy(army: ArmyDefinition, simulatorConfig: SimulatorConfig, label: string): TroopCounts {
  troopIdsByType(army, simulatorConfig, label);
  const counts = { infantry: 0, lancer: 0, marksman: 0 } as Record<UnitType, number>;
  for (const [id, count] of Object.entries(army.fighter.troops)) {
    counts[simulatorConfig.troopStats[id].type] += count;
  }
  return {
    infantry: counts.infantry,
    lancer: counts.lancer,
    marksman: counts.marksman,
    total: counts.infantry + counts.lancer + counts.marksman
  };
}

function troopIdsByType(
  army: ArmyDefinition,
  simulatorConfig: SimulatorConfig,
  label: string
): Record<UnitType, string> {
  const ids = {} as Record<UnitType, string>;
  for (const id of Object.keys(army.fighter.troops)) {
    const unitType = simulatorConfig.troopStats[id]?.type;
    if (!unitType) continue;
    if (ids[unitType] && ids[unitType] !== id) {
      throw new Error(`${label} has multiple ${unitType} troop ids; troop optimization supports one tier per troop type`);
    }
    ids[unitType] = id;
  }
  for (const unitType of UNIT_TYPES) {
    if (!ids[unitType]) {
      throw new Error(`${label} must include one ${unitType} troop id (a zero count is allowed) for troop optimization`);
    }
  }
  return ids;
}

function generateLocalTroopCompositions(
  center: TroopCounts,
  stepPercent: number,
  radiusPercent: number
): TroopCounts[] {
  const output = new Map<string, TroopCounts>();
  const centerInfantry = (center.infantry * 100) / center.total;
  const centerLancer = (center.lancer * 100) / center.total;
  for (let infantryDelta = -radiusPercent; infantryDelta <= radiusPercent; infantryDelta += stepPercent) {
    const infantryPercent = centerInfantry + infantryDelta;
    if (infantryPercent < 0 || infantryPercent > 100) continue;
    for (let lancerDelta = -radiusPercent; lancerDelta <= radiusPercent; lancerDelta += stepPercent) {
      const lancerPercent = centerLancer + lancerDelta;
      if (lancerPercent < 0 || infantryPercent + lancerPercent > 100) continue;
      const composition = countsForPercentages(center.total, infantryPercent, lancerPercent);
      output.set(troopCountsKey(composition), composition);
    }
  }
  return [...output.values()];
}

function countsForPercentages(total: number, infantryPercent: number, lancerPercent: number): TroopCounts {
  const raw = [
    (total * infantryPercent) / 100,
    (total * lancerPercent) / 100,
    (total * (100 - infantryPercent - lancerPercent)) / 100
  ];
  const counts = raw.map(Math.floor);
  let remainder = total - counts.reduce((sum, count) => sum + count, 0);
  const order = raw
    .map((value, index) => ({ index, remainder: value - counts[index] }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  for (const entry of order) {
    if (remainder <= 0) break;
    counts[entry.index] += 1;
    remainder -= 1;
  }
  return { infantry: counts[0], lancer: counts[1], marksman: counts[2], total };
}

function troopCountsKey(troops: TroopCounts): string {
  return `${troops.infantry}:${troops.lancer}:${troops.marksman}`;
}

function remainingForTeam(armies: readonly MutableArmy[]): number {
  return armies.reduce((sum, army) => sum + Object.values(army.fighter.troops).reduce((armySum, count) => armySum + count, 0), 0);
}

function drawResult(attacker: MutableArmy[], defender: MutableArmy[], battles: number): MatchResult {
  return { winner: "draw", attackerRemaining: remainingForTeam(attacker), defenderRemaining: remainingForTeam(defender), battles };
}

function removeArmy(armies: MutableArmy[], target: MutableArmy): void {
  const index = armies.indexOf(target);
  if (index >= 0) armies.splice(index, 1);
}

function cloneFighter(fighter: FighterInput): FighterInput {
  return structuredClone(fighter);
}

function cloneHero(hero: HeroInputEntry): HeroInputEntry {
  return { name: hero.name, ...(hero.levels ? { levels: { ...hero.levels } } : {}) };
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));
}

function compareHeroSets(left: string[][], right: string[][]): number {
  return left.flat().join("\u0000").localeCompare(right.flat().join("\u0000"));
}

function optimizationResult(heroes: string[][], evaluation: EvaluationResult, side: TeamSide): OptimizationResult {
  const wins = side === "attacker" ? evaluation.attackerWins : evaluation.defenderWins;
  return {
    rank: 0,
    heroes,
    evaluation,
    winRate: wins / evaluation.scenarios,
    scoreRate: (wins + evaluation.draws * 0.5) / evaluation.scenarios,
    averageMargin: marginForSide(evaluation, side)
  };
}

function rankOptimizationResults(results: OptimizationResult[]): OptimizationResult[] {
  results.sort(compareOptimizationResults);
  results.forEach((result, index) => { result.rank = index + 1; });
  return results;
}

function compareOptimizationResults(left: OptimizationResult, right: OptimizationResult): number {
  return right.scoreRate - left.scoreRate || right.averageMargin - left.averageMargin || compareHeroSets(left.heroes, right.heroes);
}

function winRateForSide(evaluation: EvaluationResult, side: TeamSide): number {
  return (side === "attacker" ? evaluation.attackerWins : evaluation.defenderWins) / evaluation.scenarios;
}

function marginForSide(evaluation: EvaluationResult, side: TeamSide): number {
  return side === "attacker" ? evaluation.averageAttackerMargin : -evaluation.averageAttackerMargin;
}

function normalizeHeroName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function bySlot(left: MutableArmy, right: MutableArmy): number {
  return left.slot - right.slot;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = integerValue(value, label);
  if (parsed < 1) throw new Error(`${label} must be at least 1`);
  return parsed;
}

function integerValue(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${label} must be an integer`);
  return parsed;
}

function percentageInteger(value: unknown, label: string): number {
  const parsed = positiveInteger(value, label);
  if (parsed > 100) throw new Error(`${label} must be at most 100`);
  return parsed;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function helpText(): string {
  return [
    "Three-army battle simulator, hero optimizer, and optional winning-setup troop optimizer.",
    "",
    "Usage:",
    "  npx tsx scripts/three_army_optimizer.ts simulate <config.json> [--reps N] [--seed N] [--json]",
    "  npx tsx scripts/three_army_optimizer.ts optimize <config.json> [--reps N] [--seed N] [--jobs N] [--top N] [--max-candidates N] [--json]",
    "",
    "Each evaluation covers all 6 × 6 random army orderings. --reps (default 10) is the number of combat-RNG samples per ordering.",
    "If troop_optimization is configured, optimize first finds the best hero setup, then redistributes each winning army's fixed troop total while leaving the opposing team unchanged.",
    "See scripts/three_army_optimizer.example.json for the configuration format. Set input_stats_include_hero_generation per side; selected heroes are always reflected in effective stats."
  ].join("\n");
}

const entryPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
