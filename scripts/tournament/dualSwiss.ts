import { runBattleTasks } from "./battleRunner";
import { Pool } from "./pools";
import { seededShuffle } from "./rng";
import type { BattleSummary, BattleTask, Team, TournamentOptions } from "./types";
import type { PlayerStats } from "./playerStats";

export type BattleTaskRunner = (tasks: BattleTask[], jobs: number, onProgress?: (completed: number, total: number) => void) => Promise<BattleSummary[]>;

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
    attackScore.matches += 1;
    attackScore.margin += margin;
    if (result.avgAttackerLeft > 0 && result.avgDefenderLeft === 0) attackScore.wins += 1;
    defenseScore.matches += 1;
    defenseScore.margin += -margin;
    if (result.avgDefenderLeft > 0 && result.avgAttackerLeft === 0) defenseScore.wins += 1;
  }
}

export async function runDualSwissTournament(
  attackerPool: Pool,
  defenderPool: Pool,
  options: TournamentOptions,
  runner: BattleTaskRunner = runBattleTasks,
  onProgress?: (label: string, completed: number, total: number) => void
): Promise<[Pool, Pool]> {
  const startedAt = Date.now();
  let round = 1;
  const freezeEnabled = options.freezeRate > 0 || options.freezeLossesGte !== undefined;
  while (true) {
    const elapsedMins = (Date.now() - startedAt) / 60000;
    const activeAttackers = attackerPool.teamsActiveOrdered;
    const activeDefenders = defenderPool.teamsActiveOrdered;
    if (options.timeLimitMins !== undefined && elapsedMins > options.timeLimitMins) break;
    if (round > options.totalRounds) break;
    if (freezeEnabled && activeAttackers.length < options.minPoolSize && activeDefenders.length < options.minPoolSize) break;
    if (activeAttackers.length === 0 || activeDefenders.length === 0) break;
    const isSeedRound = round <= options.seedRounds;
    const tasks = isSeedRound
      ? createRandomRoundTasks(attackerPool, defenderPool, round, options.reps, options.seed, options.playerStats)
      : createDualRankingTasks(attackerPool, defenderPool, round, options.reps, options.seed, options.playerStats);
    const label = `Round ${round} (${isSeedRound ? "random" : "Swiss"})`;
    const results = await runner(tasks, options.jobs, (completed, total) => onProgress?.(label, completed, total));
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

export async function runFinalsRoundRobin(
  attackerTeams: Team[],
  defenderTeams: Team[],
  reps: number,
  jobs: number,
  seed: number,
  runner: BattleTaskRunner = runBattleTasks,
  onProgress?: (label: string, completed: number, total: number) => void,
  playerStats?: PlayerStats
): Promise<[Pool, Pool]> {
  const attackerPool = new Pool(attackerTeams);
  const defenderPool = new Pool(defenderTeams);
  const tasks: BattleTask[] = [];
  for (const attacker of attackerTeams) {
    for (const defender of defenderTeams) {
      tasks.push({ attacker, defender, seed: seed + 999000 + tasks.length * 1000, reps, playerStats });
    }
  }
  const results = await runner(tasks, jobs, (completed, total) => onProgress?.("Finals round-robin", completed, total));
  aggregateBattleResults(attackerPool, defenderPool, results);
  attackerPool.finalizeRemaining();
  defenderPool.finalizeRemaining();
  return [attackerPool, defenderPool];
}
