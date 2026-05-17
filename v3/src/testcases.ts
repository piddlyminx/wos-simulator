import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readDashboardCase, readDashboardComparison, type DashboardCaseComparison, type DashboardComparison } from "./dashboard.js";
import { simulateBattle } from "./simulator.js";
import type { BattleInput, BattleResult, FighterInput, SimulatorConfig, UnitType } from "./types.js";

export interface TestcaseRunOptions {
  testcaseRoot?: string;
  dashboardSqlitePath?: string;
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
  dashboard?: DashboardCaseComparison;
  result?: BattleResult;
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
  comparison: DashboardComparison;
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
  const comparison = readDashboardComparison(options.dashboardSqlitePath);
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
        let result: BattleResult | undefined;
        for (let iteration = 0; iteration < repeat; iteration += 1) {
          result = simulateBattle(input, config);
        }
        report.result = result;
        aggregate.executedCases += 1;
        report.gameResult = (entry as { game_report_result?: unknown }).game_report_result;
        report.dashboard = readDashboardCase(options.dashboardSqlitePath, relative(process.cwd(), file), testcaseId, {
          runId: comparison.latestRun?.id,
          index
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
  const object = entry as { attacker?: FighterInput; defender?: FighterInput; test_id?: string };
  if (!object.attacker || !object.defender) throw new Error(`Testcase ${object.test_id ?? "(unknown)"} is missing attacker or defender`);
  diagnostics.push(...diagnoseFighterShape("attacker", object.attacker), ...diagnoseFighterShape("defender", object.defender));
  return {
    attacker: object.attacker,
    defender: object.defender,
    maxRounds: 100,
    seed: options.seed,
    trace: options.trace
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

function isBattleResult(value: unknown): value is BattleResult {
  return !!value && typeof value === "object" && "remaining" in value;
}

function totalSide(troops: Record<UnitType, number>): number {
  return (troops.infantry ?? 0) + (troops.lancer ?? 0) + (troops.marksman ?? 0);
}
