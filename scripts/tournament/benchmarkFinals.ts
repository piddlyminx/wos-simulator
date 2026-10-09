import { runBattleTasks } from "./battleRunner";
import type { BattleTaskRunner } from "./dualSwiss";
import type { PlayerStats } from "./playerStats";
import { avgMargin, Pool, winRate } from "./pools";
import { uniqueRankedTeams } from "./teamGeneration";
import type { BattleSummary, BattleTask, Team } from "./types";

export interface BenchmarkFinalsOptions {
  screenTopM: number;
  screenReps: number;
  benchmarkTopM: number;
  benchmarkSize: number;
  finalsTopM: number;
  finalsReps: number;
  refinementTopM: number;
  refinementReps: number;
  jobs: number;
  batchSize: number;
  seed: number;
  playerStats?: PlayerStats;
}

export interface BenchmarkStage {
  name: "screening" | "reranking" | "refinement";
  attackPool: Pool;
  defensePool: Pool;
  attackPanel: Team[];
  defensePanel: Team[];
  games: number;
}

function requireInteger(name: string, value: number, minimum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be a safe integer at least ${minimum}`);
  }
}

/** Select ranked variants, with representation proportional to formation frequency. */
export function selectProportionalPanel(rankedTeams: Team[], sourceTopM: number, panelSize: number): Team[] {
  requireInteger("sourceTopM", sourceTopM, 1);
  requireInteger("panelSize", panelSize, 1);
  const source = uniqueRankedTeams(rankedTeams).slice(0, sourceTopM);
  if (source.length === 0) throw new Error("Cannot select a benchmark panel from an empty category");
  const seats = Math.min(panelSize, source.length);
  const groups = new Map<string, { count: number; firstRank: number; seats: number; remainder: number }>();
  for (let rank = 0; rank < source.length; rank += 1) {
    const team = source[rank];
    const key = JSON.stringify([...team.mains, team.ratioLabel]);
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { count: 1, firstRank: rank, seats: 0, remainder: 0 });
  }
  let allocated = 0;
  for (const group of groups.values()) {
    const numerator = seats * group.count;
    group.seats = Math.floor(numerator / source.length);
    group.remainder = numerator % source.length;
    allocated += group.seats;
  }
  const byRemainder = [...groups.values()].sort((a, b) => b.remainder - a.remainder || a.firstRank - b.firstRank);
  for (let index = 0; index < seats - allocated; index += 1) byRemainder[index].seats += 1;
  return source.filter((team) => {
    const group = groups.get(JSON.stringify([...team.mains, team.ratioLabel]))!;
    if (group.seats === 0) return false;
    group.seats -= 1;
    return true;
  });
}

// Every pass gives a candidate the same reps against every fixed panel member.
// Pooling wins, games, and game-weighted margins therefore preserves equal
// opponent weights, including when refinement adds an unequal-size batch.
interface CandidateTotals {
  games: number;
  wins: number;
  margin: number;
}

interface Evaluation {
  teams: Team[];
  panel: Team[];
  totals: Map<number, CandidateTotals>;
  opponentIds: Set<number>;
  sourceRank: Map<number, number>;
}

function createEvaluation(teams: Team[], panel: Team[], sourceRank: Map<number, number>): Evaluation {
  return {
    teams,
    panel,
    sourceRank,
    opponentIds: new Set(panel.map((team) => team.id)),
    totals: new Map(teams.map((team) => [team.id, { games: 0, wins: 0, margin: 0 }]))
  };
}

function accumulate(evaluation: Evaluation, attack: boolean, result: BattleSummary): void {
  const candidateId = attack ? result.attackerId : result.defenderId;
  const opponentId = attack ? result.defenderId : result.attackerId;
  const totals = evaluation.totals.get(candidateId);
  if (!totals || !evaluation.opponentIds.has(opponentId)) throw new Error("Battle result does not belong to its benchmark evaluation");
  if (!Number.isSafeInteger(result.games) || result.games < 1) throw new Error("Benchmark battle results must contain games");
  totals.games += result.games;
  totals.wins += attack ? result.attackerWins : result.defenderWins;
  const margin = result.avgAttackerLeft - result.avgDefenderLeft;
  totals.margin += (attack ? margin : -margin) * result.games;
}

function scoredPool(evaluation: Evaluation): Pool {
  const pool = new Pool(evaluation.teams);
  for (const team of evaluation.teams) {
    const score = pool.getScore(team.id);
    const totals = evaluation.totals.get(team.id)!;
    if (totals.games === 0) throw new Error("Benchmark candidate is missing its evaluation");
    // Retain Pool's match-based presentation: one pooled match per opponent.
    score.matches = evaluation.panel.length;
    score.games = totals.games;
    score.winRateSum = totals.wins / totals.games * score.matches;
    score.margin = totals.margin / totals.games * score.matches;
  }
  pool.scoresFinal = pool.scoresActive;
  pool.scoresActive = [];
  // IDs can be remapped when Swiss CSVs are reloaded. Exact score ties retain
  // the original role source rank, so replay chooses the same lineups/panels.
  pool.scoresFinal.sort((left, right) =>
    winRate(right) - winRate(left) || avgMargin(right) - avgMargin(left) ||
    evaluation.sourceRank.get(left.team.id)! - evaluation.sourceRank.get(right.team.id)!
  );
  return pool;
}

export async function runBenchmarkFinals(
  attackers: Team[],
  defenders: Team[],
  options: BenchmarkFinalsOptions,
  runner: BattleTaskRunner = runBattleTasks,
  onProgress?: (label: string, completed: number, total: number, battlesCompleted: number) => void,
  onStage?: (stage: BenchmarkStage) => void
): Promise<[Pool, Pool]> {
  for (const name of ["screenTopM", "screenReps", "benchmarkTopM", "benchmarkSize", "finalsTopM", "finalsReps", "jobs", "batchSize"] as const) {
    requireInteger(name, options[name], 1);
  }
  requireInteger("refinementTopM", options.refinementTopM, 0);
  requireInteger("refinementReps", options.refinementReps, 0);
  if (!Number.isSafeInteger(options.seed)) throw new Error("seed must be a safe integer");
  for (const [name, teams] of [["attackers", attackers], ["defenders", defenders]] as const) {
    if (teams.length === 0) throw new Error(`${name} category must not be empty`);
    if (new Set(teams.map((team) => team.id)).size !== teams.length) throw new Error(`${name} category contains duplicate team ids`);
  }
  attackers = uniqueRankedTeams(attackers);
  defenders = uniqueRankedTeams(defenders);
  const attackSourceRank = new Map(attackers.map((team, index) => [team.id, index]));
  const defenseSourceRank = new Map(defenders.map((team, index) => [team.id, index]));
  const chunkSize = options.jobs * options.batchSize;
  requireInteger("jobs * batchSize", chunkSize, 1);
  let nextSeed = options.seed;

  async function evaluateStage(
    name: BenchmarkStage["name"],
    attack: Evaluation,
    defense: Evaluation,
    attackCandidates: Team[],
    defenseCandidates: Team[],
    reps: number
  ): Promise<BenchmarkStage> {
    const total = attackCandidates.length * attack.panel.length + defenseCandidates.length * defense.panel.length;
    requireInteger("stage match count", total, 1);
    if (!Number.isSafeInteger(nextSeed + total - 1)) throw new Error("Benchmark task seeds exceed the safe integer range");
    const label = `Benchmark ${name}`;
    let completed = 0;
    let games = 0;
    onProgress?.(label, 0, total, 0);

    // Separate role evaluations even at panel intersections: each result belongs
    // only to its candidate side, never to the incidental benchmark opponent.
    for (const [evaluation, candidates, isAttack] of [
      [attack, attackCandidates, true],
      [defense, defenseCandidates, false]
    ] as const) {
      const matchCount = candidates.length * evaluation.panel.length;
      for (let start = 0; start < matchCount; start += chunkSize) {
        const end = Math.min(start + chunkSize, matchCount);
        const tasks: BattleTask[] = [];
        for (let index = start; index < end; index += 1) {
          const candidate = candidates[Math.floor(index / evaluation.panel.length)];
          const opponent = evaluation.panel[index % evaluation.panel.length];
          tasks.push({
            attacker: isAttack ? candidate : opponent,
            defender: isAttack ? opponent : candidate,
            seed: nextSeed++,
            reps,
            playerStats: options.playerStats
          });
        }
        const offset = completed;
        const results = await runner(tasks, options.jobs, (count) => onProgress?.(label, offset + count, total, (offset + count) * reps), options.batchSize);
        if (results.length !== tasks.length) throw new Error("Benchmark runner returned an incomplete task batch");
        for (const result of results) {
          accumulate(evaluation, isAttack, result);
          games += result.games;
        }
        completed += tasks.length;
        onProgress?.(label, completed, total, games);
      }
    }
    const stage: BenchmarkStage = {
      name,
      attackPool: scoredPool(attack),
      defensePool: scoredPool(defense),
      attackPanel: defense.panel,
      defensePanel: attack.panel,
      games
    };
    onStage?.(stage);
    return stage;
  }

  const screenAttackPanel = selectProportionalPanel(attackers, options.benchmarkTopM, options.benchmarkSize);
  const screenDefensePanel = selectProportionalPanel(defenders, options.benchmarkTopM, options.benchmarkSize);
  const screenAttackCandidates = attackers.slice(0, options.screenTopM);
  const screenDefenseCandidates = defenders.slice(0, options.screenTopM);
  const screen = await evaluateStage(
    "screening",
    createEvaluation(screenAttackCandidates, screenDefensePanel, attackSourceRank),
    createEvaluation(screenDefenseCandidates, screenAttackPanel, defenseSourceRank),
    screenAttackCandidates,
    screenDefenseCandidates,
    options.screenReps
  );
  const screenedAttackers = screen.attackPool.teamsFinalOrdered;
  const screenedDefenders = screen.defensePool.teamsFinalOrdered;
  const finalsAttackPanel = selectProportionalPanel(screenedAttackers, options.benchmarkTopM, options.benchmarkSize);
  const finalsDefensePanel = selectProportionalPanel(screenedDefenders, options.benchmarkTopM, options.benchmarkSize);
  const attackCandidates = screenedAttackers.slice(0, options.finalsTopM);
  const defenseCandidates = screenedDefenders.slice(0, options.finalsTopM);
  const attackEvaluation = createEvaluation(attackCandidates, finalsDefensePanel, attackSourceRank);
  const defenseEvaluation = createEvaluation(defenseCandidates, finalsAttackPanel, defenseSourceRank);
  let finals = await evaluateStage("reranking", attackEvaluation, defenseEvaluation, attackCandidates, defenseCandidates, options.finalsReps);
  if (options.refinementTopM > 0 && options.refinementReps > 0) {
    finals = await evaluateStage(
      "refinement",
      attackEvaluation,
      defenseEvaluation,
      finals.attackPool.teamsFinalOrdered.slice(0, options.refinementTopM),
      finals.defensePool.teamsFinalOrdered.slice(0, options.refinementTopM),
      options.refinementReps
    );
  }
  return [finals.attackPool, finals.defensePool];
}
