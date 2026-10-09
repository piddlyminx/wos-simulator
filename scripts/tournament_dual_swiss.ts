#!/usr/bin/env tsx
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createBattleTaskRunner } from "./tournament/battleRunner";
import { runBenchmarkFinals, type BenchmarkStage } from "./tournament/benchmarkFinals";
import { runDualSwissTournament, type BattleTaskRunner } from "./tournament/dualSwiss";
import { summarizeTeamHeuristics } from "./tournament/heuristics";
import { Pool } from "./tournament/pools";
import { loadPlayerStatsProfile } from "./tournament/playerStats";
import { copyQualifierCsvs, deriveResultsLabel, loadAllRankedTeamsFromCsv, writeResultsCsv } from "./tournament/results";
import { generateTeams, parseRatio } from "./tournament/teamGeneration";
import type { Team } from "./tournament/types";

export interface CliOptions {
  ratios: string[];
  total: number;
  rounds: number;
  timeLimit?: number;
  seedRounds: number;
  reps: number;
  topN: number;
  jobs: number;
  batchSize: number;
  seed: number;
  freezeRate: number;
  freezeLossesGte?: number;
  startFreezeRound: number;
  minPoolSize: number;
  screenTopM: number;
  screenReps: number;
  benchmarkTopM: number;
  benchmarkSize: number;
  finalsTopM: number;
  finalsReps: number;
  refinementTopM: number;
  refinementReps: number;
  finalsOnly?: string;
  repeatJoiners: boolean;
  playerStats: string;
}

const VALUE_FLAGS = new Set([
  "--ratios",
  "--total",
  "--rounds",
  "--time-limit",
  "--seed-rounds",
  "--reps",
  "--top-n",
  "--jobs",
  "--batch-size",
  "--batch_size",
  "--seed",
  "--freeze-rate",
  "--freeze-losses-gte",
  "--start-freeze-round",
  "--min-pool-size",
  "--screen-top-m",
  "--screen-reps",
  "--benchmark-top-m",
  "--benchmark-size",
  "--finals-top-m",
  "--finals-reps",
  "--finals-only",
  "--refinement-top-m",
  "--refinement-reps",
  "--player-stats"
]);

export function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    ratios: ["50,20,30"],
    total: 1500000,
    rounds: 30,
    seedRounds: 2,
    reps: 1,
    topN: 500,
    jobs: cpus().length/2 || 4,
    batchSize: 64,
    seed: 1234,
    freezeRate: 0.2,
    startFreezeRound: 8,
    minPoolSize: 200,
    screenTopM: 10000,
    screenReps: 2,
    benchmarkTopM: 1000,
    benchmarkSize: 100,
    finalsTopM: 1000,
    finalsReps: 15,
    refinementTopM: 100,
    refinementReps: 25,
    repeatJoiners: false,
    playerStats: "max"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const rawArg = argv[index];
    const equalsIndex = rawArg.startsWith("--") ? rawArg.indexOf("=") : -1;
    const arg = equalsIndex > 0 ? rawArg.slice(0, equalsIndex) : rawArg;
    const inlineValue = equalsIndex > 0 ? rawArg.slice(equalsIndex + 1) : undefined;
    const readValue = () => nextValue(argv, inlineValue === undefined ? ++index : index, arg, inlineValue);
    switch (arg) {
      case "--ratios": {
        const ratios: string[] = inlineValue === undefined ? [] : [inlineValue];
        while (index + 1 < argv.length && !argv[index + 1].startsWith("--")) {
          ratios.push(argv[index + 1]);
          index += 1;
        }
        if (ratios.length === 0) throw new Error("--ratios requires at least one value");
        options.ratios = ratios;
        break;
      }
      case "--total":
        options.total = parseInteger(readValue(), arg);
        break;
      case "--rounds":
        options.rounds = parseInteger(readValue(), arg);
        break;
      case "--time-limit":
        options.timeLimit = parseNumber(readValue(), arg);
        break;
      case "--seed-rounds":
        options.seedRounds = parseInteger(readValue(), arg);
        break;
      case "--reps":
        options.reps = parseInteger(readValue(), arg);
        break;
      case "--top-n":
        options.topN = parseInteger(readValue(), arg);
        break;
      case "--jobs":
        options.jobs = parseInteger(readValue(), arg);
        break;
      case "--batch-size":
      case "--batch_size":
        options.batchSize = parseInteger(readValue(), arg);
        break;
      case "--seed":
        options.seed = parseInteger(readValue(), arg);
        break;
      case "--freeze-rate":
        options.freezeRate = parseNumber(readValue(), arg);
        break;
      case "--freeze-losses-gte":
        options.freezeLossesGte = parseInteger(readValue(), arg);
        break;
      case "--start-freeze-round":
        options.startFreezeRound = parseInteger(readValue(), arg);
        break;
      case "--min-pool-size":
        options.minPoolSize = parseInteger(readValue(), arg);
        break;
      case "--screen-top-m":
        options.screenTopM = parseInteger(readValue(), arg);
        break;
      case "--screen-reps":
        options.screenReps = parseInteger(readValue(), arg);
        break;
      case "--benchmark-top-m":
        options.benchmarkTopM = parseInteger(readValue(), arg);
        break;
      case "--benchmark-size":
        options.benchmarkSize = parseInteger(readValue(), arg);
        break;
      case "--finals-top-m":
        options.finalsTopM = parseInteger(readValue(), arg);
        break;
      case "--finals-reps":
        options.finalsReps = parseInteger(readValue(), arg);
        break;
      case "--finals-only":
        options.finalsOnly = readValue();
        break;
      case "--refinement-top-m":
        options.refinementTopM = parseInteger(readValue(), arg);
        break;
      case "--refinement-reps":
        options.refinementReps = parseInteger(readValue(), arg);
        break;
      case "--player-stats":
        options.playerStats = readValue();
        break;
      case "--repeat-joiners":
        options.repeatJoiners = true;
        break;
      case "--help":
      case "-h":
        throw new Error(helpText());
      default:
        throw new Error(`Unknown option ${arg}`);
    }
  }

  validateOptions(options);
  return options;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseCliArgs(argv);
  const playerStats = loadPlayerStatsProfile(args.playerStats);
  const printProgress = createProgressReporter();
  let topAttackers: Team[] | undefined;
  let topDefenders: Team[] | undefined;
  let outDir: string;
  let taskRunner: ReturnType<typeof createBattleTaskRunner> | undefined;
  const runTasksWithPersistentPool: BattleTaskRunner = async (tasks, _jobs, onProgress) => {
    taskRunner ??= createBattleTaskRunner(args.jobs, args.batchSize);
    return await taskRunner.run(tasks, onProgress);
  };

  try {
    if (args.finalsOnly) {
      const offenseCsv = join(args.finalsOnly, "swiss_off.csv");
      const defenseCsv = join(args.finalsOnly, "swiss_def.csv");
      topAttackers = loadAllRankedTeamsFromCsv(offenseCsv, args.total);
      topDefenders = loadAllRankedTeamsFromCsv(defenseCsv, args.total);
      outDir = freshOutputDirectory(deriveResultsLabel(args.finalsOnly));
      copyQualifierCsvs(args.finalsOnly, outDir);
      console.log(`Loaded finals qualifiers from ${args.finalsOnly}`);
      console.log(`  - Top ${topAttackers.length} attackers from ${offenseCsv}`);
      console.log(`  - Top ${topDefenders.length} defenders from ${defenseCsv}`);
      console.log(`  - Writing fresh finals run to ${outDir}`);
    } else {
      const ratioList = args.ratios.map((ratio) => [ratio.replace(/,/g, "-"), parseRatio(ratio, args.total)] as [string, Team["troops"]]);
      const teams = generateTeams(ratioList, args.repeatJoiners);
      const label = ratioList.length === 1 ? ratioList[0][0] : "mixed";
      outDir = freshOutputDirectory(deriveResultsLabel(label));
      console.log(`Generated ${teams.length} teams across ${ratioList.length} ratio(s)`);
      console.log(`Running dual-ranking Swiss tournament: ${args.rounds} rounds (${args.seedRounds} random + ${Math.max(0, args.rounds - args.seedRounds)} Swiss)`);
      console.log(`  - Reps per battle: ${args.reps}`);
      console.log(`  - Parallel workers: ${args.jobs}`);
      console.log(`  - Worker batch size: ${args.batchSize}`);
      console.log(`  - Player stats: ${args.playerStats}`);
      console.log(`  - Output top ${args.topN} per category`);

      const startedAt = Date.now();
      const [attackPool, defensePool] = await runDualSwissTournament(
        new Pool(teams),
        new Pool(teams),
        {
          totalRounds: args.rounds,
          seedRounds: args.seedRounds,
          reps: args.reps,
          jobs: args.jobs,
          batchSize: args.batchSize,
          seed: args.seed,
          timeLimitMins: args.timeLimit,
          freezeRate: args.freezeRate,
          freezeLossesGte: args.freezeLossesGte,
          startFreezeRound: args.startFreezeRound,
          minPoolSize: args.minPoolSize,
          playerStats
        },
        runTasksWithPersistentPool,
        printProgress
      );
      const duration = (Date.now() - startedAt) / 1000;
      console.log(`\nSwiss tournament complete in ${duration.toFixed(1)}s (${(duration / 60).toFixed(1)}m)`);
      const qualifierRows = args.finalsTopM > 0
        ? Math.max(args.topN, args.screenTopM, args.benchmarkTopM)
        : args.topN;
      writeResultsCsv(join(outDir, "swiss"), attackPool, defensePool, qualifierRows);
      console.log(`  - Saved up to ${qualifierRows} Swiss rows per role for broad-source replay`);
      console.log(`Results saved to ${outDir}`);

      if (args.finalsTopM > 0) {
        topAttackers = attackPool.finalScoresOrdered.map((score) => score.team);
        topDefenders = defensePool.finalScoresOrdered.map((score) => score.team);
      }
    }

    if (args.finalsTopM > 0 && topAttackers && topDefenders) {
      printBenchmarkPlan(topAttackers.length, topDefenders.length, args);
      const panels: Array<Pick<BenchmarkStage, "name" | "games" | "attackPanel" | "defensePanel">> = [];
      await runBenchmarkFinals(
        topAttackers,
        topDefenders,
        { ...args, playerStats },
        runTasksWithPersistentPool,
        printProgress,
        (stage) => {
          const screening = stage.name === "screening";
          writeResultsCsv(
            join(outDir, screening ? "screening" : "finals"),
            stage.attackPool,
            stage.defensePool,
            screening ? args.screenTopM : args.topN
          );
          panels.push({
            name: stage.name,
            games: stage.games,
            attackPanel: stage.attackPanel,
            defensePanel: stage.defensePanel
          });
          mkdirSync(outDir, { recursive: true });
          writeFileSync(join(outDir, "benchmark_panels.json"), `${JSON.stringify(panels)}\n`);
          if (!screening) {
            writeFileSync(join(outDir, "finals_off_summary.md"), summarizeTeamHeuristics(stage.attackPool.finalScoresOrdered, "offense"));
            writeFileSync(join(outDir, "finals_def_summary.md"), summarizeTeamHeuristics(stage.defensePool.finalScoresOrdered, "defense"));
          }
          console.log(
            `${stage.name} complete: ${stage.games} actual games; ` +
            `${stage.attackPool.finalScoresOrdered.length} ranked attackers, ` +
            `${stage.defensePool.finalScoresOrdered.length} ranked defenders; ` +
            `${stage.attackPanel.length} attack / ${stage.defensePanel.length} defense benchmark seats`
          );
        }
      );
      console.log(`Benchmark results saved to ${outDir} (final CSVs limited to --top-n=${args.topN})`);
      console.log(`Lineup recipes and observed strength ranges: ${join(outDir, "finals_off_summary.md")} and ${join(outDir, "finals_def_summary.md")}`);
    } else {
      console.log("Benchmark stages disabled (--finals-top-m=0)");
    }
  } finally {
    await taskRunner?.close();
  }
}

function printBenchmarkPlan(attackSource: number, defenseSource: number, args: CliOptions): void {
  const screenAttack = Math.min(attackSource, args.screenTopM);
  const screenDefense = Math.min(defenseSource, args.screenTopM);
  const finalAttack = Math.min(screenAttack, args.finalsTopM);
  const finalDefense = Math.min(screenDefense, args.finalsTopM);
  const screenAttackPanel = Math.min(attackSource, args.benchmarkTopM, args.benchmarkSize);
  const screenDefensePanel = Math.min(defenseSource, args.benchmarkTopM, args.benchmarkSize);
  const finalAttackPanel = Math.min(screenAttack, args.benchmarkTopM, args.benchmarkSize);
  const finalDefensePanel = Math.min(screenDefense, args.benchmarkTopM, args.benchmarkSize);
  console.log(`Benchmark source availability: ${attackSource} attackers / ${defenseSource} defenders; requested sizes clamp to available rows`);
  console.log(`  - Panel source limit ${args.benchmarkTopM}, seat limit ${args.benchmarkSize}; no shell cap`);
  const describe = (
    name: string,
    requested: number,
    attackers: number,
    defenders: number,
    attackPanel: number,
    defensePanel: number,
    reps: number
  ) => {
    const matches = attackers * defensePanel + defenders * attackPanel;
    console.log(
      `  - ${name}: requested ${requested} per role, actual ${attackers} attackers / ${defenders} defenders; ` +
      `${attackPanel} attack / ${defensePanel} defense panel seats; ` +
      `${matches} matchups × ${reps} reps = ${matches * reps} games`
    );
  };
  describe("screening", args.screenTopM, screenAttack, screenDefense, screenAttackPanel, screenDefensePanel, args.screenReps);
  describe("reranking", args.finalsTopM, finalAttack, finalDefense, finalAttackPanel, finalDefensePanel, args.finalsReps);
  if (args.refinementTopM > 0 && args.refinementReps > 0) {
    describe(
      "refinement (additional)",
      args.refinementTopM,
      Math.min(finalAttack, args.refinementTopM),
      Math.min(finalDefense, args.refinementTopM),
      finalAttackPanel,
      finalDefensePanel,
      args.refinementReps
    );
  } else {
    console.log("  - refinement disabled (zero candidates or repetitions)");
  }
}

function freshOutputDirectory(label: string): string {
  const stamp = timestamp();
  let directory = join("tournament_results", `ds_${label}_${stamp}`);
  for (let run = 2; existsSync(directory); run += 1) {
    directory = join("tournament_results", `ds_${label}_run${run}_${stamp}`);
  }
  mkdirSync(directory, { recursive: true });
  return directory;
}

function nextValue(argv: string[], index: number, flag: string, inlineValue?: string): string {
  if (inlineValue !== undefined) {
    if (inlineValue.length === 0) throw new Error(`${flag} requires a value`);
    return inlineValue;
  }
  const value = argv[index];
  if (value === undefined || (value.startsWith("--") && VALUE_FLAGS.has(value))) throw new Error(`${flag} requires a value`);
  return value;
}

function parseInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${flag} must be an integer`);
  return parsed;
}

function parseNumber(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${flag} must be numeric`);
  return parsed;
}

function validateOptions(options: CliOptions): void {
  for (const ratio of options.ratios) parseRatio(ratio, options.total);
  for (const [flag, value] of [
    ["--screen-top-m", options.screenTopM],
    ["--screen-reps", options.screenReps],
    ["--benchmark-top-m", options.benchmarkTopM],
    ["--benchmark-size", options.benchmarkSize],
    ["--finals-reps", options.finalsReps]
  ] as const) {
    if (value < 1) throw new Error(`${flag} must be >= 1`);
  }
  if (options.refinementTopM < 0) throw new Error("--refinement-top-m must be >= 0");
  if (options.refinementReps < 0) throw new Error("--refinement-reps must be >= 0");
  if (options.finalsTopM > 0) {
    if (options.finalsTopM > options.screenTopM) throw new Error("--finals-top-m must be <= --screen-top-m");
    if (options.refinementTopM > options.finalsTopM) throw new Error("--refinement-top-m must be <= --finals-top-m");
  }
  if (options.finalsOnly) {
    for (const name of ["swiss_off.csv", "swiss_def.csv"]) {
      const file = join(options.finalsOnly, name);
      if (!existsSync(file)) throw new Error(`Missing qualifier CSV: ${file}`);
    }
  }
  if (options.jobs < 1) throw new Error("--jobs must be at least 1");
  if (options.batchSize < 1) throw new Error("--batch-size must be >= 1");
  if (options.freezeRate < 0 || options.freezeRate > 1) throw new Error("--freeze-rate must be between 0 and 1");
  if (options.freezeLossesGte !== undefined && options.freezeLossesGte < 0) throw new Error("--freeze-losses-gte must be >= 0");
  if (options.seedRounds < 0) throw new Error("--seed-rounds must be >= 0");
  if (options.rounds < 0) throw new Error("--rounds must be >= 0");
  if (options.reps < 1) throw new Error("--reps must be >= 1");
  if (options.topN < 0) throw new Error("--top-n must be >= 0");
  if (options.finalsTopM < 0) throw new Error("--finals-top-m must be >= 0");
}

function timestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function createProgressReporter(): (label: string, completed: number, total: number, battlesCompleted: number) => void {
  let phase = "";
  let lastPrintedAt = 0;
  let lastPrintedBattles = 0;
  let lastPrintedMatches = -1;
  return (label, completed, total, battlesCompleted) => {
    const now = performance.now();
    if (label !== phase) {
      phase = label;
      lastPrintedAt = now;
      lastPrintedBattles = 0;
      lastPrintedMatches = -1;
    }
    if (completed === lastPrintedMatches) return;
    const elapsed = (now - lastPrintedAt) / 1000;
    if (completed > 0 && completed < total && elapsed < 1) return;
    const rate = elapsed > 0 ? (battlesCompleted - lastPrintedBattles) / elapsed : 0;
    const pct = total > 0 ? (completed * 100) / total : 100;
    process.stdout.write(
      `\r  ${label}: ${pct.toFixed(1)}% (${completed}/${total} matches)` +
      ` | ${Math.round(rate).toLocaleString()} battles/s`
    );
    if (completed >= total) process.stdout.write("\n");
    lastPrintedAt = now;
    lastPrintedBattles = battlesCompleted;
    lastPrintedMatches = completed;
  };
}

function helpText(): string {
  return `Dual-ranking asymmetric Swiss tournament with proportional benchmark finals.

Benchmark stages (no hard shell cap):
  --screen-top-m N       Screen top N Swiss candidates per role (default 10000)
  --screen-reps N        Games per candidate/opponent in screening (default 2)
  --benchmark-top-m N    Panel source: top N of preceding ranking (default 1000)
  --benchmark-size N     Proportional panel seats per role (default 100)
  --finals-top-m N       Keep top N screened candidates, independent of CSV limit
                        (default 1000; 0 disables all benchmark stages)
  --finals-reps N        Reranking games per candidate/opponent (default 15,
                        independent of --reps)
  --refinement-top-m N   Refine top N reranked candidates (default 100; 0 skips)
  --refinement-reps N    Additional games per opponent (default 25; 0 skips)
  --finals-only DIR      Replay Swiss CSVs from DIR into a fresh output directory,
                        copying source CSVs; available rows clamp stage sizes
  --top-n N             Final CSV row limit (default 500), not candidate retention

Panels allocate seats by ordered main trio + formation, proportional to source
occurrences; best ranked variants fill each group. Screening uses Swiss panels;
reranking rebuilds panels from screening; refinement keeps the reranking panels.
Refinement pools include all finalists and accumulate reranking + extra games.
Screening CSVs retain all screened candidates. benchmark_panels.json records
exact panels and actual games per stage. Swiss CSVs retain at least
max(--top-n, --screen-top-m, --benchmark-top-m) rows when finals are enabled.
Stage sizes and repetitions must be positive, except the zero-disable flags.
Finalists cannot exceed screening size; refinement cannot exceed finalists.

Swiss and execution:
  --ratios A,B,C [...]   Troop ratios (default 50,20,30)
  --total N             Troops per team (default 1500000)
  --rounds N            Swiss rounds (default 30)
  --seed-rounds N       Random opening rounds (default 2)
  --reps N              Swiss games per matchup (default 1)
  --time-limit MIN      Optional Swiss time limit
  --freeze-rate N       Fraction frozen per round (default 0.2)
  --freeze-losses-gte N  Optional loss threshold
  --start-freeze-round N First freeze round (default 8)
  --min-pool-size N     Minimum active pool (default 200)
  --repeat-joiners      Allow repeated joiners
  --jobs N              Parallel workers (default half available CPUs)
  --batch-size N        Worker batch size (default 64; --batch_size also accepted)
  --seed N              Reproducible random seed (default 1234)
  --player-stats NAME   Player stats profile (default max)
  --help, -h            Show this help`;
}

const entryPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
