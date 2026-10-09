import { runBattleTasks } from "./battleRunner";
import { Pool } from "./pools";
import { seededShuffle } from "./rng";
import type { BattleSummary, BattleTask, TournamentOptions } from "./types";
import type { PlayerStats } from "./playerStats";

export type BattleTaskRunner = (tasks: BattleTask[], jobs: number, onProgress?: (completed: number, total: number) => void, batchSize?: number) => Promise<BattleSummary[]>;

export function createRandomRoundTasks(
  attackerPool: Pool,
  defenderPool: Pool,
  roundNum: number,
  reps: number,
  seed: number,
  playerStats?: PlayerStats
): BattleTask[] {
  const attackers = seededShuffle(attackerPool.teamsActiveOrdered, seed + roundNum);
  const defenders = seededShuffle(defenderPool.teamsActiveOrdered, seed + roundNum + 100000);
  if (attackers.length !== defenders.length) throw new Error(`Pool size mismatch: ${attackers.length} attackers vs ${defenders.length} defenders`);
  return attackers.map((attacker, index) => ({
    attacker,
    defender: defenders[index],
    seed: seed + roundNum + index * 1000,
    reps,
    playerStats
  }));
}

export function createDualRankingTasks(
  attackerPool: Pool,
  defenderPool: Pool,
  roundNum: number,
  reps: number,
  seed: number,
  playerStats?: PlayerStats
): BattleTask[] {
  const attackers = attackerPool.teamsActiveOrdered;
  const defenders = defenderPool.teamsActiveOrdered;
  if (attackers.length !== defenders.length) throw new Error(`Pool size mismatch: ${attackers.length} attackers vs ${defenders.length} defenders`);
  return attackers.map((attacker, index) => ({
    attacker,
    defender: defenders[index],
    seed: seed + roundNum * 10000 + index * 1000,
    reps,
    playerStats
  }));
}

export function aggregateBattleResults(attackerPool: Pool, defenderPool: Pool, results: BattleSummary[]): void {
  for (const result of results) {
    const margin = result.avgAttackerLeft - result.avgDefenderLeft;
    const attackScore = attackerPool.getScore(result.attackerId);
    const defenseScore = defenderPool.getScore(result.defenderId);
    const attackerWinRate = result.attackerWins / result.games;
    const defenderWinRate = result.defenderWins / result.games;
    attackScore.matches += 1;
    attackScore.games += result.games;
    attackScore.margin += margin;
    attackScore.winRateSum += attackerWinRate;
    defenseScore.matches += 1;
    defenseScore.games += result.games;
    defenseScore.margin += -margin;
    defenseScore.winRateSum += defenderWinRate;
  }
}

export async function runDualSwissTournament(
  attackerPool: Pool,
  defenderPool: Pool,
  options: TournamentOptions,
  runner: BattleTaskRunner = runBattleTasks,
  onProgress?: (label: string, completed: number, total: number, battlesCompleted: number) => void
): Promise<[Pool, Pool]> {
  const startedAt = Date.now();
  let round = 1;
  const freezeEnabled = options.freezeRate > 0 || options.freezeLossesGte !== undefined;
  while (true) {
    const elapsedMins = (Date.now() - startedAt) / 60000;
    const activeAttackers = attackerPool.scoresActive.length;
    const activeDefenders = defenderPool.scoresActive.length;
    if (options.timeLimitMins !== undefined && elapsedMins > options.timeLimitMins) break;
    if (round > options.totalRounds) break;
    if (freezeEnabled && activeAttackers < options.minPoolSize && activeDefenders < options.minPoolSize) break;
    if (activeAttackers === 0 || activeDefenders === 0) break;
    const isSeedRound = round <= options.seedRounds;
    const tasks = isSeedRound
      ? createRandomRoundTasks(attackerPool, defenderPool, round, options.reps, options.seed, options.playerStats)
      : createDualRankingTasks(attackerPool, defenderPool, round, options.reps, options.seed, options.playerStats);
    const label = `Round ${round} (${isSeedRound ? "random" : "Swiss"})`;
    onProgress?.(label, 0, tasks.length, 0);
    const results = await runner(tasks, options.jobs, (completed, total) => onProgress?.(label, completed, total, completed * options.reps), options.batchSize);
    aggregateBattleResults(attackerPool, defenderPool, results);
    if (freezeEnabled && round >= options.startFreezeRound) {
      freezePools(attackerPool, defenderPool, options);
    }
    round += 1;
  }
  attackerPool.finalizeRemaining();
  defenderPool.finalizeRemaining();
  return [attackerPool, defenderPool];
}

function freezePools(attackerPool: Pool, defenderPool: Pool, options: TournamentOptions): void {
  if (options.freezeLossesGte !== undefined) {
    const count = Math.max(
      attackerPool.countActiveLossesAtLeast(options.freezeLossesGte),
      defenderPool.countActiveLossesAtLeast(options.freezeLossesGte)
    );
    attackerPool.freezeLossesAtLeast(options.freezeLossesGte, count);
    defenderPool.freezeLossesAtLeast(options.freezeLossesGte, count);
    return;
  }

  attackerPool.freezeBottomTeams(options.freezeRate);
  defenderPool.freezeBottomTeams(options.freezeRate);
}
