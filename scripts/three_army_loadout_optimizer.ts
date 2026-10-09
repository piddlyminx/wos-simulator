#!/usr/bin/env tsx
import { readFileSync, writeFileSync, statSync, mkdirSync } from "node:fs";
import { cpus } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadSimulatorConfig } from "../simulator/src/config-node";
import { applyHeroGenerationStats, removeHeroGenerationStats } from "../simulator/src/fighterResolution";
import type { FighterInput, SimulatorConfig, StatBlock, UnitType } from "../simulator/src/types";
import { BatchWorkerPool } from "../simulator/src/workerPool";
import { WorkerThreadBatchWorker } from "./workerThreadBatchWorker";
import {
  countOptimizationCandidates, createHeroOptimizationWorkerContext,
  effectiveDefinitionForOptimizationCandidate, evaluateOptimizationWorkerTask,
  generateOptimizationCandidateKeys, parseDefinition,
  type ArmyDefinition, type DefinitionEvaluationWorkerTask, type EvaluationResult,
  type OptimizationResult, type TeamSide, type ThreeArmyDefinition
} from "./three_army_optimizer";

export const UNIT_TYPES: UnitType[] = ["infantry", "lancer", "marksman"];
const STAT_KEYS = ["attack", "defense", "lethality", "health"] as const;
type Triple<T> = [T, T, T];
export type Composition = Triple<number>;
type Stats = Record<UnitType, StatBlock>;
export interface GearSet { name: string; stats: StatBlock }
export interface GearDefinition {
  base_stats: Stats;
  sets: Record<UnitType, Triple<GearSet>>;
  initial_assignment: Record<UnitType, Triple<string>>;
}
export interface Loadout {
  heroes: Triple<FighterInput["heroes"]>;
  gear: Record<UnitType, Composition>;
  troops: Triple<Composition>;
}
export interface SearchOptions {
  passes: number;
  starts: number;
  reps: number;
  screenReps: number;
  validationReps: number;
  coarseStep: number;
  refineStep: number;
  seeds: number;
  finalists: number;
  maxCandidates: number;
  seed: number;
  jobs: number;
}
export const DEFAULT_OPTIONS: SearchOptions = {
  passes: 2, starts: 1, reps: 1000, screenReps: 100, validationReps: 2000,
  coarseStep: 10, refineStep: 2, seeds: 5, finalists: 10,
  maxCandidates: 100_000, seed: 1, jobs: Math.min(8, cpus().length)
};
export interface SearchModel {
  definition: ThreeArmyDefinition;
  side: TeamSide;
  gear: GearDefinition;
  inferredGear: boolean;
  troopIds: Triple<Record<UnitType, string>>;
  initial: Loadout;
}
export interface ScoredLoadout { loadout: Loadout; result: OptimizationResult }
export interface StageRecord {
  start: number;
  pass: number;
  stage: string;
  candidates: number;
  scoreRate: number;
}
export interface SearchResult {
  best: ScoredLoadout;
  finalists: ScoredLoadout[];
  history: StageRecord[];
  evaluations: number;
  matches: number;
}
export type Evaluate = (loadout: Loadout, reps: number, seed: number) => Promise<OptimizationResult>;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function integer(value: unknown, label: string, min = 1): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min) {
    throw new Error(`${label} must be an integer >= ${min}`);
  }
  return value;
}
function statBlock(value: unknown, label: string): StatBlock {
  const row = object(value, label);
  const stats = {} as StatBlock;
  for (const key of STAT_KEYS) {
    const v = row[key];
    if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${label}.${key} must be finite`);
    stats[key] = v;
  }
  return stats;
}
function statsByType(value: unknown, label: string): Stats {
  const rows = object(value, label);
  return Object.fromEntries(UNIT_TYPES.map(t => [t, statBlock(rows[t], `${label}.${t}`)])) as Stats;
}
function round(value: number): number { return Number(value.toFixed(10)); }
export function permutations<T>(items: Triple<T>): Triple<T>[] {
  return [[items[0], items[1], items[2]], [items[0], items[2], items[1]],
    [items[1], items[0], items[2]], [items[1], items[2], items[0]],
    [items[2], items[0], items[1]], [items[2], items[1], items[0]]];
}

export function createSearchModel(raw: unknown, config: SimulatorConfig): SearchModel {
  const input = object(raw, "configuration");
  const parsed = parseDefinition(raw, config);
  const side = parsed.optimization?.side ?? parsed.troop_optimization?.side ?? "attacker";
  const definition = { ...parsed };
  for (const s of ["attacker", "defender"] as const) {
    definition[s] = parsed[s].map(a => ({ ...a, fighter: parsed.input_stats_include_hero_generation[s]
      ? removeHeroGenerationStats(a.fighter, config) : { ...a.fighter } })) as Triple<ArmyDefinition>;
  }
  definition.input_stats_include_hero_generation = { attacker: false, defender: false };
  const armies = definition[side];
  const troopIds = armies.map(a => {
    const ids = {} as Record<UnitType, string>;
    for (const [id, count] of Object.entries(a.fighter.troops)) {
      integer(count, `${a.name}.troops.${id}`, 0);
      const type = config.troopStats[id].type;
      if (ids[type]) throw new Error(`${a.name} has multiple tiers of ${type}; use one id per troop type`);
      ids[type] = id;
    }
    for (const t of UNIT_TYPES) if (!ids[t]) throw new Error(`${a.name} needs a ${t} troop id; a zero count is allowed`);
    integer(Object.values(a.fighter.troops).reduce((sum, n) => sum + n, 0), `${a.name} capacity`);
    return ids;
  }) as Triple<Record<UnitType, string>>;
  const gearInput = input.gear_optimization === undefined ? undefined : object(input.gear_optimization, "gear_optimization");
  const inferredGear = gearInput === undefined;
  let gear: GearDefinition;
  if (inferredGear) {
    const residuals = armies.map(a => statsByType(a.fighter.stats, `${a.name}.stats`));
    gear = {
      base_stats: Object.fromEntries(UNIT_TYPES.map(t => [t, { attack: 0, defense: 0, lethality: 0, health: 0 }])) as Stats,
      sets: Object.fromEntries(UNIT_TYPES.map(t => [t, armies.map((a, i) => ({
        name: `${a.name} ${t}`, stats: residuals[i][t]
      }))])) as GearDefinition["sets"],
      initial_assignment: Object.fromEntries(UNIT_TYPES.map(t => [t, armies.map(a => `${a.name} ${t}`)])) as GearDefinition["initial_assignment"]
    };
  } else {
    const g = gearInput!;
    for (const key of Object.keys(g)) {
      if (!["side", "base_stats", "sets", "initial_assignment"].includes(key)) throw new Error(`gear_optimization.${key} is not supported`);
    }
    if (g.side !== undefined && g.side !== side) throw new Error("gear_optimization.side must match the optimized side");
    const sets = object(g.sets, "gear_optimization.sets");
    const assignments = object(g.initial_assignment, "gear_optimization.initial_assignment");
    gear = { base_stats: statsByType(g.base_stats, "gear_optimization.base_stats"), sets: {} as GearDefinition["sets"], initial_assignment: {} as GearDefinition["initial_assignment"] };
    for (const t of UNIT_TYPES) {
      const rows = sets[t];
      if (!Array.isArray(rows) || rows.length !== 3) throw new Error(`gear_optimization.sets.${t} needs exactly three complete sets`);
      gear.sets[t] = rows.map((v, i) => {
        const row = object(v, `gear_optimization.sets.${t}[${i}]`);
        for (const key of Object.keys(row)) if (key !== "name" && key !== "stats") throw new Error(`Gear set field ${key} is not supported`);
        if (typeof row.name !== "string" || !row.name.trim()) throw new Error("Gear set names must be nonempty strings");
        return { name: row.name, stats: statBlock(row.stats, `gear_optimization.sets.${t}[${i}].stats`) };
      }) as Triple<GearSet>;
      const names = gear.sets[t].map(s => s.name);
      const assignment = assignments[t];
      if (new Set(names).size !== 3 || !Array.isArray(assignment) || assignment.length !== 3
        || new Set(assignment).size !== 3 || assignment.some(n => !names.includes(n))) {
        throw new Error(`initial_assignment.${t} must use each named ${t} set exactly once`);
      }
      gear.initial_assignment[t] = assignment as Triple<string>;
    }
  }
  const initial: Loadout = {
    heroes: armies.map(a => a.fighter.heroes) as Loadout["heroes"],
    gear: Object.fromEntries(UNIT_TYPES.map(t => [t, gear.initial_assignment[t].map(n => gear.sets[t].findIndex(s => s.name === n))])) as Loadout["gear"],
    troops: armies.map((a, i) => UNIT_TYPES.map(t => a.fighter.troops[troopIds[i][t]])) as Loadout["troops"]
  };
  const model = { definition, side, gear, inferredGear, troopIds, initial };
  if (!inferredGear) {
    const rebuilt = definitionForLoadout(model, initial);
    for (let i = 0; i < 3; i++) {
      const residual = statsByType(armies[i].fighter.stats, `${armies[i].name}.stats`);
      for (const t of UNIT_TYPES) for (const k of STAT_KEYS) {
        if (Math.abs(residual[t][k] - rebuilt[side][i].fighter.stats![t]![k]!) > 0.011) {
          throw new Error(`gear_optimization does not reproduce initial ${armies[i].name} ${t} ${k}; base_stats must include shared Troops' bonuses and exclude hero generation`);
        }
      }
    }
  }
  return model;
}

export function definitionForLoadout(model: SearchModel, loadout: Loadout): ThreeArmyDefinition {
  const armies = model.definition[model.side].map<ArmyDefinition>((a, i) => {
    const stats = {} as Stats;
    for (const t of UNIT_TYPES) {
      const base = model.gear.base_stats[t];
      const gear = model.gear.sets[t][loadout.gear[t][i]].stats;
      stats[t] = Object.fromEntries(STAT_KEYS.map(k => [k, round(base[k] + gear[k])])) as unknown as StatBlock;
    }
    return { ...a, fighter: { ...a.fighter, heroes: loadout.heroes[i], stats,
      troops: Object.fromEntries(UNIT_TYPES.map((t, j) => [model.troopIds[i][t], loadout.troops[i][j]])) } };
  }) as Triple<ArmyDefinition>;
  return { ...model.definition, [model.side]: armies };
}

export function* gearCandidates(current: Loadout): Generator<Loadout> {
  for (const infantry of permutations([0, 1, 2])) for (const lancer of permutations([0, 1, 2])) {
    for (const marksman of permutations([0, 1, 2])) {
      yield { ...current, gear: { infantry, lancer, marksman } };
    }
  }
}
function* heroCandidates(model: SearchModel, current: Loadout, config: SimulatorConfig): Generator<Loadout> {
  if (!model.definition.optimization) { yield current; return; }
  const context = createHeroOptimizationWorkerContext(definitionForLoadout(model, current), config);
  for (const key of generateOptimizationCandidateKeys(context)) {
    const definition = effectiveDefinitionForOptimizationCandidate(context, key);
    yield { ...current, heroes: definition[model.side].map(a => a.fighter.heroes) as Loadout["heroes"] };
  }
}

function dedupeCounts(values: Composition[]): Composition[] {
  return [...new Map(values.map(c => [c.join(","), c])).values()];
}
export function singleTroopVariants(counts: Composition): Composition[] {
  const result: Composition[] = [counts];
  // Recurse through zero types so a pure march also tries one of BOTH other types.
  for (let i = 0; i < 3; i++) {
    if (counts[i] !== 0) continue;
    for (const c of [...result]) for (let donor = 0; donor < 3; donor++) {
      if (counts[donor] === 0 || c[donor] <= 1) continue;
      const next = [...c] as Composition;
      next[i] = 1;
      next[donor]--;
      result.push(next);
    }
  }
  return dedupeCounts(result);
}
function countsFromRatios(total: number, ratio: Composition): Composition {
  const raw = ratio.map(n => total * n / 100);
  const counts = raw.map(Math.floor) as Composition;
  const order = [0, 1, 2].sort((a, b) => (raw[b] - counts[b]) - (raw[a] - counts[a]) || a - b);
  const remainder = total - counts.reduce((sum, n) => sum + n, 0);
  for (let j = 0; j < remainder; j++) counts[order[j]]++;
  return counts;
}
export function coarseCompositions(total: number, step: number): Composition[] {
  integer(total, "total"); integer(step, "coarse step");
  if (step > 100) throw new Error("coarse step must be <= 100");
  const values: Composition[] = [];
  const grid = [...new Set([...Array.from({ length: Math.floor(100 / step) + 1 }, (_, i) => i * step), 100])];
  for (const i of grid) for (const l of grid) {
    if (i + l > 100) continue;
    values.push(...singleTroopVariants(countsFromRatios(total, [i, l, 100 - i - l])));
  }
  return dedupeCounts(values);
}
export function localCompositions(center: Composition, radius: number, step: number): Composition[] {
  integer(radius, "radius"); integer(step, "fine step");
  const total = center.reduce((sum, n) => sum + n, 0);
  const ratios = center.map(n => Math.round(100 * n / total));
  const values: Composition[] = [center];
  for (let i = Math.max(0, ratios[0] - radius); i <= Math.min(100, ratios[0] + radius); i += step) {
    for (let l = Math.max(0, ratios[1] - radius); l <= Math.min(100 - i, ratios[1] + radius); l += step) {
      const m = 100 - i - l;
      if (Math.abs(m - ratios[2]) > radius + 1) continue;
      values.push(...singleTroopVariants(countsFromRatios(total, [i, l, m])));
    }
  }
  // Always test 0 and 1 at a boundary, even when the local step skips zero.
  for (let t = 0; t < 3; t++) {
    if (center[t] > total * radius / 100 + 1) continue;
    for (let donor = 0; donor < 3; donor++) {
      if (donor === t || center[donor] === 0) continue;
      const boundary = [...center] as Composition;
      boundary[donor] += boundary[t]; boundary[t] = 0;
      values.push(...singleTroopVariants(boundary));
    }
  }
  return dedupeCounts(values);
}

function compare(a: ScoredLoadout, b: ScoredLoadout): number {
  return b.result.scoreRate - a.result.scoreRate || b.result.averageMargin - a.result.averageMargin;
}
function stateKey(loadout: Loadout): string { return JSON.stringify(loadout); }
function uniqueLoadouts(values: Iterable<Loadout>): Loadout[] {
  return [...new Map([...values].map(s => [stateKey(s), s])).values()];
}
export function passOrder(pass: number): string[] {
  return pass % 2 === 0 ? ["heroes", "gear", "troops"] : ["gear", "heroes", "troops"];
}

export function validateOptions(o: SearchOptions): void {
  for (const [k, v] of Object.entries(o)) integer(v, k, k === "seed" ? 0 : 1);
  if (o.screenReps > o.reps) throw new Error("screen-reps must be <= reps");
  if (o.validationReps < o.reps) throw new Error("validation-reps must be >= reps");
  if (o.coarseStep > 100 || o.refineStep > o.coarseStep) throw new Error("Require 1 <= refine-step <= coarse-step <= 100");
  if (o.starts > 3) throw new Error("starts must be 1, 2, or 3 (input, lancer-heavy, marksman-heavy)");
}

export async function searchLoadouts(
  model: SearchModel, config: SimulatorConfig, options: SearchOptions, evaluate: Evaluate,
  onProgress: (message: string) => void = () => {}
): Promise<SearchResult> {
  validateOptions(options);
  if (model.definition.optimization) {
    countOptimizationCandidates(createHeroOptimizationWorkerContext(model.definition, config), options.maxCandidates);
  }
  let evaluations = 0;
  let matches = 0;
  let stageSequence = 0;
  const history: StageRecord[] = [];
  const archive: Loadout[] = [];
  const score = async (states: Loadout[], reps: number, seed: number): Promise<ScoredLoadout[]> => {
    const result: ScoredLoadout[] = new Array(states.length);
    let next = 0;
    let completed = 0;
    let lastUpdate = Date.now();
    await Promise.all(Array.from({ length: Math.min(options.jobs, states.length) }, async () => {
      while (next < states.length) {
        const index = next++;
        result[index] = { loadout: states[index], result: await evaluate(states[index], reps, seed) };
        evaluations++; matches += reps; completed++;
        if (Date.now() - lastUpdate >= 5000) {
          onProgress(`  ${completed}/${states.length} candidates at ${reps} matches each`);
          lastUpdate = Date.now();
        }
      }
    }));
    return result.sort(compare);
  };
  const race = async (incumbent: Loadout, candidates: Iterable<Loadout>, label: string): Promise<{ best: ScoredLoadout; candidates: number }> => {
    const states = uniqueLoadouts([incumbent, ...candidates]);
    if (states.length > options.maxCandidates + 1) throw new Error(`${label} exceeds --max-candidates=${options.maxCandidates}`);
    onProgress(`${label}: screen ${states.length} candidates × ${options.screenReps} matches`);
    const seed = options.seed + 1009 * ++stageSequence;
    const screened = await score(states, options.screenReps, seed);
    const finalists = uniqueLoadouts([incumbent, ...screened.slice(0, options.finalists).map(s => s.loadout)]);
    onProgress(`${label}: confirm ${finalists.length} candidates × ${options.reps} matches`);
    const confirmed = await score(finalists, options.reps, seed + 1);
    return { best: confirmed[0], candidates: states.length };
  };
  const starts = [model.initial];
  for (let s = 1; s < options.starts; s++) {
    const ratios: Composition[] = s === 1 ? [[60, 39, 1], [50, 1, 49], [60, 1, 39]] : [[50, 1, 49], [60, 39, 1], [50, 49, 1]];
    starts.push({ ...model.initial, troops: model.initial.troops.map((c, i) =>
      countsFromRatios(c.reduce((a, b) => a + b, 0), ratios[i])) as Loadout["troops"] });
  }
  for (let start = 0; start < starts.length; start++) {
    let current = starts[start];
    archive.push(current);
    for (let pass = 0; pass < options.passes; pass++) {
      for (const stage of passOrder(pass)) {
        const label = `Start ${start + 1}/${starts.length}, pass ${pass + 1}/${options.passes}, ${stage}`;
        let candidateCount = 0;
        let report: ScoredLoadout;
        if (stage !== "troops") {
          const result = await race(current, stage === "heroes" ? heroCandidates(model, current, config) : gearCandidates(current), label);
          report = result.best;
          current = report.loadout; candidateCount = result.candidates;
        } else {
          // Each composition is scored as a COMPLETE match with the other two marches held fixed.
          for (let army = 0; army < 3; army++) {
            const total = current.troops[army].reduce((sum, n) => sum + n, 0);
            const withCounts = (counts: Composition): Loadout => {
              const troops = [...current.troops] as Loadout["troops"];
              troops[army] = counts;
              return { ...current, troops };
            };
            const coarse = uniqueLoadouts([current, ...coarseCompositions(total, options.coarseStep).map(withCounts)]);
            onProgress(`${label}, army ${army + 1}: coarse ${coarse.length} × ${options.screenReps} matches`);
            const seed = options.seed + 1009 * ++stageSequence;
            const screened = await score(coarse, options.screenReps, seed);
            const roots = uniqueLoadouts([current, ...screened.slice(0, options.seeds).map(s => s.loadout)]);
            const fine = uniqueLoadouts(roots.flatMap(s => localCompositions(s.troops[army], options.coarseStep, options.refineStep).map(withCounts)));
            onProgress(`${label}, army ${army + 1}: refine ${fine.length} × ${options.screenReps} matches`);
            const refined = await score(fine, options.screenReps, seed);
            const neighborhoods = uniqueLoadouts([current, ...refined.slice(0, options.seeds).map(s => s.loadout)]);
            const onePercent = uniqueLoadouts(neighborhoods.flatMap(s => localCompositions(s.troops[army], options.refineStep, 1).map(withCounts)));
            const result = await race(current, onePercent, `${label}, army ${army + 1}, 1%`);
            report = result.best;
            current = report.loadout;
            candidateCount += coarse.length + fine.length + result.candidates;
          }
        }
        archive.push(current);
        history.push({ start: start + 1, pass: pass + 1, stage, candidates: candidateCount, scoreRate: report!.result.scoreRate });
        onProgress(`${label}: score ${(100 * report!.result.scoreRate).toFixed(2)}%`);
      }
    }
  }
  const candidates = uniqueLoadouts(archive);
  onProgress(`Independent validation: ${candidates.length} complete setups × ${options.validationReps} matches`);
  const finalists = await score(candidates, options.validationReps, options.seed + 10_000_019);
  return { best: finalists[0], finalists, history, evaluations, matches };
}

export function createEvaluator(model: SearchModel, config: SimulatorConfig, jobs: number): { evaluate: Evaluate; close: () => Promise<void> } {
  const pool = jobs > 1 ? new BatchWorkerPool<DefinitionEvaluationWorkerTask, OptimizationResult>(jobs,
    () => new WorkerThreadBatchWorker(new URL("./three_army_optimizer.worker.ts", import.meta.url))) : undefined;
  return {
    evaluate: async (loadout, reps, seed) => {
      const task: DefinitionEvaluationWorkerTask = { definition: definitionForLoadout(model, loadout), heroes: heroNames(loadout), side: model.side, reps, seed };
      return pool ? pool.runTask(task) : evaluateOptimizationWorkerTask(task, config);
    },
    close: async () => { await pool?.close(); }
  };
}
function heroNames(loadout: Loadout): string[][] {
  return loadout.heroes.map(h => Array.isArray(h) ? h.map(entry => entry.name) : Object.keys(h ?? {}));
}
export function gearNames(model: SearchModel, loadout: Loadout): GearDefinition["initial_assignment"] {
  return Object.fromEntries(UNIT_TYPES.map(t => [t, loadout.gear[t].map(index => model.gear.sets[t][index].name)])) as GearDefinition["initial_assignment"];
}
export function exportConfiguration(raw: unknown, model: SearchModel, loadout: Loadout, config: SimulatorConfig): Record<string, unknown> {
  const output = structuredClone(object(raw, "configuration"));
  const original = object(output[model.side], model.side);
  const effective = definitionForLoadout(model, loadout);
  // Preserve raw player passives: parseDefinition already merged them into fighter.passive.
  const rawArmies = original.armies as Array<{ name: string; fighter: FighterInput }>;
  original.armies = effective[model.side].map((a, i) => ({ ...rawArmies[i], fighter: {
    ...rawArmies[i].fighter, troops: a.fighter.troops, heroes: a.fighter.heroes,
    stats: applyHeroGenerationStats(a.fighter, config).stats
  } }));
  const provenance = { ...object(output.input_stats_include_hero_generation ?? {}, "input_stats_include_hero_generation"), [model.side]: true };
  output.input_stats_include_hero_generation = provenance;
  output.gear_optimization = { side: model.side, ...model.gear, initial_assignment: gearNames(model, loadout) };
  return output;
}

export function parseCli(argv: string[]): { path: string; options: SearchOptions; output?: string; json: boolean } {
  const options = { ...DEFAULT_OPTIONS };
  let path = ""; let output: string | undefined; let json = false;
  const flags: Record<string, keyof SearchOptions> = {
    "--passes": "passes", "--starts": "starts", "--reps": "reps", "--screen-reps": "screenReps",
    "--validation-reps": "validationReps", "--coarse-step": "coarseStep", "--refine-step": "refineStep",
    "--seeds": "seeds", "--finalists": "finalists", "--max-candidates": "maxCandidates", "--seed": "seed", "--jobs": "jobs"
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") { json = true; continue; }
    if (arg === "--output") { output = argv[++i]; if (!output || output.startsWith("--")) throw new Error("--output needs a path"); continue; }
    if (flags[arg]) { options[flags[arg]] = integer(Number(argv[++i]), arg, arg === "--seed" ? 0 : 1); continue; }
    if (arg.startsWith("--") || path) throw new Error(`Unexpected argument ${arg}`);
    path = arg;
  }
  if (!path) throw new Error("Provide a three-army JSON configuration path; use --help for usage");
  if (!argv.includes("--screen-reps")) options.screenReps = Math.max(1, Math.ceil(options.reps / 10));
  if (!argv.includes("--validation-reps")) options.validationReps = options.reps * 2;
  validateOptions(options);
  return { path, options, output, json };
}
const HELP = `Usage: npx tsx scripts/three_army_loadout_optimizer.ts CONFIG [options]

Existing three-army configs work directly. Optional gear_optimization supplies explicit sets.
Passes alternate heroes/gear/troops and gear/heroes/troops. No old optimizer search is used.
--passes N           Full cycles per start (default 2)
--starts N           1=input; 2=also lancer-heavy; 3=also marksman-heavy (default 1)
--reps N             Exactly N matches per finalist evaluation, for either ordering (default 1000)
--screen-reps N      Matches per quick evaluation (default ceil(reps/10))
--validation-reps N  Matches per independent final evaluation (default 2*reps)
--coarse-step N      Initial percentage grid (default 10)
--refine-step N      Intermediate percentage spacing; ends at 1% (default 2)
--seeds N            Promising neighborhoods retained per troop grid (default 5)
--finalists N        Screen survivors confirmed, plus incumbent (default 10)
--max-candidates N   Hero candidate limit; exceeds it with an error (default 100000)
--seed N             Deterministic seed (default 1)
--jobs N             Worker count (default min(8, CPUs))
--output PATH        Write a reusable winner config with named gear assignments
--json               Machine-readable results on stdout; progress remains on stderr

Zero troop types also try one single troop, including both missing types together.
Full match score = wins + half draws; remaining-troop margin breaks ties.
Reps is per candidate, not a total run budget; starts and passes multiply work.
See scripts/three_army_loadout_optimizer.md for the gear schema and limitations.
`;
export function assertOutputDiffers(input: string, output: string): void {
  if (resolve(input) === resolve(output)) throw new Error("--output must differ from the input path");
  const source = statSync(input);
  let target;
  try { target = statSync(output); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (source.dev === target.dev && source.ino === target.ino) {
    throw new Error("--output must differ from the input path, including links");
  }
}

export function prepareArtifactDirectory(output: string, reserved: RegExp): string {
  if (reserved.test(basename(output))) throw new Error("--output filename is reserved for a run artifact");
  const root = dirname(resolve(output));
  mkdirSync(dirname(root), { recursive: true });
  try { mkdirSync(root); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("Choose a fresh output directory; it must not already exist, including links");
    }
    throw error;
  }
  return root;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  if (argv.includes("--help")) { process.stdout.write(HELP); return; }
  const cli = parseCli(argv);
  if (cli.output) assertOutputDiffers(cli.path, cli.output);
  const raw = JSON.parse(readFileSync(cli.path, "utf8"));
  const config = loadSimulatorConfig();
  const model = createSearchModel(raw, config);
  const heroCount = model.definition.optimization ? countOptimizationCandidates(createHeroOptimizationWorkerContext(model.definition, config), cli.options.maxCandidates) : 1;
  const log = (s: string) => process.stderr.write(`${s}\n`);
  log(`Optimizing ${model.side}; ordering=${model.definition.ordering}; ${cli.options.starts} start(s) × ${cli.options.passes} passes.`);
  log(`Each pass: ${heroCount} hero combinations, 216 gear assignments, adaptive troop grids per army.`);
  log(`Matches per candidate: screen=${cli.options.screenReps}, finalist=${cli.options.reps}, independent validation=${cli.options.validationReps}. Jobs=${cli.options.jobs}.`);
  log(model.inferredGear ? "Gear inferred from input residual stats (account + equipped gear); assumes shared account stats across armies." : "Using explicit gear sets and shared base stats.");
  const runner = createEvaluator(model, config, cli.options.jobs);
  let result: SearchResult;
  try { result = await searchLoadouts(model, config, cli.options, runner.evaluate, log); }
  finally { await runner.close(); }
  const winnerConfig = exportConfiguration(raw, model, result.best.loadout, config);
  if (cli.output) {
    writeFileSync(cli.output, JSON.stringify(winnerConfig, null, 2) + "\n");
  }
  if (cli.json) {
    process.stdout.write(JSON.stringify({ ...result, options: cli.options, gear: model.gear,
      gearAssignments: gearNames(model, result.best.loadout), configuration: winnerConfig }, null, 2) + "\n");
  } else {
    const e = result.best.result.evaluation;
    const wins = model.side === "attacker" ? e.attackerWins : e.defenderWins;
    const score = result.best.result.scoreRate;
    const variance = Math.max(0, (wins + e.draws * 0.25) / e.scenarios - score * score);
    const error = 1.96 * Math.sqrt(variance / e.scenarios);
    console.log(`Validated score: ${(score * 100).toFixed(2)}% (approx. ±${(error * 100).toFixed(2)} percentage points); wins=${wins}, draws=${e.draws}, matches=${e.scenarios}`);
    for (let i = 0; i < 3; i++) console.log(`${model.definition[model.side][i].name}: ${heroNames(result.best.loadout)[i].join(" / ")}; troops=${result.best.loadout.troops[i].join(" / ")}; gear=${UNIT_TYPES.map(t => model.gear.sets[t][result.best.loadout.gear[t][i]].name).join(" / ")}`);
    console.log(`Evaluations=${result.evaluations}; total matches=${result.matches}${cli.output ? `; configuration=${cli.output}` : ""}`);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
