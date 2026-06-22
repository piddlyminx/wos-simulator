#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createBattleTaskRunner } from "./tournament/battleRunner";
import { runDualSwissTournament, runFinalsRoundRobin, type BattleTaskRunner } from "./tournament/dualSwiss";
import { Pool } from "./tournament/pools";
import { loadPlayerStatsProfile } from "./tournament/playerStats";
import { copyQualifierCsvs, deriveResultsLabel, loadAllRankedTeamsFromCsv, writeResultsCsv } from "./tournament/results";
import { generateTeams, parseRatio, selectFinalsTeamsByMainLineup } from "./tournament/teamGeneration";
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
  seed: number;
  freezeRate: number;
  freezeLossesGte?: number;
  startFreezeRound: number;
  minPoolSize: number;
  finalsTopM: number;
  finalsReps?: number;
  finalsOnly?: string;
  finalsMaxSameHeroes: number;
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
  "--seed",
  "--freeze-rate",
  "--freeze-losses-gte",
  "--start-freeze-round",
  "--min-pool-size",
  "--finals-top-m",
  "--finals-reps",
  "--finals-only",
  "--finals-max-same-heroes",
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
    seed: 1234,
    freezeRate: 0.2,
    startFreezeRound: 8,
    minPoolSize: 200,
    finalsTopM: 200,
    finalsMaxSameHeroes: 10,
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
      case "--finals-top-m":
        options.finalsTopM = parseInteger(readValue(), arg);
        break;
      case "--finals-reps":
        options.finalsReps = parseInteger(readValue(), arg);
        break;
      case "--finals-only":
        options.finalsOnly = readValue();
        break;
      case "--finals-max-same-heroes":
        options.finalsMaxSameHeroes = parseInteger(readValue(), arg);
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
  const finalsReps = args.finalsReps ?? args.reps;
  const playerStats = loadPlayerStatsProfile(args.playerStats);
  let topAttackers: Team[] | undefined;
  let topDefenders: Team[] | undefined;
  let outDir: string;
  let taskRunner: ReturnType<typeof createBattleTaskRunner> | undefined;
  const runTasksWithPersistentPool: BattleTaskRunner = async (tasks, _jobs, onProgress) => {
    taskRunner ??= createBattleTaskRunner(args.jobs);
    return await taskRunner.run(tasks, onProgress);
  };

  try {
    if (args.finalsOnly) {
      const offenseCsv = join(args.finalsOnly, "swiss_off.csv");
      const defenseCsv = join(args.finalsOnly, "swiss_def.csv");
      const attackCandidates = loadAllRankedTeamsFromCsv(offenseCsv, args.total);
      const defenseCandidates = loadAllRankedTeamsFromCsv(defenseCsv, args.total);
      if (attackCandidates.length < args.finalsTopM || defenseCandidates.length < args.finalsTopM) {
        throw new Error(
          `--finals-top-m=${args.finalsTopM} requested, but ${args.finalsOnly} has only ${attackCandidates.length} offense and ${defenseCandidates.length} defense candidates`
        );
      }
      topAttackers = selectFinalsTeamsByMainLineup(attackCandidates, args.finalsTopM, args.finalsMaxSameHeroes);
      topDefenders = selectFinalsTeamsByMainLineup(defenseCandidates, args.finalsTopM, args.finalsMaxSameHeroes);
      outDir = join("tournament_results", `ds_${deriveResultsLabel(args.finalsOnly)}_${timestamp()}`);
      copyQualifierCsvs(args.finalsOnly, outDir);
      console.log(`Loaded finals qualifiers from ${args.finalsOnly}`);
      console.log(`  - Top ${topAttackers.length} attackers from ${offenseCsv}`);
      console.log(`  - Top ${topDefenders.length} defenders from ${defenseCsv}`);
      console.log(`  - Writing fresh finals run to ${outDir}`);
    } else {
      const ratioList = args.ratios.map((ratio) => [ratio.replace(/,/g, "-"), parseRatio(ratio, args.total)] as [string, Team["troops"]]);
      const teams = generateTeams(ratioList, args.repeatJoiners);
      const label = ratioList.length === 1 ? ratioList[0][0] : "mixed";
      outDir = join("tournament_results", `ds_${deriveResultsLabel(label)}_${timestamp()}`);
      console.log(`Generated ${teams.length} teams across ${ratioList.length} ratio(s)`);
      console.log(`Running dual-ranking Swiss tournament: ${args.rounds} rounds (${args.seedRounds} random + ${Math.max(0, args.rounds - args.seedRounds)} Swiss)`);
      console.log(`  - Reps per battle: ${args.reps}`);
      console.log(`  - Parallel workers: ${args.jobs}`);
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
      writeResultsCsv(join(outDir, "swiss"), attackPool, defensePool, args.topN);
      console.log(`Results saved to ${outDir}`);

      if (args.finalsTopM > 0) {
        topAttackers = selectFinalsTeamsByMainLineup(
          attackPool.finalScoresOrdered.map((score) => score.team),
          args.finalsTopM,
          args.finalsMaxSameHeroes
        );
        topDefenders = selectFinalsTeamsByMainLineup(
          defensePool.finalScoresOrdered.map((score) => score.team),
          args.finalsTopM,
          args.finalsMaxSameHeroes
        );
      }
    }

    if (topAttackers && topDefenders) {
      console.log(`Running finals round-robin: ${topAttackers.length} attackers vs ${topDefenders.length} defenders`);
      const [finalAttackPool, finalDefensePool] = await runFinalsRoundRobin(
        topAttackers,
        topDefenders,
        finalsReps,
        args.jobs,
        args.seed,
        runTasksWithPersistentPool,
        printProgress,
        playerStats
      );
      writeResultsCsv(join(outDir, "finals"), finalAttackPool, finalDefensePool, args.finalsTopM, topAttackers, topDefenders);
      console.log(`Finals results saved to ${outDir}`);
    }
  } finally {
    await taskRunner?.close();
  }
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
  if (options.finalsMaxSameHeroes < 0) throw new Error("--finals-max-same-heroes must be >= 0");
  if (options.finalsOnly && options.finalsTopM <= 0) throw new Error("--finals-only requires --finals-top-m > 0");
  if (options.finalsOnly) {
    for (const name of ["swiss_off.csv", "swiss_def.csv"]) {
      const file = join(options.finalsOnly, name);
      if (!existsSync(file)) throw new Error(`Missing qualifier CSV: ${file}`);
    }
  }
  if (options.jobs < 1) throw new Error("--jobs must be at least 1");
  if (options.freezeRate < 0 || options.freezeRate > 1) throw new Error("--freeze-rate must be between 0 and 1");
  if (options.freezeLossesGte !== undefined && options.freezeLossesGte < 0) throw new Error("--freeze-losses-gte must be >= 0");
  if (options.seedRounds < 0) throw new Error("--seed-rounds must be >= 0");
  if (options.rounds < 0) throw new Error("--rounds must be >= 0");
  if (options.reps < 1) throw new Error("--reps must be >= 1");
  if (options.finalsReps !== undefined && options.finalsReps < 1) throw new Error("--finals-reps must be >= 1");
  if (options.topN < 0) throw new Error("--top-n must be >= 0");
  if (options.finalsTopM < 0) throw new Error("--finals-top-m must be >= 0");
}

function timestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function printProgress(label: string, completed: number, total: number): void {
  const pct = total > 0 ? (completed * 100) / total : 100;
  process.stdout.write(`\r  ${label}: ${pct.toFixed(1)}% (${completed}/${total})`);
  if (completed >= total) process.stdout.write("\n");
}

function helpText(): string {
  return "Dual-ranking asymmetric Swiss tournament.";
}

const entryPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
