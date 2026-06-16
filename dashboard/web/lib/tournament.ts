import { loadSimulatorConfig } from "@simulator/config";
import { simulateBattle, signedRemainingScore } from "@simulator/simulator";
import type { BattleInput, FighterInput, SimulatorConfig, SkillFile } from "@simulator/types";

export type MainHeroRole = "inf" | "lanc" | "mark";
export type TournamentSortKey =
  | "rank"
  | "wins"
  | "winRate"
  | "avgMargin"
  | "matches"
  | "ratio"
  | "mains"
  | "joiners";

export interface Team {
  mains: [string, string, string];
  joiners: [string, string, string, string];
  id: number;
  ratioLabel: string;
  groupLabel: string;
  troops: {
    infantry_t10: number;
    lancer_t10: number;
    marksman_t10: number;
  };
}

export interface Score {
  team: Team;
  wins: number;
  matches: number;
  margin: number;
}

export interface BattleSummary {
  attackerId: number;
  defenderId: number;
  avgAttackerLeft: number;
  avgDefenderLeft: number;
}

export interface BattleTask {
  attacker: Team;
  defender: Team;
  seed: number;
  reps: number;
}

export interface TournamentTeamGroupPayload {
  label: string;
  infantryMains: string[];
  lancerMains: string[];
  marksmanMains: string[];
  joiners: string[];
  ratios: string[];
  allowRepeatedJoiners: boolean;
  excludeMainHeroesFromJoiners: boolean;
}

export interface TournamentRequestPayload {
  groups: TournamentTeamGroupPayload[];
  totalTroops: number;
  rounds: number;
  seedRounds: number;
  reps: number;
  jobs: number;
  seed: number;
  freezeRate: number;
  freezeLossesGte?: number | null;
  startFreezeRound: number;
  minPoolSize: number;
  topN: number;
  finalsTopM: number;
  finalsReps: number;
  finalsMaxSameMainLineup: number;
}

export interface TournamentResultRow {
  rank: number;
  teamId: number;
  groupLabel: string;
  ratioLabel: string;
  mains: [string, string, string];
  joiners: [string, string, string, string];
  troops: Team["troops"];
  wins: number;
  matches: number;
  losses: number;
  winRate: number;
  margin: number;
  avgMargin: number;
}

export interface TournamentResultSet {
  rows: TournamentResultRow[];
  totalRows: number;
}

export interface TournamentResult {
  generatedTeams: number;
  swiss: {
    offense: TournamentResultSet;
    defense: TournamentResultSet;
  };
  finals?: {
    offense: TournamentResultSet;
    defense: TournamentResultSet;
    attackerCount: number;
    defenderCount: number;
    battles: number;
  };
}

export interface TournamentRunOptions {
  seedBase?: string;
  onProgress?: (done: number, total: number) => void;
  config?: SimulatorConfig;
  runBattleTasks?: (tasks: BattleTask[], config: SimulatorConfig, onBattleDone: (battleReps: number) => void) => Promise<BattleSummary[]>;
}

export const MAIN_POOL: Record<string, MainHeroRole> = {
  Edith: "inf",
  Hector: "inf",
  "Wu Ming": "inf",
  Gordon: "lanc",
  Mia: "lanc",
  Philly: "lanc",
  Alonso: "mark",
  Bradley: "mark",
  Greg: "mark",
  Wayne: "mark",
};

export const JOINER_POOL = [
  "Jessie",
  "Seo-yoon",
  "Lumak",
  "Ling",
  "Patrick",
  "Mia",
  "Reina",
  "Renee",
  "Ahmose",
  "Norah",
  "Philly",
  "Wayne",
  "Wu Ming",
] as const;

export function mainHeroesForRole(role: MainHeroRole): string[] {
  return Object.entries(MAIN_POOL)
    .filter(([, value]) => value === role)
    .map(([name]) => name);
}

export function parseRatio(text: string, total: number): Team["troops"] {
  const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length !== 3) throw new Error("Ratio must be inf,lanc,mark");
  const values = parts.map((part) => Number(part));
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error(`Ratio has invalid values: ${text}`);
  }
  const sum = values[0] + values[1] + values[2];
  if (sum <= 0) throw new Error("Ratio sum must be greater than zero");
  const infantry = Math.round((total * values[0]) / sum);
  const lancer = Math.round((total * values[1]) / sum);
  return {
    infantry_t10: infantry,
    lancer_t10: lancer,
    marksman_t10: total - infantry - lancer,
  };
}

export function generateTournamentTeams(groups: TournamentTeamGroupPayload[], totalTroops: number): Team[] {
  const teams: Team[] = [];
  let id = 0;
  groups.forEach((group, groupIndex) => {
    const label = group.label.trim() || `Group ${groupIndex + 1}`;
    const ratios = uniqueNonEmpty(group.ratios);
    const infantryMains = uniqueNonEmpty(group.infantryMains);
    const lancerMains = uniqueNonEmpty(group.lancerMains);
    const marksmanMains = uniqueNonEmpty(group.marksmanMains);
    const joinerPool = uniqueNonEmpty(group.joiners);
    if (!ratios.length || !infantryMains.length || !lancerMains.length || !marksmanMains.length || !joinerPool.length) return;

    for (const ratioLabel of ratios) {
      const troops = parseRatio(ratioLabel, totalTroops);
      for (const infantry of infantryMains) {
        for (const lancer of lancerMains) {
          for (const marksman of marksmanMains) {
            const mains: [string, string, string] = [infantry, lancer, marksman];
            const availableJoiners = group.excludeMainHeroesFromJoiners
              ? joinerPool.filter((joiner) => !mains.includes(joiner))
              : joinerPool;
            const joinerCombos = group.allowRepeatedJoiners
              ? combinationsWithReplacement(availableJoiners, 4)
              : combinations(availableJoiners, 4);
            for (const joiners of joinerCombos) {
              teams.push({
                id,
                mains,
                joiners: joiners as Team["joiners"],
                ratioLabel,
                groupLabel: label,
                troops,
              });
              id += 1;
            }
          }
        }
      }
    }
  });
  return teams;
}

export function estimateTournamentTeamCount(groups: TournamentTeamGroupPayload[]): number {
  return groups.reduce((sum, group) => {
    const mainCount =
      uniqueNonEmpty(group.infantryMains).length *
      uniqueNonEmpty(group.lancerMains).length *
      uniqueNonEmpty(group.marksmanMains).length;
    const ratioCount = uniqueNonEmpty(group.ratios).length;
    const joinerCount = uniqueNonEmpty(group.joiners).length;
    const comboCount = group.allowRepeatedJoiners
      ? countCombinationsWithReplacement(joinerCount, 4)
      : countCombinations(joinerCount, 4);
    return sum + mainCount * ratioCount * comboCount;
  }, 0);
}

export function estimateSwissBattles(teamCount: number, request: Pick<TournamentRequestPayload, "rounds" | "reps">): number {
  return Math.max(0, teamCount) * Math.max(0, request.rounds) * Math.max(1, request.reps);
}

export function estimateFinalsBattles(
  teamCount: number,
  request: Pick<TournamentRequestPayload, "finalsTopM" | "finalsReps">,
): number {
  const sideCount = Math.min(Math.max(0, request.finalsTopM), Math.max(0, teamCount));
  return sideCount * sideCount * Math.max(1, request.finalsReps);
}

export async function runTournament(request: TournamentRequestPayload, options: TournamentRunOptions = {}): Promise<TournamentResult> {
  const config = options.config ?? loadSimulatorConfig();
  const teams = generateTournamentTeams(request.groups, request.totalTroops);
  if (teams.length < 2) throw new Error("Add enough tournament teams to run at least two entries");
  const runBattleTasks = options.runBattleTasks ?? runBattleTasksDirect;

  const progressTotal =
    estimateSwissBattles(teams.length, request) +
    estimateFinalsBattles(teams.length, request);
  let progressDone = 0;
  const reportBattleProgress = (battleReps: number) => {
    progressDone += battleReps;
    options.onProgress?.(Math.min(progressDone, progressTotal), progressTotal);
  };

  const attackerPool = new Pool(teams);
  const defenderPool = new Pool(teams);
  await runDualSwissTournament(attackerPool, defenderPool, request, config, runBattleTasks, reportBattleProgress);

  const swissOffenseScores = attackerPool.finalScoresOrdered;
  const swissDefenseScores = defenderPool.finalScoresOrdered;
  const result: TournamentResult = {
    generatedTeams: teams.length,
    swiss: {
      offense: scoreSet(swissOffenseScores, request.topN),
      defense: scoreSet(swissDefenseScores, request.topN),
    },
  };

  if (request.finalsTopM > 0) {
    const finalAttackers = selectFinalsTeamsByMainLineup(
      swissOffenseScores.map((score) => score.team),
      request.finalsTopM,
      request.finalsMaxSameMainLineup,
    );
    const finalDefenders = selectFinalsTeamsByMainLineup(
      swissDefenseScores.map((score) => score.team),
      request.finalsTopM,
      request.finalsMaxSameMainLineup,
    );
    const [finalAttackPool, finalDefensePool] = await runFinalsRoundRobin(
      finalAttackers,
      finalDefenders,
      request,
      config,
      runBattleTasks,
      reportBattleProgress,
    );
    result.finals = {
      offense: scoreSet(finalAttackPool.finalScoresOrdered, request.topN),
      defense: scoreSet(finalDefensePool.finalScoresOrdered, request.topN),
      attackerCount: finalAttackers.length,
      defenderCount: finalDefenders.length,
      battles: finalAttackers.length * finalDefenders.length * Math.max(1, request.finalsReps),
    };
  }

  options.onProgress?.(progressTotal, progressTotal);
  return result;
}

export function sortTournamentRows(
  rows: TournamentResultRow[],
  key: TournamentSortKey,
  direction: "asc" | "desc",
): TournamentResultRow[] {
  const multiplier = direction === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => multiplier * compareRows(left, right, key));
}

export function tournamentRowsToCsv(rows: TournamentResultRow[]): string {
  const header = [
    "rank",
    "team_id",
    "group",
    "ratio",
    "infantry_main",
    "lancer_main",
    "marksman_main",
    "joiner_1",
    "joiner_2",
    "joiner_3",
    "joiner_4",
    "infantry_t10",
    "lancer_t10",
    "marksman_t10",
    "wins",
    "losses",
    "matches",
    "win_rate",
    "margin",
    "avg_margin",
  ];
  const body = rows.map((row) =>
    [
      row.rank,
      row.teamId,
      row.groupLabel,
      row.ratioLabel,
      ...row.mains,
      ...row.joiners,
      row.troops.infantry_t10,
      row.troops.lancer_t10,
      row.troops.marksman_t10,
      row.wins,
      row.losses,
      row.matches,
      row.winRate,
      row.margin,
      row.avgMargin,
    ].map(csvCell).join(","),
  );
  return [header.join(","), ...body].join("\n");
}

async function runDualSwissTournament(
  attackerPool: Pool,
  defenderPool: Pool,
  options: TournamentRequestPayload,
  config: SimulatorConfig,
  runBattleTasks: (tasks: BattleTask[], config: SimulatorConfig, onBattleDone: (battleReps: number) => void) => Promise<BattleSummary[]>,
  onBattleDone: (battleReps: number) => void,
): Promise<void> {
  const freezeEnabled = options.freezeRate > 0 || options.freezeLossesGte !== undefined && options.freezeLossesGte !== null;
  for (let round = 1; round <= options.rounds; round += 1) {
    const activeAttackers = attackerPool.teamsActiveOrdered;
    const activeDefenders = defenderPool.teamsActiveOrdered;
    if (freezeEnabled && activeAttackers.length < options.minPoolSize && activeDefenders.length < options.minPoolSize) break;
    if (activeAttackers.length === 0 || activeDefenders.length === 0) break;
    const tasks = round <= options.seedRounds
      ? createRandomRoundTasks(attackerPool, defenderPool, round, options.reps, options.seed)
      : createDualRankingTasks(attackerPool, defenderPool, round, options.reps, options.seed);
    const results = await runBattleTasks(tasks, config, onBattleDone);
    aggregateBattleResults(attackerPool, defenderPool, results);
    if (freezeEnabled && round >= options.startFreezeRound) {
      freezePools(attackerPool, defenderPool, options);
    }
  }
  attackerPool.finalizeRemaining();
  defenderPool.finalizeRemaining();
}

async function runFinalsRoundRobin(
  attackerTeams: Team[],
  defenderTeams: Team[],
  options: TournamentRequestPayload,
  config: SimulatorConfig,
  runBattleTasks: (tasks: BattleTask[], config: SimulatorConfig, onBattleDone: (battleReps: number) => void) => Promise<BattleSummary[]>,
  onBattleDone: (battleReps: number) => void,
): Promise<[Pool, Pool]> {
  const attackerPool = new Pool(attackerTeams);
  const defenderPool = new Pool(defenderTeams);
  const tasks: BattleTask[] = [];
  for (const attacker of attackerTeams) {
    for (const defender of defenderTeams) {
      const task: BattleTask = {
        attacker,
        defender,
        seed: options.seed + 999000 + tasks.length * 1000,
        reps: options.finalsReps,
      };
      tasks.push(task);
    }
  }
  aggregateBattleResults(attackerPool, defenderPool, await runBattleTasks(tasks, config, onBattleDone));
  attackerPool.finalizeRemaining();
  defenderPool.finalizeRemaining();
  return [attackerPool, defenderPool];
}

function createRandomRoundTasks(
  attackerPool: Pool,
  defenderPool: Pool,
  roundNum: number,
  reps: number,
  seed: number,
): BattleTask[] {
  const attackers = seededShuffle(attackerPool.teamsActiveOrdered, seed + roundNum);
  const defenders = seededShuffle(defenderPool.teamsActiveOrdered, seed + roundNum + 100000);
  return attackers.map((attacker, index) => ({
    attacker,
    defender: defenders[index],
    seed: seed + roundNum + index * 1000,
    reps,
  }));
}

function createDualRankingTasks(
  attackerPool: Pool,
  defenderPool: Pool,
  roundNum: number,
  reps: number,
  seed: number,
): BattleTask[] {
  const attackers = attackerPool.teamsActiveOrdered;
  const defenders = defenderPool.teamsActiveOrdered;
  return attackers.map((attacker, index) => ({
    attacker,
    defender: defenders[index],
    seed: seed + roundNum * 10000 + index * 1000,
    reps,
  }));
}

export function runSingleBattleDirect(
  task: BattleTask,
  config: SimulatorConfig,
  onBattleDone: (battleReps: number) => void,
): BattleSummary {
  if (task.reps < 1) throw new Error("Reps must be at least 1");
  let totalAttackerLeft = 0;
  let totalDefenderLeft = 0;
  for (let rep = 0; rep < task.reps; rep += 1) {
    const input = teamToBattleInput(task.attacker, task.defender, task.seed + rep, config);
    const score = signedRemainingScore(simulateBattle(input, config, { mode: "fast" }));
    if (score > 0) totalAttackerLeft += score;
    else if (score < 0) totalDefenderLeft += -score;
  }
  onBattleDone(task.reps);
  return {
    attackerId: task.attacker.id,
    defenderId: task.defender.id,
    avgAttackerLeft: Math.floor(totalAttackerLeft / task.reps),
    avgDefenderLeft: Math.floor(totalDefenderLeft / task.reps),
  };
}

export async function runBattleTasksDirect(
  tasks: BattleTask[],
  config: SimulatorConfig,
  onBattleDone: (battleReps: number) => void,
): Promise<BattleSummary[]> {
  return tasks.map((task) => runSingleBattleDirect(task, config, onBattleDone));
}

function teamToBattleInput(attacker: Team, defender: Team, seed: number, config: SimulatorConfig): BattleInput {
  return {
    attacker: teamToFighterInput(attacker, config),
    defender: teamToFighterInput(defender, config),
    seed,
    maxRounds: 600,
    mechanics: { hero_generation_stats: true, engagement_type: "rally" },
  };
}

function teamToFighterInput(team: Team, config: SimulatorConfig): FighterInput {
  return {
    name: "max",
    troops: { ...team.troops },
    heroes: team.mains.map((name) => ({ name, levels: allCombatSkillsAtLevelFive(name, config) })),
    joiner_heroes: team.joiners.map((name) => ({ name, levels: { skill_1: 5 } })),
  };
}

function allCombatSkillsAtLevelFive(heroName: string, config: SimulatorConfig): Record<string, number> {
  const definition = heroDefinitionFor(heroName, config);
  if (!definition) throw new Error(`Missing simulator hero definition for ${heroName}`);
  const levels: Record<string, number> = {};
  let index = 0;
  for (const skillId of Object.keys(definition.skills ?? {})) {
    index += 1;
    levels[`skill_${index}`] = 5;
    levels[skillId] = 5;
  }
  return levels;
}

function heroDefinitionFor(heroName: string, config: SimulatorConfig): SkillFile | undefined {
  const direct = config.heroDefinitions[heroName];
  if (direct) return direct;
  const normalized = normalizeHeroName(heroName);
  const alias = config.heroAliasIndex?.[normalized];
  if (alias) return config.heroDefinitions[alias];
  const manualAliases: Record<string, string> = {
    lingxue: "Ling",
    lumakbokan: "Lumak",
    wuming: "WuMing",
  };
  const manual = manualAliases[normalized];
  if (manual) return config.heroDefinitions[manual];
  for (const [key, definition] of Object.entries(config.heroDefinitions)) {
    if (normalizeHeroName(key) === normalized || normalizeHeroName(definition.name ?? "") === normalized) return definition;
  }
  return undefined;
}

function aggregateBattleResults(attackerPool: Pool, defenderPool: Pool, results: BattleSummary[]): void {
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

function freezePools(attackerPool: Pool, defenderPool: Pool, options: TournamentRequestPayload): void {
  if (options.freezeLossesGte !== undefined && options.freezeLossesGte !== null) {
    const count = Math.max(
      attackerPool.countActiveLossesAtLeast(options.freezeLossesGte),
      defenderPool.countActiveLossesAtLeast(options.freezeLossesGte),
    );
    attackerPool.freezeLossesAtLeast(options.freezeLossesGte, count);
    defenderPool.freezeLossesAtLeast(options.freezeLossesGte, count);
    return;
  }
  attackerPool.freezeBottomTeams(options.freezeRate);
  defenderPool.freezeBottomTeams(options.freezeRate);
}

function scoreSet(scores: Score[], topN: number): TournamentResultSet {
  const rows = scores.map(scoreToRow);
  return {
    rows: rows.slice(0, Math.max(1, topN)),
    totalRows: rows.length,
  };
}

function scoreToRow(score: Score, index: number): TournamentResultRow {
  const matches = score.matches;
  const wins = score.wins;
  return {
    rank: index + 1,
    teamId: score.team.id,
    groupLabel: score.team.groupLabel,
    ratioLabel: score.team.ratioLabel,
    mains: score.team.mains,
    joiners: score.team.joiners,
    troops: score.team.troops,
    wins,
    matches,
    losses: matches - wins,
    winRate: matches > 0 ? wins / matches : 0,
    margin: score.margin,
    avgMargin: matches > 0 ? score.margin / matches : 0,
  };
}

export class Pool {
  readonly teams: Team[];
  readonly scoreById = new Map<number, Score>();
  scoresActive: Score[];
  scoresFinal: Score[] = [];

  constructor(teams: Team[]) {
    this.teams = teams;
    this.scoresActive = teams.map((team) => ({ team, wins: 0, matches: 0, margin: 0 }));
    for (const score of this.scoresActive) this.scoreById.set(score.team.id, score);
  }

  sortActive(): Score[] {
    this.scoresActive.sort(compareScores);
    return this.scoresActive;
  }

  freezeBottomTeams(freezeRate: number): void {
    if (this.scoresActive.length === 0) return;
    const count = Math.min(this.scoresActive.length, Math.max(1, Math.floor(this.scoresActive.length * freezeRate)));
    this.freezeBottomCount(count);
  }

  freezeBottomCount(count: number): void {
    if (this.scoresActive.length === 0 || count <= 0) return;
    this.sortActive();
    const freezeCount = Math.min(this.scoresActive.length, count);
    for (let index = 0; index < freezeCount; index += 1) {
      const score = this.scoresActive.pop();
      if (score) this.scoresFinal.unshift(score);
    }
  }

  countActiveLossesAtLeast(minLosses: number): number {
    return this.scoresActive.filter((score) => losses(score) >= minLosses).length;
  }

  freezeLossesAtLeast(minLosses: number, count: number): void {
    if (this.scoresActive.length === 0 || count <= 0) return;
    const sorted = this.sortActive();
    const selected = new Set<Score>();
    for (const score of sorted) {
      if (losses(score) >= minLosses) selected.add(score);
    }
    for (let index = sorted.length - 1; selected.size < count && index >= 0; index -= 1) {
      selected.add(sorted[index]);
    }
    const frozen: Score[] = [];
    const active: Score[] = [];
    for (const score of sorted) {
      if (selected.has(score)) frozen.push(score);
      else active.push(score);
    }
    this.scoresActive = active;
    this.scoresFinal = [...frozen, ...this.scoresFinal];
  }

  get teamsActiveOrdered(): Team[] {
    return this.sortActive().map((score) => score.team);
  }

  getScore(teamId: number): Score {
    const score = this.scoreById.get(teamId);
    if (!score) throw new Error(`Unknown team id ${teamId}`);
    return score;
  }

  finalizeRemaining(): void {
    this.sortActive();
    this.scoresFinal = [...this.scoresActive, ...this.scoresFinal];
    this.scoresActive = [];
  }

  get finalScoresOrdered(): Score[] {
    if (this.scoresActive.length > 0) this.sortActive();
    return [...this.scoresActive, ...this.scoresFinal];
  }
}

function selectFinalsTeamsByMainLineup(teams: Team[], topM: number, maxSameMainLineup: number): Team[] {
  if (maxSameMainLineup <= 0) return teams.slice(0, topM);
  const selected: Team[] = [];
  const counts = new Map<string, number>();
  for (const team of teams) {
    if (selected.length >= topM) break;
    const key = team.mains.join("\u0000");
    const count = counts.get(key) ?? 0;
    if (count >= maxSameMainLineup) continue;
    selected.push(team);
    counts.set(key, count + 1);
  }
  return selected;
}

function compareScores(left: Score, right: Score): number {
  return winRate(right) - winRate(left) || avgMargin(right) - avgMargin(left) || right.team.id - left.team.id;
}

function compareRows(left: TournamentResultRow, right: TournamentResultRow, key: TournamentSortKey): number {
  if (key === "rank") return left.rank - right.rank;
  if (key === "wins") return left.wins - right.wins;
  if (key === "winRate") return left.winRate - right.winRate;
  if (key === "avgMargin") return left.avgMargin - right.avgMargin;
  if (key === "matches") return left.matches - right.matches;
  if (key === "ratio") return left.ratioLabel.localeCompare(right.ratioLabel);
  if (key === "mains") return left.mains.join("/").localeCompare(right.mains.join("/"));
  return left.joiners.join("/").localeCompare(right.joiners.join("/"));
}

function winRate(score: Score): number {
  return score.matches > 0 ? score.wins / score.matches : 0;
}

function avgMargin(score: Score): number {
  return score.matches > 0 ? score.margin / score.matches : 0;
}

function losses(score: Score): number {
  return score.matches - score.wins;
}

function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const copy = [...items];
  let state = seed >>> 0;
  for (let index = copy.length - 1; index > 0; index -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const swapIndex = state % (index + 1);
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function combinations<T>(items: T[], size: number): T[][] {
  const output: T[][] = [];
  function visit(start: number, current: T[]): void {
    if (current.length === size) {
      output.push([...current]);
      return;
    }
    for (let index = start; index <= items.length - (size - current.length); index += 1) {
      current.push(items[index]);
      visit(index + 1, current);
      current.pop();
    }
  }
  visit(0, []);
  return output;
}

function combinationsWithReplacement<T>(items: T[], size: number): T[][] {
  const output: T[][] = [];
  function visit(start: number, current: T[]): void {
    if (current.length === size) {
      output.push([...current]);
      return;
    }
    for (let index = start; index < items.length; index += 1) {
      current.push(items[index]);
      visit(index, current);
      current.pop();
    }
  }
  visit(0, []);
  return output;
}

function countCombinations(itemCount: number, size: number): number {
  if (itemCount < size) return 0;
  return factorial(itemCount) / (factorial(size) * factorial(itemCount - size));
}

function countCombinationsWithReplacement(itemCount: number, size: number): number {
  if (itemCount <= 0) return 0;
  return countCombinations(itemCount + size - 1, size);
}

function factorial(value: number): number {
  let result = 1;
  for (let current = 2; current <= value; current += 1) result *= current;
  return result;
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeHeroName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function csvCell(value: unknown): string {
  const text = String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}
