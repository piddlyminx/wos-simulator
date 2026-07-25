import { UNIT_TYPES } from "./types";
import type { TroopStatsCatalogue, TroopStatsRecord, UnitType } from "./types";

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

const MAX_TIER = 11;
const MAX_FIRE_CRYSTAL_LEVEL = 10;
// T11 and FC6+ are the low-complexity continuations inferred from the
// validated T1-T10 / FC0-FC5 surface.
const T11_TIER_MULTIPLIER = 1.18;

export function generateTroopStats(type: UnitType, tier: number, fc = 0): TroopStatsRecord {
  assertIntegerInRange("tier", tier, 1, MAX_TIER);
  assertIntegerInRange("Fire Crystal level", fc, 0, MAX_FIRE_CRYSTAL_LEVEL);

  const base = baseStats(type, tier);
  const multiplier = fireCrystalMultiplier(fc);
  const id = `${type}_t${tier}${fc === 0 ? "" : `_fc${fc}`}`;

  return {
    id,
    type,
    tier,
    fc,
    stats: {
      Attack: Math.round(base.Attack * multiplier),
      Defense: 10,
      Lethality: 10,
      Health: Math.round(base.Health * multiplier)
    }
  };
}

export function generateTroopStatsCatalogue(): TroopStatsCatalogue {
  const catalogue: TroopStatsCatalogue = {};
  for (const type of UNIT_TYPES) {
    for (let tier = 1; tier <= MAX_TIER; tier += 1) {
      for (const fc of supportedFireCrystalLevels(tier)) {
        const troop = generateTroopStats(type, tier, fc);
        catalogue[troop.id] = troop;
      }
    }
  }
  return catalogue;
}

export function fireCrystalMultiplier(fc: number): number {
  assertIntegerInRange("Fire Crystal level", fc, 0, MAX_FIRE_CRYSTAL_LEVEL);
  return fc === 0 ? 1 : 1.04 * 1.05 ** (fc - 1);
}

function baseStats(type: UnitType, tier: number): AttackHealth {
  const sourceTier = Math.min(tier, 10);
  const infantry = INFANTRY_BASE_STATS[sourceTier - 1];
  let base: AttackHealth;

  if (type === "infantry") {
    base = infantry;
  } else if (type === "lancer") {
    base = { Attack: infantry.Health, Health: infantry.Attack };
  } else {
    base = MARKSMAN_BASE_STATS[sourceTier - 1];
  }

  if (tier <= 10) return base;
  return {
    Attack: Math.round(base.Attack * T11_TIER_MULTIPLIER),
    Health: Math.round(base.Health * T11_TIER_MULTIPLIER)
  };
}

function supportedFireCrystalLevels(tier: number): readonly number[] {
  if (tier <= 9) return [0, 1, 2, 3, 4, 5];
  if (tier === 10) return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  return [0, 5, 6, 7, 8, 9, 10];
}

function assertIntegerInRange(label: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} must be an integer from ${min} to ${max}; received ${value}`);
  }
}
