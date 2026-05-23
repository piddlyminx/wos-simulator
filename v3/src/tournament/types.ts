export type MainHeroRole = "inf" | "lanc" | "mark";

export interface Team {
  mains: [string, string, string];
  joiners: [string, string, string, string];
  id: number;
  ratioLabel: string;
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

export interface TournamentOptions {
  totalRounds: number;
  seedRounds: number;
  reps: number;
  jobs: number;
  seed: number;
  timeLimitMins?: number;
  freezeRate: number;
  startFreezeRound: number;
  minPoolSize: number;
}
