export interface SyntheticReportSideInput {
  name: string;
  coordinates?: string;
  initialTroops: number;
  survivors: number;
  powerChange?: number;
  avatarDataUrl?: string;
}

export interface SyntheticBattleOverviewInput {
  winner: "left" | "right" | "draw";
  timestamp: string;
  seed: string | number;
  left: SyntheticReportSideInput;
  right: SyntheticReportSideInput;
}

export interface SyntheticReportSide extends SyntheticReportSideInput {
  losses: 0;
  injured: number;
  lightlyInjured: number;
}

export interface SyntheticBattleOverviewModel {
  synthetic: true;
  winner: "left" | "right" | "draw";
  timestamp: string;
  seed: string | number;
  left: SyntheticReportSide;
  right: SyntheticReportSide;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function buildSide(side: SyntheticReportSideInput, label: string): SyntheticReportSide {
  const initialTroops = nonNegativeInteger(side.initialTroops, `${label}.initialTroops`);
  const survivors = nonNegativeInteger(side.survivors, `${label}.survivors`);
  if (survivors > initialTroops) {
    throw new Error(`${label}.survivors cannot exceed initial troops`);
  }

  const casualties = initialTroops - survivors;
  const lightlyInjured = Math.floor(casualties * 0.65);
  const injured = casualties - lightlyInjured;

  return {
    ...side,
    initialTroops,
    survivors,
    losses: 0,
    injured,
    lightlyInjured,
  };
}

export function buildSyntheticBattleOverview(
  input: SyntheticBattleOverviewInput,
): SyntheticBattleOverviewModel {
  return {
    synthetic: true,
    winner: input.winner,
    timestamp: input.timestamp,
    seed: input.seed,
    left: buildSide(input.left, "left"),
    right: buildSide(input.right, "right"),
  };
}
