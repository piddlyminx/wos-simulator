import { UNIT_TYPES } from "./types";
import type { StatBlock, TroopStatsCatalogue, TroopStatsRecord, UnitType } from "./types";
import { normalizeStatBlock, normalizeUnitType } from "./normalize";

type AttackHealth = Readonly<{
  Attack: number;
  Health: number;
}>;

// Validated FC0 anchors. Lancer values are the exact Infantry Attack/Health
// swap; Marksman anchors remain explicit because each type was rounded
// independently in the source data.
const INFANTRY_BASE_STATS: readonly AttackHealth[] = [
  { Attack: 63, Health: 189 },
  { Attack: 94, Health: 283 },
  { Attack: 132, Health: 397 },
  { Attack: 172, Health: 516 },
  { Attack: 206, Health: 619 },
  { Attack: 243, Health: 730 },
  { Attack: 287, Health: 862 },
  { Attack: 339, Health: 1017 },
  { Attack: 400, Health: 1200 },
  { Attack: 472, Health: 1416 }
];

const MARKSMAN_BASE_STATS: readonly AttackHealth[] = [
  { Attack: 252, Health: 47 },
  { Attack: 378, Health: 71 },
  { Attack: 529, Health: 99 },
  { Attack: 688, Health: 129 },
  { Attack: 825, Health: 155 },
  { Attack: 974, Health: 183 },
  { Attack: 1149, Health: 215 },
  { Attack: 1356, Health: 254 },
  { Attack: 1600, Health: 300 },
  { Attack: 1888, Health: 354 }
];

// T11 FC0 is the Labyrinth-only troop calibrated from observed battle reports.
// Player T11 troops begin at FC5; FC5-FC10 use the same FC continuation model.
const T11_INFANTRY_BASE: AttackHealth = { Attack: 551, Health: 1653 };

export const BEAR_TROOP_ID = "bear_infantry";
const MAX_TIER = 11;
const MAX_FIRE_CRYSTAL_LEVEL = 10;
const ALL_FIRE_CRYSTAL_LEVELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
const T11_FIRE_CRYSTAL_LEVELS = [0, 5, 6, 7, 8, 9, 10] as const;
const generatedRecords = new Map<string, TroopStatsRecord>();
let generatedCatalogue: TroopStatsCatalogue | undefined;

interface TroopStatsRecordInput {
  id: string;
  type: UnitType | string;
  tier: number;
  fc?: number;
  stats: StatBlock | Record<string, unknown>;
}

export function createTroopStatsRecord(input: TroopStatsRecordInput): TroopStatsRecord {
  return Object.freeze({
    id: input.id,
    type: normalizeUnitType(input.type),
    tier: input.tier,
    fc: input.fc ?? 0,
    stats: Object.freeze(normalizeStatBlock(input.stats as Record<string, unknown>))
  });
}

export function generateTroopStats(type: UnitType, tier: number, fc = 0): TroopStatsRecord {
  assertIntegerInRange("tier", tier, 1, MAX_TIER);
  assertIntegerInRange("Fire Crystal level", fc, 0, MAX_FIRE_CRYSTAL_LEVEL);

  const id = `${type}_t${tier}${fc === 0 ? "" : `_fc${fc}`}`;
  const cached = generatedRecords.get(id);
  if (cached) return cached;

  const base = baseStats(type, tier);
  const multiplier = fireCrystalMultiplier(fc);
  const record = createTroopStatsRecord({
    id,
    type,
    tier,
    fc,
    stats: {
      attack: Math.round(base.Attack * multiplier),
      defense: 10,
      lethality: 10,
      health: Math.round(base.Health * multiplier)
    }
  });
  generatedRecords.set(id, record);
  return record;
}

export function generateTroopStatsCatalogue(): TroopStatsCatalogue {
  if (generatedCatalogue) return generatedCatalogue;

  const catalogue: TroopStatsCatalogue = {};
  for (const type of UNIT_TYPES) {
    for (let tier = 1; tier <= MAX_TIER; tier += 1) {
      for (const fc of supportedFireCrystalLevels(tier)) {
        const troop = generateTroopStats(type, tier, fc);
        catalogue[troop.id] = troop;
      }
    }
  }
  catalogue[BEAR_TROOP_ID] = createTroopStatsRecord({
    id: BEAR_TROOP_ID,
    type: "infantry",
    tier: 1,
    stats: {
      attack: 0,
      defense: 250 / 3,
      lethality: 0,
      health: 10
    }
  });
  generatedCatalogue = Object.freeze(catalogue);
  return generatedCatalogue;
}

export function fireCrystalMultiplier(fc: number): number {
  assertIntegerInRange("Fire Crystal level", fc, 0, MAX_FIRE_CRYSTAL_LEVEL);
  return fc === 0 ? 1 : 1.04 * 1.05 ** (fc - 1);
}

function baseStats(type: UnitType, tier: number): AttackHealth {
  if (tier === 11) {
    if (type === "infantry") return T11_INFANTRY_BASE;
    if (type === "lancer") {
      return {
        Attack: T11_INFANTRY_BASE.Health,
        Health: T11_INFANTRY_BASE.Attack
      };
    }
    return {
      Attack: Math.round(T11_INFANTRY_BASE.Health * 4 / 3),
      Health: Math.round(T11_INFANTRY_BASE.Attack * 3 / 4)
    };
  }

  const sourceTier = Math.min(tier, 10);
  const infantry = INFANTRY_BASE_STATS[sourceTier - 1];

  if (type === "infantry") {
    return infantry;
  }
  if (type === "lancer") {
    return { Attack: infantry.Health, Health: infantry.Attack };
  }
  return MARKSMAN_BASE_STATS[sourceTier - 1];
}

function supportedFireCrystalLevels(tier: number): readonly number[] {
  return tier <= 10 ? ALL_FIRE_CRYSTAL_LEVELS : T11_FIRE_CRYSTAL_LEVELS;
}

function assertIntegerInRange(label: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} must be an integer from ${min} to ${max}; received ${value}`);
  }
}
