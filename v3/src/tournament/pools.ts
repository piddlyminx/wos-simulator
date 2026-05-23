import type { Score, Team } from "./types.js";

export function winRate(score: Score): number {
  return score.matches > 0 ? score.wins / score.matches : 0;
}

export function avgMargin(score: Score): number {
  return score.matches > 0 ? score.margin / score.matches : 0;
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
    this.sortActive();
    const count = Math.min(this.scoresActive.length, Math.max(1, Math.floor(this.scoresActive.length * freezeRate)));
    for (let index = 0; index < count; index += 1) {
      const score = this.scoresActive.pop();
      if (score) this.scoresFinal.unshift(score);
    }
  }

  get teamsActiveOrdered(): Team[] {
    return this.sortActive().map((score) => score.team);
  }

  get teamsFinalOrdered(): Team[] {
    return this.scoresFinal.map((score) => score.team);
  }

  get allScores(): Score[] {
    return [...this.scoresActive, ...this.scoresFinal];
  }

  get teamsAll(): Team[] {
    return this.allScores.map((score) => score.team);
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

function compareScores(left: Score, right: Score): number {
  return winRate(right) - winRate(left) || avgMargin(right) - avgMargin(left) || right.team.id - left.team.id;
}
