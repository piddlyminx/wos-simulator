#!/usr/bin/env tsx
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadSimulatorConfigFromDir } from "../simulator/src/config-node";
import { simulateBattle, signedRemainingScore } from "../simulator/src/simulator";
import { UNIT_TYPES } from "../simulator/src/types";
import type { BattleInput, FighterInput, SimulatorConfig, StatBlock, TroopStatsCatalogue, UnitType } from "../simulator/src/types";

export interface EnemyBaseStats {
  lancerAttack: number;
  lancerHealth: number;
}

export interface EnemyBaseStatsInput {
  lancerHealth: number;
}

export interface SearchRange {
  min: number;
  max: number;
  step: number;
}

export interface LabSide {
  troops: Record<UnitType, number>;
  troopTypes: Record<UnitType, string>;
  stats: Record<UnitType, StatBlock>;
}

export interface ParsedLabReport {
  file: string;
  expectedOutcome: number;
  attacker: LabSide;
  defender: LabSide;
  warnings?: string[];
}

export interface CandidateFit extends EnemyBaseStats {
  meanSignedError: number;
  absoluteMeanSignedError: number;
  meanAbsoluteError: number;
  rootMeanSquaredError: number;
  maxAbsoluteError: number;
  reports: ReportFit[];
}

export interface ReportFit {
  file: string;
  expected: number;
  simulated: number;
  error: number;
}

export interface FitResult {
  best: CandidateFit;
  evaluatedCandidates: number;
}

export interface FindBestOptions {
  lancerHealth: SearchRange;
  scoreCandidate: (candidate: EnemyBaseStats, report: ParsedLabReport) => number;
  objective?: FitObjective;
}

type EnemySide = "attacker" | "defender";
type FitObjective = "bias" | "mae" | "rmse";

interface ParserCacheEntry {
  mtimeMs: number;
  parsed: ParsedLabReport;
}

interface CliOptions {
  projectDir: string;
  reportsDir: string;
  configDir: string;
  parserScript: string;
  python?: string;
  cacheFile: string;
  enemySide: EnemySide;
  health: SearchRange;
  replicates: number;
  top: number;
  noCache: boolean;
  help: boolean;
  objective: FitObjective;
}

const DEFAULT_HEALTH_RANGE: SearchRange = { min: 50, max: 1800, step: 25 };
const ENEMY_TROOP_IDS: Record<UnitType, string> = {
  infantry: "lab_enemy_infantry_t10",
  lancer: "lab_enemy_lancer_t10",
  marksman: "lab_enemy_marksman_t10",
};

export function parseOutcomeFromFilename(file: string): { leftAlive: number; rightAlive: number; signedOutcome: number } {
  const match = basename(file).match(/^(\d+)-(\d+)\.png$/i);
  if (!match) throw new Error(`Expected lab report filename like leftAlive-rightAlive.png: ${file}`);
  const leftAlive = Number(match[1]);
  const rightAlive = Number(match[2]);
  return { leftAlive, rightAlive, signedOutcome: leftAlive - rightAlive };
}

export function deriveEnemyBaseStats(input: EnemyBaseStatsInput): EnemyBaseStats {
  return {
    lancerAttack: input.lancerHealth * 3,
    lancerHealth: input.lancerHealth,
  };
}

export function buildEnemyTroopStats(input: EnemyBaseStatsInput): Record<UnitType, StatBlock> {
  const base = deriveEnemyBaseStats(input);
  return {
    infantry: { attack: base.lancerHealth, defense: 10, lethality: 10, health: base.lancerAttack },
    lancer: { attack: base.lancerAttack, defense: 10, lethality: 10, health: base.lancerHealth },
    marksman: { attack: base.lancerAttack * 4 / 3, defense: 10, lethality: 10, health: base.lancerHealth * 3 / 4 },
  };
}

export function findBestEnemyBaseStats(reports: ParsedLabReport[], options: FindBestOptions): FitResult {
  if (reports.length === 0) throw new Error("No parsed lab reports were supplied");

  let best: CandidateFit | undefined;
  let evaluatedCandidates = 0;

  for (const lancerHealth of rangeValues(options.lancerHealth)) {
    const candidate = deriveEnemyBaseStats({ lancerHealth });
    const reportFits = reports.map((report) => {
      const simulated = options.scoreCandidate(candidate, report);
      return {
        file: report.file,
        expected: report.expectedOutcome,
        simulated,
        error: simulated - report.expectedOutcome,
      };
    });
    const fit = summarizeCandidate(candidate, reportFits);
    evaluatedCandidates += 1;
    if (!best || isBetterFit(fit, best, options.objective ?? "bias")) best = fit;
  }

  if (!best) throw new Error("Search ranges produced no candidate values");
  return { best, evaluatedCandidates };
}

export function buildConfigWithEnemyStats(config: SimulatorConfig, base: EnemyBaseStats): SimulatorConfig {
  const stats = buildEnemyTroopStats(base);
  const troopStats: TroopStatsCatalogue = { ...config.troopStats };
  for (const unit of UNIT_TYPES) {
    troopStats[ENEMY_TROOP_IDS[unit]] = {
      id: ENEMY_TROOP_IDS[unit],
      type: unit,
      tier: 10,
      fc: 0,
      stats: {
        Attack: stats[unit].attack,
        Defense: stats[unit].defense,
        Lethality: stats[unit].lethality,
        Health: stats[unit].health,
      },
    };
  }
  return { ...config, troopStats };
}

export function buildBattleInput(report: ParsedLabReport, enemySide: EnemySide, seed: string | number): BattleInput {
  return {
    attacker: buildFighterInput(report.attacker, enemySide === "attacker"),
    defender: buildFighterInput(report.defender, enemySide === "defender"),
    seed,
    maxRounds: 1500,
  };
}

export function parseDashboardReport(raw: unknown, file: string): ParsedLabReport {
  if (!isRecord(raw)) throw new Error(`Parser output for ${file} is not an object`);
  if (typeof raw.error === "string") throw new Error(`Parser failed for ${file}: ${raw.error}`);
  return {
    file,
    expectedOutcome: parseOutcomeFromFilename(file).signedOutcome,
    attacker: normalizeSide(raw.attacker, file, "attacker"),
    defender: normalizeSide(raw.defender, file, "defender"),
    warnings: Array.isArray(raw.warnings) ? raw.warnings.map(String) : undefined,
  };
}

export function parseLabReports(options: Pick<CliOptions, "projectDir" | "reportsDir" | "parserScript" | "python" | "cacheFile" | "noCache">): ParsedLabReport[] {
  const files = readdirSync(options.reportsDir)
    .filter((name) => /^\d+-\d+\.png$/i.test(name))
    .sort()
    .map((name) => join(options.reportsDir, name));
  if (files.length === 0) throw new Error(`No leftAlive-rightAlive PNG reports found in ${options.reportsDir}`);

  const cache = options.noCache ? {} : readParserCache(options.cacheFile);
  const nextCache: Record<string, ParserCacheEntry> = {};
  const parsed: ParsedLabReport[] = [];

  for (const file of files) {
    const mtimeMs = readFileSync(file, "base64").length;
    const cached = cache[file];
    if (cached && cached.mtimeMs === mtimeMs) {
      parsed.push(cached.parsed);
      nextCache[file] = cached;
      continue;
    }
    const report = parseDashboardReport(runReportParser(file, options.parserScript, options), file);
    parsed.push(report);
    nextCache[file] = { mtimeMs, parsed: report };
  }

  if (!options.noCache) writeFileSync(options.cacheFile, JSON.stringify(nextCache, null, 2) + "\n");
  return parsed;
}

function buildFighterInput(side: LabSide, useEnemyTroops: boolean): FighterInput {
  return {
    troops: Object.fromEntries(UNIT_TYPES.map((unit) => [useEnemyTroops ? ENEMY_TROOP_IDS[unit] : side.troopTypes[unit], side.troops[unit]])),
    stats: side.stats,
  };
}

function normalizeSide(raw: unknown, file: string, sideName: string): LabSide {
  if (!isRecord(raw)) throw new Error(`Parser output for ${file} is missing ${sideName}`);
  const troopsRaw = readRecord(raw.troops, file, `${sideName}.troops`);
  const troopTypesRaw = readRecord(raw.troop_types, file, `${sideName}.troop_types`);
  const statsRaw = readRecord(raw.stats, file, `${sideName}.stats`);
  return {
    troops: Object.fromEntries(UNIT_TYPES.map((unit) => [unit, readNumber(troopsRaw[unit], file, `${sideName}.troops.${unit}`)])) as Record<UnitType, number>,
    troopTypes: Object.fromEntries(UNIT_TYPES.map((unit) => [unit, readString(troopTypesRaw[unit], file, `${sideName}.troop_types.${unit}`)])) as Record<UnitType, string>,
    stats: Object.fromEntries(UNIT_TYPES.map((unit) => [unit, normalizeStats(readRecord(statsRaw[unit], file, `${sideName}.stats.${unit}`), file, `${sideName}.stats.${unit}`)])) as Record<UnitType, StatBlock>,
  };
}

function normalizeStats(raw: Record<string, unknown>, file: string, path: string): StatBlock {
  return {
    attack: readNumber(raw.attack, file, `${path}.attack`),
    defense: readNumber(raw.defense, file, `${path}.defense`),
    lethality: readNumber(raw.lethality, file, `${path}.lethality`),
    health: readNumber(raw.health, file, `${path}.health`),
  };
}

function readRecord(value: unknown, file: string, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Parser output for ${file} is missing ${path}`);
  return value;
}

function readNumber(value: unknown, file: string, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Parser output for ${file} has invalid ${path}`);
  return value;
}

function readString(value: unknown, file: string, path: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Parser output for ${file} has invalid ${path}`);
  return value;
}

function runReportParser(
  file: string,
  parserScript: string,
  options: Pick<CliOptions, "projectDir" | "python">,
): unknown {
  const imageBase64 = readFileSync(file, "base64");
  const command = options.python ?? "uv";
  const args = options.python ? [parserScript] : ["run", "python", parserScript];
  const result = spawnSync(command, args, {
    cwd: options.projectDir,
    input: JSON.stringify({ image_base64: imageBase64 }),
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`Parser exited ${result.status} for ${file}: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout) as unknown;
}

function readParserCache(cacheFile: string): Record<string, ParserCacheEntry> {
  if (!existsSync(cacheFile)) return {};
  return JSON.parse(readFileSync(cacheFile, "utf8")) as Record<string, ParserCacheEntry>;
}

function summarizeCandidate(candidate: EnemyBaseStats, reports: ReportFit[]): CandidateFit {
  const absoluteErrors = reports.map((report) => Math.abs(report.error));
  const squaredErrors = reports.map((report) => report.error ** 2);
  const meanSignedError = sum(reports.map((report) => report.error)) / reports.length;
  return {
    ...candidate,
    meanSignedError,
    absoluteMeanSignedError: Math.abs(meanSignedError),
    meanAbsoluteError: sum(absoluteErrors) / reports.length,
    rootMeanSquaredError: Math.sqrt(sum(squaredErrors) / reports.length),
    maxAbsoluteError: Math.max(...absoluteErrors),
    reports,
  };
}

function isBetterFit(candidate: CandidateFit, incumbent: CandidateFit, objective: FitObjective): boolean {
  const candidatePrimary = objectiveValue(candidate, objective);
  const incumbentPrimary = objectiveValue(incumbent, objective);
  if (candidatePrimary !== incumbentPrimary) return candidatePrimary < incumbentPrimary;
  if (candidate.absoluteMeanSignedError !== incumbent.absoluteMeanSignedError) {
    return candidate.absoluteMeanSignedError < incumbent.absoluteMeanSignedError;
  }
  if (candidate.meanAbsoluteError !== incumbent.meanAbsoluteError) return candidate.meanAbsoluteError < incumbent.meanAbsoluteError;
  if (candidate.rootMeanSquaredError !== incumbent.rootMeanSquaredError) return candidate.rootMeanSquaredError < incumbent.rootMeanSquaredError;
  return candidate.maxAbsoluteError < incumbent.maxAbsoluteError;
}

function objectiveValue(fit: CandidateFit, objective: FitObjective): number {
  if (objective === "mae") return fit.meanAbsoluteError;
  if (objective === "rmse") return fit.rootMeanSquaredError;
  return fit.absoluteMeanSignedError;
}

function* rangeValues(range: SearchRange): Generator<number> {
  if (range.step <= 0) throw new Error(`Range step must be positive: ${JSON.stringify(range)}`);
  for (let value = range.min; value <= range.max + range.step / 1_000_000; value += range.step) {
    yield roundStat(value);
  }
}

function roundStat(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function simulateCandidate(baseConfig: SimulatorConfig, enemySide: EnemySide, replicates: number): (candidate: EnemyBaseStats, report: ParsedLabReport) => number {
  let lastKey = "";
  let lastConfig = baseConfig;
  return (candidate, report) => {
    const key = `${candidate.lancerAttack}:${candidate.lancerHealth}`;
    if (key !== lastKey) {
      lastConfig = buildConfigWithEnemyStats(baseConfig, candidate);
      lastKey = key;
    }
    let total = 0;
    for (let index = 0; index < replicates; index += 1) {
      total += signedRemainingScore(simulateBattle(buildBattleInput(report, enemySide, `${basename(report.file)}:${index}`), lastConfig, { mode: "fast" }));
    }
    return total / replicates;
  };
}

function parseCliArgs(argv: string[]): CliOptions {
  const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const defaults: CliOptions = {
    projectDir: repoRoot,
    reportsDir: join(repoRoot, "tmp/lab"),
    configDir: join(repoRoot, "simulator/config"),
    parserScript: join(repoRoot, "skill/scripts/report_stats_parser.py"),
    cacheFile: join(repoRoot, "tmp/lab/report_stats_cache.json"),
    enemySide: "defender",
    health: DEFAULT_HEALTH_RANGE,
    replicates: 25,
    top: 10,
    noCache: false,
    help: false,
    objective: "bias",
  };

  const options = { ...defaults };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (!value) throw new Error(`Missing value after ${arg}`);
      return value;
    };
    if (arg === "--reports-dir") options.reportsDir = resolve(next());
    else if (arg === "--config-dir") options.configDir = resolve(next());
    else if (arg === "--parser-script") options.parserScript = resolve(next());
    else if (arg === "--python") options.python = resolve(next());
    else if (arg === "--cache-file") options.cacheFile = resolve(next());
    else if (arg === "--enemy-side") options.enemySide = parseEnemySide(next());
    else if (arg === "--attack") throw new Error("--attack is no longer accepted; lancer attack is derived as lancer health * 3");
    else if (arg === "--health") options.health = parseRange(next(), "--health");
    else if (arg === "--replicates") options.replicates = parsePositiveInteger(next(), "--replicates");
    else if (arg === "--objective") options.objective = parseObjective(next());
    else if (arg === "--top") options.top = Math.max(1, Math.floor(Number(next())));
    else if (arg === "--no-cache") options.noCache = true;
    else if (arg === "--help" || arg === "-h") {
      options.help = true;
      return options;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function parseObjective(value: string): FitObjective {
  if (value === "bias" || value === "mae" || value === "rmse") return value;
  throw new Error("--objective must be bias, mae, or rmse");
}

function parseEnemySide(value: string): EnemySide {
  if (value === "right" || value === "defender") return "defender";
  if (value === "left" || value === "attacker") return "attacker";
  throw new Error("--enemy-side must be right, left, attacker, or defender");
}

function parseRange(value: string, label: string): SearchRange {
  const match = value.match(/^([0-9.]+):([0-9.]+):([0-9.]+)$/);
  if (!match) throw new Error(`${label} must be min:max:step`);
  const range = { min: Number(match[1]), max: Number(match[2]), step: Number(match[3]) };
  if (!Number.isFinite(range.min) || !Number.isFinite(range.max) || !Number.isFinite(range.step) || range.min > range.max || range.step <= 0) {
    throw new Error(`${label} must be a finite min:max:positiveStep range`);
  }
  return range;
}

function printUsage(): void {
  console.log(`Usage: npx tsx scripts/fit_enemy_base_stats.ts [options]

Fits weaker T10 enemy base stats from tmp/lab leftAlive-rightAlive reports.

Options:
  --reports-dir DIR       Directory of report PNGs (default: tmp/lab)
  --enemy-side SIDE       right|left|defender|attacker (default: right)
  --health MIN:MAX:STEP   Lancer health search range (default: 50:1800:25)
  --objective bias|mae|rmse
                         Fit objective (default: bias)
  --replicates N         Simulator rolls per report and candidate (default: 25)
  --python PATH           Use an explicit Python instead of uv run python
  --no-cache              Re-run OCR parser instead of using report_stats_cache.json
  --top N                 Number of per-report rows to print (default: 10)
`);
}

function printResult(result: FitResult, top: number): void {
  const stats = buildEnemyTroopStats(result.best);
  console.log(`evaluated candidates: ${result.evaluatedCandidates}`);
  console.log(`best lancer attack: ${result.best.lancerAttack}`);
  console.log(`best lancer health: ${result.best.lancerHealth}`);
  console.log(`mean signed error: ${result.best.meanSignedError.toFixed(2)}`);
  console.log(`absolute mean signed error: ${result.best.absoluteMeanSignedError.toFixed(2)}`);
  console.log(`mean absolute error: ${result.best.meanAbsoluteError.toFixed(2)}`);
  console.log(`root mean squared error: ${result.best.rootMeanSquaredError.toFixed(2)}`);
  console.log(`max absolute error: ${result.best.maxAbsoluteError.toFixed(2)}`);
  console.log("enemy base stats:");
  for (const unit of UNIT_TYPES) console.log(`  ${unit}: ${JSON.stringify(stats[unit])}`);
  console.log("report fits:");
  for (const row of result.best.reports.slice(0, top)) {
    console.log(`  ${basename(row.file)} expected=${row.expected.toFixed(0)} simulated=${row.simulated.toFixed(0)} error=${row.error.toFixed(0)}`);
  }
}

function main(): void {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }
  const reports = parseLabReports(options);
  const baseConfig = loadSimulatorConfigFromDir(options.configDir);
  const result = findBestEnemyBaseStats(reports, {
    lancerHealth: options.health,
    scoreCandidate: simulateCandidate(baseConfig, options.enemySide, options.replicates),
    objective: options.objective,
  });
  printResult(result, options.top);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
