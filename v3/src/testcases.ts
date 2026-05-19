import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  addCalibrationTableRow,
  loadCalibrationComparison,
  readCalibrationCase,
  type CalibrationCaseComparison,
  type CalibrationComparison,
  type SampleStats,
  sampleStats
} from "./calibration.js";
import { simulateBattle } from "./simulator.js";
import type { BattleInput, BattleResult, FighterInput, SimulatorConfig, UnitType } from "./types.js";

export interface TestcaseRunOptions {
  testcaseRoot?: string;
  calibrationReportPath?: string;
  matching?: string;
  includeDisabled?: boolean;
  repeat?: number;
  seed?: string | number;
  trace?: boolean;
}

export interface TestcaseCaseReport {
  file: string;
  testcaseId: string;
  index: number;
  diagnostics: string[];
  gameResult?: unknown;
  calibration?: CalibrationCaseComparison;
  result?: BattleResult;
  v3ScoreDelta?: number;
  v3Stats?: SampleStats;
  deterministic?: boolean;
  sampleCount?: number;
  visibility: {
    attacker: CaseVisibility;
    defender: CaseVisibility;
  };
  error?: string;
}

export interface TestcaseRunReport {
  selectedFiles: string[];
  selectedCases: number;
  cases: TestcaseCaseReport[];
  aggregate: {
    parsedFiles: number;
    parseErrors: number;
    adaptedCases: number;
    executedCases: number;
    unexpectedErrors: number;
    diagnostics: number;
  };
  comparison: CalibrationComparison;
}

interface CaseVisibility {
  heroes: string[];
  troopSkillIds: string[];
  troops: Partial<Record<UnitType, number>>;
  skillEffectActivations: number;
}

export function defaultTestcaseRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "testcases");
}

export function discoverTestcaseFiles(options: Pick<TestcaseRunOptions, "testcaseRoot" | "matching" | "includeDisabled"> = {}): string[] {
  const root = resolve(options.testcaseRoot ?? defaultTestcaseRoot());
  const files: string[] = [];
  walk(root, files);
  return files
    .filter((file) => isDiscoverableTestcaseFile(file, options.includeDisabled))
    .filter((file) => options.includeDisabled || (!file.endsWith(".disabled") && !file.endsWith(".stale_troops")))
    .filter((file) => !options.matching || file.includes(options.matching))
    .sort();
}

export function runTestcases(options: TestcaseRunOptions, config: SimulatorConfig): TestcaseRunReport {
  const files = discoverTestcaseFiles(options);
  const cases: TestcaseCaseReport[] = [];
  const aggregate = { parsedFiles: 0, parseErrors: 0, adaptedCases: 0, executedCases: 0, unexpectedErrors: 0, diagnostics: 0 };
  const comparison = loadCalibrationComparison(options.calibrationReportPath);
  const repeat = Math.max(1, options.repeat ?? 1);

  for (const file of files) {
    let entries: unknown[];
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      entries = Array.isArray(parsed) ? parsed : [parsed];
      aggregate.parsedFiles += 1;
    } catch (error) {
      aggregate.parseErrors += 1;
      cases.push(emptyCaseReport(file, "(parse_error)", 0, [`Failed to parse JSON: ${errorMessage(error)}`]));
      continue;
    }

    entries.forEach((entry, index) => {
      const testcaseId = testcaseIdFor(entry, index);
      const diagnostics: string[] = [];
      const report: TestcaseCaseReport = emptyCaseReport(file, testcaseId, index, diagnostics);
      try {
        const input = adaptTestcaseEntry(entry, { seed: options.seed, trace: options.trace }, diagnostics);
        aggregate.adaptedCases += 1;
        const samples: number[] = [];
        let result = simulateBattle(sampleInput(input, options.seed, file, testcaseId, index, 0), config);
        const firstScore = battleScoreDelta(result);
        if (firstScore !== undefined) samples.push(firstScore);
        const sampleCount = result.randomness.deterministic ? 1 : repeat;
        for (let iteration = 1; iteration < sampleCount; iteration += 1) {
          result = simulateBattle(sampleInput(input, options.seed, file, testcaseId, index, iteration), config);
          const score = battleScoreDelta(result);
          if (score !== undefined) samples.push(score);
        }
        const stats = sampleStats(samples);
        report.result = result;
        report.deterministic = result.randomness.deterministic;
        report.sampleCount = sampleCount;
        report.v3Stats = stats;
        report.v3ScoreDelta = battleScoreDelta(result);
        aggregate.executedCases += 1;
        report.gameResult = (entry as { game_report_result?: unknown }).game_report_result;
        report.calibration = readCalibrationCase(comparison, relative(process.cwd(), file), testcaseId, { index });
        addCalibrationTableRow(comparison, {
          file,
          testcaseId,
          index,
          v3ScoreDelta: report.v3ScoreDelta,
          v3Stats: report.v3Stats,
          calibration: report.calibration
        });
        report.visibility = visibilityFromResult(result);
        if (result) diagnostics.push(...result.resolved.attacker.diagnostics, ...result.resolved.defender.diagnostics);
      } catch (error) {
        aggregate.unexpectedErrors += 1;
        report.error = errorMessage(error);
        diagnostics.push(report.error);
      }
      aggregate.diagnostics += diagnostics.length;
      cases.push(report);
    });
  }

  return { selectedFiles: files, selectedCases: cases.length, cases, aggregate, comparison };
}

export function adaptTestcaseEntry(entry: unknown, options: { seed?: string | number; trace?: boolean } = {}, diagnostics: string[] = []): BattleInput {
  const object = entry as {
    attacker?: FighterInput;
    defender?: FighterInput;
    test_id?: string;
    mechanics?: Record<string, unknown>;
    engagement_type?: unknown;
    engagementType?: unknown;
    maxRounds?: unknown;
    max_rounds?: unknown;
  };
  if (!object.attacker || !object.defender) throw new Error(`Testcase ${object.test_id ?? "(unknown)"} is missing attacker or defender`);
  diagnostics.push(...diagnoseFighterShape("attacker", object.attacker), ...diagnoseFighterShape("defender", object.defender));
  const mechanics = testcaseMechanics(object);
  const maxRounds = optionalNumber(object.maxRounds ?? object.max_rounds);
  return {
    attacker: object.attacker,
    defender: object.defender,
    seed: options.seed,
    trace: options.trace,
    ...(maxRounds !== undefined ? { maxRounds } : {}),
    ...(mechanics ? { mechanics } : {})
  };
}

export function battleScoreDelta(value: unknown): number | undefined {
  if (isBattleResult(value)) return totalSide(value.remaining.attacker) - totalSide(value.remaining.defender);
  const gameResult = Array.isArray(value) ? value[0] : value;
  if (!gameResult || typeof gameResult !== "object") return undefined;
  const attacker = Number((gameResult as { attacker?: unknown }).attacker);
  const defender = Number((gameResult as { defender?: unknown }).defender);
  if (!Number.isFinite(attacker) || !Number.isFinite(defender)) return undefined;
  return attacker - defender;
}

function isDiscoverableTestcaseFile(file: string, includeDisabled?: boolean): boolean {
  if (file.endsWith(".json")) return true;
  return !!includeDisabled && (file.endsWith(".json.disabled") || file.endsWith(".json.stale_troops"));
}

function walk(path: string, files: string[]): void {
  const stat = statSync(path);
  if (stat.isDirectory()) {
    for (const child of readdirSync(path)) walk(resolve(path, child), files);
  } else if (stat.isFile()) {
    files.push(path);
  }
}

function emptyCaseReport(file: string, testcaseId: string, index: number, diagnostics: string[]): TestcaseCaseReport {
  return {
    file,
    testcaseId,
    index,
    diagnostics,
    visibility: {
      attacker: { heroes: [], troopSkillIds: [], troops: {}, skillEffectActivations: 0 },
      defender: { heroes: [], troopSkillIds: [], troops: {}, skillEffectActivations: 0 }
    }
  };
}

function testcaseIdFor(entry: unknown, index: number): string {
  const id = (entry as { test_id?: unknown; id?: unknown }).test_id ?? (entry as { id?: unknown }).id;
  return id === undefined ? `case_${index}` : String(id);
}

function diagnoseFighterShape(side: string, fighter: FighterInput): string[] {
  const diagnostics: string[] = [];
  if (!fighter.troops || Object.keys(fighter.troops).length === 0) diagnostics.push(`${side} has no troops`);
  if (!fighter.stats) diagnostics.push(`${side} has no stats block`);
  return diagnostics;
}

function testcaseMechanics(entry: { mechanics?: Record<string, unknown>; engagement_type?: unknown; engagementType?: unknown }): Record<string, unknown> | undefined {
  const mechanics = entry.mechanics && typeof entry.mechanics === "object" ? { ...entry.mechanics } : {};
  if (entry.engagement_type !== undefined) mechanics.engagement_type = entry.engagement_type;
  if (entry.engagementType !== undefined) mechanics.engagementType = entry.engagementType;
  return Object.keys(mechanics).length > 0 ? mechanics : undefined;
}

function visibilityFromResult(result: BattleResult | undefined): TestcaseCaseReport["visibility"] {
  if (!result) {
    return {
      attacker: { heroes: [], troopSkillIds: [], troops: {}, skillEffectActivations: 0 },
      defender: { heroes: [], troopSkillIds: [], troops: {}, skillEffectActivations: 0 }
    };
  }
  return {
    attacker: {
      heroes: result.resolved.attacker.heroes.map((hero) => hero.name),
      troopSkillIds: result.resolved.attacker.troopSkillIds,
      troops: result.resolved.attacker.troops,
      skillEffectActivations: result.effectActivationCounts.attacker
    },
    defender: {
      heroes: result.resolved.defender.heroes.map((hero) => hero.name),
      troopSkillIds: result.resolved.defender.troopSkillIds,
      troops: result.resolved.defender.troops,
      skillEffectActivations: result.effectActivationCounts.defender
    }
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function isBattleResult(value: unknown): value is BattleResult {
  return !!value && typeof value === "object" && "remaining" in value;
}

function totalSide(troops: Record<UnitType, number>): number {
  return (troops.infantry ?? 0) + (troops.lancer ?? 0) + (troops.marksman ?? 0);
}

function sampleSeed(baseSeed: string | number | undefined, file: string, testcaseId: string, index: number, iteration: number): string {
  return `${baseSeed ?? "v3-default"}:${relative(process.cwd(), file)}:${testcaseId}:${index}:${iteration}`;
}

function sampleInput(input: BattleInput, baseSeed: string | number | undefined, file: string, testcaseId: string, index: number, iteration: number): BattleInput {
  return { ...input, seed: sampleSeed(baseSeed ?? input.seed, file, testcaseId, index, iteration) };
}
