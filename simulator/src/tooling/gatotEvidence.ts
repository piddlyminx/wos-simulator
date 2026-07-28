import { pathToFileURL } from "node:url";

import { BattleInputBuilder } from "../battleInputBuilder";
import { loadSimulatorConfig } from "../config";
import { simulateBattles } from "../simulator";
import type {
  BattleInput,
  BattleResult,
  FighterInput,
  HeroSkillLevels,
  SideId,
  SimulatorConfig,
  StatBlock
} from "../types";

export type EvidenceWinner = SideId | "draw";

export interface GatotGameObservation {
  id: string;
  section: string;
  caseLabel: string;
  stochastic: boolean;
  game: {
    winner: EvidenceWinner;
    survivors: { attacker?: number; defender?: number };
    rounds?: number;
  };
  buildInput?: (config: SimulatorConfig) => BattleInput;
  notRunnableReason?: string;
  notes?: string;
}

interface NumericSummary {
  mean: number;
  min: number;
  max: number;
}

export interface GatotEvidenceResult {
  observation: GatotGameObservation;
  sampleCount: number;
  winnerCounts?: Record<EvidenceWinner, number>;
  attackerSurvivors?: NumericSummary;
  defenderSurvivors?: NumericSummary;
  rounds?: NumericSummary;
  error?: string;
}

export interface GatotEvidenceRunOptions {
  replicates?: number;
  matching?: string;
}

const DEFAULT_REPLICATES = 100;
const MAX_ROUNDS = 1500;

const T6_THRESHOLD_ATTACKER_STATS: StatBlock = {
  attack: 285.3,
  defense: 283.3,
  lethality: 0,
  health: 0
};
const T6_STRONG_INFANTRY_STATS: StatBlock = {
  attack: 326.1,
  defense: 330.1,
  lethality: 18.2,
  health: 18.2
};
const T6_WEAK_INFANTRY_STATS: StatBlock = {
  attack: 295.3,
  defense: 293.3,
  lethality: 10,
  health: 10
};
const T6_STRONG_BACKLINE_STATS: StatBlock = {
  attack: 284.8,
  defense: 288.8,
  lethality: 18.2,
  health: 18.2
};
const T6_MIXED_BACKLINE_STATS: StatBlock = {
  attack: 78.1,
  defense: 82.1,
  lethality: 18.2,
  health: 18.2
};
const FC9_ATTACKER_STATS: StatBlock = {
  attack: 1513,
  defense: 1634.1,
  lethality: 831.2,
  health: 1103.1
};
const FC9_DEFENDER_STATS: StatBlock = {
  attack: 1354,
  defense: 1413.7,
  lethality: 634.3,
  health: 812.6
};
const T6_MARKSMAN_STATS: StatBlock = {
  attack: 208.8,
  defense: 207.1,
  lethality: 158.8,
  health: 164.7
};
const FC10_INFANTRY_STATS: StatBlock = {
  attack: 2159.6,
  defense: 2185.6,
  lethality: 1942.2,
  health: 2139.7
};
const T9_LANCER_STATS: StatBlock = {
  attack: 208.8,
  defense: 207.1,
  lethality: 167.5,
  health: 167.6
};
const FC10_LANCER_STATS: StatBlock = {
  attack: 1179,
  defense: 1202.9,
  lethality: 1362.1,
  health: 1134.5
};

const GATOT_123 = skills(1, 2, 3);
const GATOT_222 = skills(2, 2, 2);
const GATOT_133 = skills(1, 3, 3);
const GATOT_555 = skills(5, 5, 5);

function skills(skill1: number, skill2?: number, skill3?: number): HeroSkillLevels {
  return {
    skill_1: skill1,
    ...(skill2 !== undefined ? { skill_2: skill2 } : {}),
    ...(skill3 !== undefined ? { skill_3: skill3 } : {})
  };
}

function buildBattle(
  id: string,
  attacker: FighterInput,
  defender: FighterInput,
  config: SimulatorConfig
): BattleInput {
  return new BattleInputBuilder(config)
    .fighter("attacker", attacker)
    .fighter("defender", defender)
    .seed(`gatot-evidence:${id}`)
    .maxRounds(MAX_ROUNDS)
    .build();
}

function thresholdInput(id: string, attackerCount: number, defenderCount: number, defenderHealth = 18.2) {
  return (config: SimulatorConfig): BattleInput =>
    buildBattle(
      id,
      {
        troops: { infantry_t6: attackerCount },
        stats: { infantry: T6_THRESHOLD_ATTACKER_STATS },
        heroes: { Gatot: GATOT_123 }
      },
      {
        troops: { infantry_t6: defenderCount },
        stats: { infantry: { ...T6_STRONG_INFANTRY_STATS, health: defenderHealth } },
        heroes: { Gatot: GATOT_222 }
      },
      config
    );
}

function fc9GatotInput(id: string, count: number, withLumak: boolean) {
  return (config: SimulatorConfig): BattleInput =>
    buildBattle(
      id,
      {
        troops: { infantry_t11_fc9: count },
        stats: { infantry: FC9_ATTACKER_STATS },
        heroes: {
          Gatot: GATOT_555,
          ...(withLumak ? { Lumak: skills(5) } : {})
        }
      },
      {
        troops: { infantry_t10_fc9: count },
        stats: { infantry: FC9_DEFENDER_STATS },
        heroes: { Gatot: GATOT_555 }
      },
      config
    );
}

function singleFc10InfantryInput(id: string, marksmanTier: 6 | 9, marksmen: number) {
  return (config: SimulatorConfig): BattleInput =>
    buildBattle(
      id,
      {
        troops: { [`marksman_t${marksmanTier}`]: marksmen },
        stats: { marksman: T6_MARKSMAN_STATS },
        heroes: {}
      },
      {
        troops: { infantry_t1_fc10: 1 },
        stats: { infantry: FC10_INFANTRY_STATS },
        heroes: { Gatot: GATOT_555 }
      },
      config
    );
}

function lancerCalibrationInput(id: string, attackerCount: number) {
  return (config: SimulatorConfig): BattleInput =>
    buildBattle(
      id,
      {
        troops: { lancer_t9: attackerCount },
        stats: { lancer: T9_LANCER_STATS },
        heroes: {}
      },
      {
        troops: { lancer_t1_fc10: 146 },
        stats: { lancer: FC10_LANCER_STATS },
        heroes: {}
      },
      config
    );
}

function gatotMixedInput(id: string, infantry: number, lancer: number, marksman: number) {
  return (config: SimulatorConfig): BattleInput =>
    buildBattle(
      id,
      {
        troops: {
          ...(infantry > 0 ? { infantry_t6: infantry } : {}),
          ...(lancer > 0 ? { lancer_t6: lancer } : {}),
          ...(marksman > 0 ? { marksman_t6: marksman } : {})
        },
        stats: {
          infantry: T6_STRONG_INFANTRY_STATS,
          lancer: T6_MIXED_BACKLINE_STATS,
          marksman: T6_MIXED_BACKLINE_STATS
        },
        heroes: { Gatot: GATOT_222 }
      },
      {
        troops: { infantry_t6: 5000 },
        stats: { infantry: T6_WEAK_INFANTRY_STATS },
        heroes: { Gatot: GATOT_133 }
      },
      config
    );
}

function observation(
  value: Omit<GatotGameObservation, "stochastic"> & { stochastic?: boolean }
): GatotGameObservation {
  return { stochastic: false, ...value };
}

const section1 = [
  { count: 4900, defender: 1000, winner: "draw", rounds: 1500, attackerSurvivors: 4897, defenderSurvivors: 996 },
  { count: 4950, defender: 1000, winner: "draw", rounds: 1500, attackerSurvivors: 4947, defenderSurvivors: 855 },
  { count: 5000, defender: 1000, winner: "draw", rounds: 1500, attackerSurvivors: 4997, defenderSurvivors: 513 },
  { count: 5050, defender: 1000, winner: "draw", rounds: 1500, attackerSurvivors: 5047, defenderSurvivors: 74 },
  { count: 5100, defender: 1000, winner: "attacker", rounds: 1381, defenderSurvivors: 0 },
  { count: 10000, defender: 2000, winner: "attacker", rounds: 452, defenderSurvivors: 0 },
  { count: 20000, defender: 4000, winner: "attacker", rounds: 337, defenderSurvivors: 0 }
] as const;

const section2 = [
  { count: 4950, defenderSurvivors: 904, attackerSurvivors: 4947, winner: "draw", rounds: 1500 },
  { count: 5000, defenderSurvivors: 670, attackerSurvivors: 4997, winner: "draw", rounds: 1500 },
  { count: 5050, defenderSurvivors: 406, attackerSurvivors: 5047, winner: "draw", rounds: 1500 },
  { count: 5100, defenderSurvivors: 80, attackerSurvivors: 5097, winner: "draw", rounds: 1500 },
  { count: 5150, defenderSurvivors: 0, attackerSurvivors: 5147, winner: "attacker" }
] as const;

const section4 = [
  { count: 10000, rounds: 923, attackerSurvivors: 9992 },
  { count: 20000, rounds: 702, attackerSurvivors: 19983 },
  { count: 40000, rounds: 610, attackerSurvivors: 39135 },
  { count: 90000, rounds: 560, attackerSurvivors: 83565 }
] as const;

const section5 = [
  { count: 20000, rounds: 705, attackerSurvivors: 19986 },
  { count: 40000, rounds: 598, attackerSurvivors: 39914 },
  { count: 90000, rounds: 554, attackerSurvivors: 86767 }
] as const;

const section8 = [
  { start: 33510, survivors: 33481, rounds: 157 },
  { start: 33481, survivors: 33452, rounds: 160 },
  { start: 33452, survivors: 33427, rounds: 135 },
  { start: 33427, survivors: 33401, rounds: 144 },
  { start: 30228, survivors: 30205, rounds: 123 },
  { start: 30205, survivors: 30179, rounds: 139 },
  { start: 30179, survivors: 30139, rounds: 216 },
  { start: 30139, survivors: 30116, rounds: 123 },
  { start: 30116, survivors: 30081, rounds: 189 },
  { start: 25000, survivors: 24929, rounds: 329 },
  { start: 20000, survivors: 19943, rounds: 308 },
  { start: 12000, survivors: 11791, rounds: 1121 },
  { start: 11791, survivors: 11548, rounds: 1300 },
  { start: 11548, survivors: 11268, rounds: 1500, winner: "draw" },
  { start: 10000, survivors: 9720, rounds: 1500, winner: "draw" }
] as const;

const section9 = [
  { start: 3000, winner: "attacker", attackerSurvivors: 2201, defenderSurvivors: 0 },
  { start: 2201, winner: "attacker", attackerSurvivors: 1233, defenderSurvivors: 0 },
  { start: 1500, winner: "defender", attackerSurvivors: 0, defenderSurvivors: 85 },
  { start: 1950, winner: "defender", attackerSurvivors: 0, defenderSurvivors: 45 },
  { start: 2100, winner: "defender", attackerSurvivors: 0, defenderSurvivors: 37 },
  { start: 2200, winner: "defender", attackerSurvivors: 0, defenderSurvivors: 20 }
] as const;

const section15Mixed = [
  { infantry: 1000, lancer: 1000, marksman: 0, winner: "defender", survivors: 4973, rounds: 266 },
  { infantry: 1000, lancer: 0, marksman: 1000, winner: "defender", survivors: 4491, rounds: 278 },
  { infantry: 2000, lancer: 1000, marksman: 0, winner: "defender", survivors: 4338, rounds: 545 },
  { infantry: 1000, lancer: 1000, marksman: 1000, winner: "defender", survivors: 3064, rounds: 238 },
  { infantry: 2000, lancer: 0, marksman: 1000, winner: "attacker", survivors: 1281, rounds: 907 }
] as const;

export const GATOT_GAME_OBSERVATIONS: readonly GatotGameObservation[] = [
  ...section1.map((row) => {
    const id = `s1-${row.count}-vs-${row.defender}`;
    return observation({
      id,
      section: "1",
      caseLabel: `${row.count.toLocaleString("en-US")} T6 infantry vs ${row.defender.toLocaleString("en-US")} T6 infantry`,
      game: {
        winner: row.winner,
        survivors: {
          ...("attackerSurvivors" in row ? { attacker: row.attackerSurvivors } : {}),
          defender: row.defenderSurvivors
        },
        rounds: row.rounds
      },
      buildInput: thresholdInput(id, row.count, row.defender),
      ...(!("attackerSurvivors" in row)
        ? { notes: "Game attacker survivor count was not recorded; defender zero follows from the recorded attacker win." }
        : {})
    });
  }),
  ...section2.map((row) => {
    const id = `s2-health-1.1-${row.count}-vs-1000`;
    return observation({
      id,
      section: "2",
      caseLabel: `${row.count.toLocaleString("en-US")} T6 infantry vs 1,000 T6 infantry; defender Health x1.1`,
      game: {
        winner: row.winner,
        survivors: { attacker: row.attackerSurvivors, defender: row.defenderSurvivors },
        ...("rounds" in row ? { rounds: row.rounds } : {})
      },
      buildInput: thresholdInput(id, row.count, 1000, 30.02),
      ...(!("rounds" in row) ? { notes: "Winning round was not recorded." } : {})
    });
  }),
  observation({
    id: "s3-5000-inf-vs-1000-inf-10-lancer",
    section: "3",
    caseLabel: "5,000 T6 infantry vs 1,000 T6 infantry + 10 T6 lancers",
    game: { winner: "attacker", survivors: { attacker: 4573, defender: 0 }, rounds: 1151 },
    buildInput: (config) =>
      buildBattle(
        "s3-5000-inf-vs-1000-inf-10-lancer",
        {
          troops: { infantry_t6: 5000 },
          stats: { infantry: { attack: 295.3, defense: 293.3, lethality: 10, health: 10 } },
          heroes: { Gatot: skills(1, 3, 3) }
        },
        {
          troops: { infantry_t6: 1000, lancer_t6: 10 },
          stats: {
            infantry: T6_STRONG_INFANTRY_STATS,
            lancer: T6_STRONG_BACKLINE_STATS
          },
          heroes: { Gatot: GATOT_222, Gordon: skills(3, 3, 3) }
        },
        config
      )
  }),
  ...section4.map((row) => {
    const id = `s4-fc9-gatot-${row.count}`;
    return observation({
      id,
      section: "4",
      caseLabel: `${row.count.toLocaleString("en-US")} T11 FC9 infantry vs same count T10 FC9 infantry`,
      stochastic: true,
      game: {
        winner: "attacker",
        survivors: { attacker: row.attackerSurvivors, defender: 0 },
        rounds: row.rounds
      },
      buildInput: fc9GatotInput(id, row.count, false),
      notes: "Attacker win and zero defender survivors are inferred from the recorded positive attacker survivor count."
    });
  }),
  ...section5.map((row) => {
    const id = `s5-fc9-gatot-lumak-${row.count}`;
    return observation({
      id,
      section: "5",
      caseLabel: `${row.count.toLocaleString("en-US")} T11 FC9 infantry + Lumak S1 vs same count T10 FC9 infantry`,
      stochastic: true,
      game: {
        winner: "attacker",
        survivors: { attacker: row.attackerSurvivors, defender: 0 },
        rounds: row.rounds
      },
      buildInput: fc9GatotInput(id, row.count, true),
      notes: "Attacker win and zero defender survivors are inferred from the recorded positive attacker survivor count."
    });
  }),
  observation({
    id: "s6-historical-t11-fc10-vs-10000-t6-marksmen",
    section: "6",
    caseLabel: "10,000 T6 marksmen vs one historical T11 FC10 infantry",
    game: { winner: "draw", survivors: { attacker: 5895, defender: 1 }, rounds: 1500 },
    notRunnableReason:
      "The complete attacker stat block was supplied only by screenshot and is not recoverable from the evidence document; the historical T11 FC10 catalogue has also been replaced."
  }),
  observation({
    id: "s6-historical-t11-fc10-vs-3000-t6-marksmen",
    section: "6",
    caseLabel: "3,000 T6 marksmen vs one historical T11 FC10 infantry",
    game: { winner: "defender", survivors: { attacker: 0, defender: 1 }, rounds: 1086 },
    notRunnableReason:
      "The complete attacker stat block was supplied only by screenshot and is not recoverable from the evidence document; the historical T11 FC10 catalogue has also been replaced."
  }),
  observation({
    id: "s7-10000-t6-marksmen-vs-one-t1-fc10-infantry",
    section: "7",
    caseLabel: "10,000 T6 marksmen vs one T1 FC10 infantry",
    game: { winner: "draw", survivors: { attacker: 9540, defender: 1 }, rounds: 1500 },
    buildInput: singleFc10InfantryInput("s7-10000-t6-marksmen-vs-one-t1-fc10-infantry", 6, 10000)
  }),
  ...section8.map((row) => {
    const id = `s8-${row.start}-t9-marksmen-vs-one-t1-fc10-infantry`;
    const winner = "winner" in row ? row.winner : "attacker";
    return observation({
      id,
      section: "8",
      caseLabel: `${row.start.toLocaleString("en-US")} T9 marksmen vs one T1 FC10 infantry`,
      stochastic: true,
      game: {
        winner,
        survivors: { attacker: row.survivors, defender: winner === "draw" ? 1 : 0 },
        rounds: row.rounds
      },
      buildInput: singleFc10InfantryInput(id, 9, row.start)
    });
  }),
  ...section9.map((row) => {
    const id = `s9-${row.start}-t9-lancers-vs-146-t1-fc10-lancers`;
    return observation({
      id,
      section: "9",
      caseLabel: `${row.start.toLocaleString("en-US")} T9 lancers vs 146 T1 FC10 lancers`,
      stochastic: true,
      game: {
        winner: row.winner,
        survivors: { attacker: row.attackerSurvivors, defender: row.defenderSurvivors }
      },
      buildInput: lancerCalibrationInput(id, row.start),
      notes: "No direct game round count was supplied; only activation-based estimates exist for one row."
    });
  }),
  observation({
    id: "s10-bradley-1000-inf-125-marksman-vs-5000-inf",
    section: "10",
    caseLabel: "1,000 T6 infantry + 125 T6 marksmen vs 5,000 T6 infantry; Bradley",
    game: { winner: "defender", survivors: { attacker: 0, defender: 2296 }, rounds: 875 },
    buildInput: (config) =>
      buildBattle(
        "s10-bradley-1000-inf-125-marksman-vs-5000-inf",
        {
          troops: { infantry_t6: 1000, marksman_t6: 125 },
          stats: {
            infantry: T6_STRONG_INFANTRY_STATS,
            marksman: T6_STRONG_BACKLINE_STATS
          },
          heroes: { Gatot: GATOT_222, Bradley: skills(3, 3, 3) }
        },
        {
          troops: { infantry_t6: 5000 },
          stats: { infantry: T6_WEAK_INFANTRY_STATS },
          heroes: { Gatot: GATOT_133 }
        },
        config
      )
  }),
  observation({
    id: "s15.2-secondary-heroes-1000-inf-125-lancer-125-marksman",
    section: "15.2",
    caseLabel: "1,000 T6 infantry + 125 lancers + 125 marksmen vs 5,000 infantry; secondary heroes",
    game: { winner: "attacker", survivors: { attacker: 851, defender: 0 }, rounds: 366 },
    buildInput: (config) =>
      buildBattle(
        "s15.2-secondary-heroes-1000-inf-125-lancer-125-marksman",
        {
          troops: { infantry_t6: 1000, lancer_t6: 125, marksman_t6: 125 },
          stats: {
            infantry: T6_STRONG_INFANTRY_STATS,
            lancer: T6_STRONG_BACKLINE_STATS,
            marksman: T6_STRONG_BACKLINE_STATS
          },
          heroes: {
            Gatot: GATOT_222,
            Gordon: skills(3, 3, 3),
            Bradley: skills(3, 3, 3)
          }
        },
        {
          troops: { infantry_t6: 5000 },
          stats: { infantry: T6_WEAK_INFANTRY_STATS },
          heroes: {
            Gatot: GATOT_133,
            Patrick: skills(1, 0),
            Bradley: skills(1, 3, 3)
          }
        },
        config
      )
  }),
  ...section15Mixed.map((row) => {
    const id = `s15.3-${row.infantry}-inf-${row.lancer}-lancer-${row.marksman}-marksman`;
    const isTriple = row.infantry === 1000 && row.lancer === 1000 && row.marksman === 1000;
    return observation({
      id,
      section: isTriple ? "15.1 / 15.3" : "15.3",
      caseLabel: `${row.infantry.toLocaleString("en-US")} infantry + ${row.lancer.toLocaleString(
        "en-US"
      )} lancer + ${row.marksman.toLocaleString("en-US")} marksman vs 5,000 infantry`,
      game: {
        winner: row.winner,
        survivors:
          row.winner === "attacker"
            ? { attacker: row.survivors, defender: 0 }
            : { attacker: 0, defender: row.survivors },
        rounds: row.rounds
      },
      buildInput: gatotMixedInput(id, row.infantry, row.lancer, row.marksman),
      ...(isTriple ? { notes: "One observation cross-referenced in sections 15.1 and 15.3; counted once." } : {})
    });
  })
];

function totalSurvivors(result: BattleResult, side: SideId): number {
  return Object.values(result.remaining[side]).reduce((sum, count) => sum + count, 0);
}

function summarize(values: number[]): NumericSummary {
  if (values.length === 0) throw new Error("Cannot summarize an empty sample");
  return {
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    min: Math.min(...values),
    max: Math.max(...values)
  };
}

export function runGatotEvidence(options: GatotEvidenceRunOptions = {}): GatotEvidenceResult[] {
  const replicates = options.replicates ?? DEFAULT_REPLICATES;
  if (!Number.isInteger(replicates) || replicates < 1) {
    throw new Error(`replicates must be a positive integer, got ${JSON.stringify(replicates)}`);
  }

  const config = loadSimulatorConfig();
  const observations = GATOT_GAME_OBSERVATIONS.filter(
    (entry) =>
      !options.matching ||
      entry.id.includes(options.matching) ||
      entry.section.includes(options.matching) ||
      entry.caseLabel.toLowerCase().includes(options.matching.toLowerCase())
  );

  return observations.map((entry) => {
    if (!entry.buildInput) return { observation: entry, sampleCount: 0 };
    const sampleCount = entry.stochastic ? replicates : 1;
    try {
      const results = simulateBattles(entry.buildInput(config), config, { mode: "fast", count: sampleCount });
      const winnerCounts: Record<EvidenceWinner, number> = { attacker: 0, defender: 0, draw: 0 };
      for (const result of results) winnerCounts[result.winner] += 1;
      return {
        observation: entry,
        sampleCount,
        winnerCounts,
        attackerSurvivors: summarize(results.map((result) => totalSurvivors(result, "attacker"))),
        defenderSurvivors: summarize(results.map((result) => totalSurvivors(result, "defender"))),
        rounds: summarize(results.map((result) => result.rounds))
      };
    } catch (error) {
      return {
        observation: entry,
        sampleCount,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
}

function winnerLabel(winner: EvidenceWinner): string {
  if (winner === "attacker") return "Attacker";
  if (winner === "defender") return "Defender";
  return "Draw";
}

function formatNumber(value: number): string {
  const rounded = Math.round(value);
  const shown = Math.abs(value - rounded) < 0.05 ? String(rounded) : value.toFixed(1);
  const [integer, decimal] = shown.split(".");
  const signed = integer.startsWith("-") ? `-${integer.slice(1).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}` : integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decimal === undefined ? signed : `${signed}.${decimal}`;
}

function formatSigned(value: number): string {
  if (Math.abs(value) < 0.05) return "0";
  return `${value > 0 ? "+" : "−"}${formatNumber(Math.abs(value))}`;
}

function formatSummary(summary: NumericSummary, stochastic: boolean): string {
  const mean = formatNumber(summary.mean);
  return stochastic ? `${mean} [${formatNumber(summary.min)}–${formatNumber(summary.max)}]` : mean;
}

function gameSurvivors(entry: GatotGameObservation): string {
  const attacker = entry.game.survivors.attacker;
  const defender = entry.game.survivors.defender;
  return `A ${attacker === undefined ? "—" : formatNumber(attacker)} / D ${
    defender === undefined ? "—" : formatNumber(defender)
  }`;
}

function simulatedWinner(result: GatotEvidenceResult): string {
  if (!result.winnerCounts || result.sampleCount === 0) return "—";
  if (!result.observation.stochastic) {
    const winner = (Object.entries(result.winnerCounts) as Array<[EvidenceWinner, number]>).find(
      ([, count]) => count > 0
    )?.[0];
    return winner ? winnerLabel(winner) : "—";
  }
  return (["attacker", "defender", "draw"] as const)
    .filter((winner) => result.winnerCounts![winner] > 0)
    .map(
      (winner) =>
        `${winnerLabel(winner)} ${formatNumber((100 * result.winnerCounts![winner]) / result.sampleCount)}%`
    )
    .join(" / ");
}

function simulatedSurvivors(result: GatotEvidenceResult): string {
  if (!result.attackerSurvivors || !result.defenderSurvivors) return "—";
  return `A ${formatSummary(result.attackerSurvivors, result.observation.stochastic)} / D ${formatSummary(
    result.defenderSurvivors,
    result.observation.stochastic
  )}`;
}

function survivorDifference(result: GatotEvidenceResult): string {
  if (!result.attackerSurvivors || !result.defenderSurvivors) return "—";
  const game = result.observation.game.survivors;
  return `A ${
    game.attacker === undefined ? "—" : formatSigned(result.attackerSurvivors.mean - game.attacker)
  } / D ${game.defender === undefined ? "—" : formatSigned(result.defenderSurvivors.mean - game.defender)}`;
}

function statusAndNotes(result: GatotEvidenceResult): string {
  const pieces: string[] = [];
  if (result.observation.notRunnableReason) pieces.push(`Not runnable: ${result.observation.notRunnableReason}`);
  else if (result.error) pieces.push(`Error: ${result.error}`);
  else pieces.push(result.observation.stochastic ? `Stochastic; n=${result.sampleCount}` : "Deterministic");
  if (result.observation.notes) pieces.push(result.observation.notes);
  return pieces.join(" ").replaceAll("|", "\\|");
}

export function renderGatotEvidenceMarkdown(results: readonly GatotEvidenceResult[]): string {
  const stochasticSamples = results.reduce(
    (sum, result) => sum + (result.observation.stochastic ? result.sampleCount : 0),
    0
  );
  const runnable = results.filter((result) => result.observation.buildInput).length;
  const notRunnable = results.length - runnable;
  const lines = [
    "# Gatot battle evidence check",
    "",
    `Observations: ${results.length}; runnable: ${runnable}; not runnable: ${notRunnable}; stochastic samples executed: ${stochasticSamples}.`,
    "",
    "Differences are `simulator − game`. Stochastic simulator cells show `mean [min–max]`.",
    "Displayed report stats are passed through unchanged; hero-generation stats are not added again. Each stochastic case uses a stable case-id seed and the simulator's `<seed>#<replicate>` derivation.",
    "",
    "| Section | Case | Game outcome | Game survivors | Simulated outcome | Simulated survivors | Survivor difference | Game rounds | Simulated rounds | Round difference | Status / notes |",
    "|---|---|---|---:|---|---:|---:|---:|---:|---:|---|"
  ];

  for (const result of results) {
    const entry = result.observation;
    const simulatedRounds = result.rounds
      ? formatSummary(result.rounds, entry.stochastic)
      : "—";
    const roundDifference =
      result.rounds && entry.game.rounds !== undefined
        ? formatSigned(result.rounds.mean - entry.game.rounds)
        : "—";
    lines.push(
      `| ${entry.section} | ${entry.caseLabel.replaceAll("|", "\\|")} | ${winnerLabel(entry.game.winner)} | ${gameSurvivors(
        entry
      )} | ${simulatedWinner(result)} | ${simulatedSurvivors(result)} | ${survivorDifference(result)} | ${
        entry.game.rounds === undefined ? "—" : formatNumber(entry.game.rounds)
      } | ${simulatedRounds} | ${roundDifference} | ${statusAndNotes(result)} |`
    );
  }

  return `${lines.join("\n")}\n`;
}

interface CliOptions extends GatotEvidenceRunOptions {
  help: boolean;
}

function parseCliArgs(args: string[]): CliOptions {
  const options: CliOptions = { help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--replicates") {
      options.replicates = Number(args[++index]);
    } else if (arg.startsWith("--replicates=")) {
      options.replicates = Number(arg.slice("--replicates=".length));
    } else if (arg === "--matching") {
      options.matching = args[++index];
    } else if (arg.startsWith("--matching=")) {
      options.matching = arg.slice("--matching=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function usage(): string {
  return [
    "Usage: npm run check:gatot-evidence -- [--replicates N] [--matching TEXT]",
    "",
    `Stochastic observations use ${DEFAULT_REPLICATES} replicates by default.`,
    "Each case has a stable base seed; replicate i uses the simulator's documented '<seed>#<i>' derivation.",
    "Deterministic observations always run once. Matching filters by id, section, or case label."
  ].join("\n");
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  process.stdout.write(renderGatotEvidenceMarkdown(runGatotEvidence(options)));
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (invokedPath === import.meta.url) {
  await main();
}
