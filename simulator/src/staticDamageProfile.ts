import type { ActiveEffect, DamageBucketTrace, ResolvedFighter, SideId, StatBlock, UnitType } from "./types";
import { UNIT_TYPES, unitMaskHas } from "./types";
import {
  BUCKET_DEFINITIONS,
  isPassiveBucket,
  passiveBucketRole,
  type BucketRole,
  type PassiveBucket,
  type StaticPlayerBucket
} from "./damageBuckets";
import {
  applyStaticDamageBucketValue,
  createStaticDamageBucketFactors,
  evaluateDamageExpression,
  staticDamageBucketSet,
  type StaticDamageBucketMatrix,
  type StaticDamageBucketFactors,
  type StaticDamageProfile,
  type StaticDamageProfileEntry
} from "./damage";

export type { StaticDamageBucketMatrix, StaticDamageProfile } from "./damage";

/** A player stat bonus produced a non-positive factor while building the numeric profile. */
export class DamageAggregationError extends Error {
  readonly groupId: string;
  readonly netPct: number;
  readonly factor: number;
  readonly contributors: DamageBucketTrace["contributors"];

  constructor(args: { groupId: string; netPct: number; factor: number; contributors: DamageBucketTrace["contributors"] }) {
    super(`Non-positive damage aggregation factor for ${args.groupId}: factor=${args.factor} netPct=${args.netPct}`);
    this.name = "DamageAggregationError";
    this.groupId = args.groupId;
    this.netPct = args.netPct;
    this.factor = args.factor;
    this.contributors = args.contributors;
  }
}

/**
 * One passive effect selected to contribute to a static bucket for a concrete side and unit.
 * Selection (including same-effect max stacking) lives here so the numeric profile and any
 * recorder-side description of it can never disagree.
 */
export interface PassiveContribution {
  role: BucketRole;
  side: SideId;
  unit: UnitType;
  bucket: PassiveBucket;
  effect: ActiveEffect;
  valuePct: number;
}

export function buildStaticDamageBucketFactors(
  fighters: Record<SideId, ResolvedFighter>,
  activeEffects: ActiveEffect[]
): StaticDamageBucketMatrix {
  const factors: Record<SideId, Record<UnitType, StaticDamageBucketFactors>> = {
    attacker: buildSideFactors(fighters.attacker),
    defender: buildSideFactors(fighters.defender)
  };
  for (const contribution of selectPassiveContributions(activeEffects)) {
    applyStaticDamageBucketValue(
      factors[contribution.side][contribution.unit],
      contribution.bucket,
      contribution.valuePct
    );
  }
  return factors;
}

export function buildStaticDamageProfile(fighters: Record<SideId, ResolvedFighter>, activeEffects: ActiveEffect[]): StaticDamageProfile {
  const factors = buildStaticDamageBucketFactors(fighters, activeEffects);
  return {
    attacker: buildProfileSide(factors.attacker),
    defender: buildProfileSide(factors.defender)
  };
}

function buildProfileSide(factors: Record<UnitType, StaticDamageBucketFactors>): Record<UnitType, StaticDamageProfileEntry> {
  return Object.fromEntries(
    UNIT_TYPES.map((unit) => [unit, {
      dealerFactor: evaluateDamageExpression(staticDamageBucketSet(factors[unit], "dealer")),
      takerFactor: evaluateDamageExpression(staticDamageBucketSet(factors[unit], "taker"))
    }])
  ) as Record<UnitType, StaticDamageProfileEntry>;
}

function applyPlayerBucket(factors: StaticDamageBucketFactors, bucket: StaticPlayerBucket, totalPct: number): void {
  const factor = applyStaticDamageBucketValue(factors, bucket, totalPct);
  if (factor <= 0) {
    const stat = bucket.slice("player.".length);
    throw new DamageAggregationError({
      groupId: `player.${BUCKET_DEFINITIONS[bucket].role}.${stat}`,
      netPct: totalPct,
      factor,
      contributors: [{ effectId: `input:${stat}`, source: "input_stats", valuePct: totalPct, bucket }]
    });
  }
}

export function selectPassiveContributions(activeEffects: ActiveEffect[]): PassiveContribution[] {
  const contributions: PassiveContribution[] = [];
  for (const effect of activeEffects) {
    const bucket = effect.intent.type;
    if (!isPassiveBucket(bucket)) continue;
    const role = passiveBucketRole(bucket)!;
    const side = effect.appliesTo.side;
    for (const unit of UNIT_TYPES) {
      if (!unitMaskHas(effect.appliesTo.units, unit)) continue;
      const contribution: PassiveContribution = { role, side, unit, bucket, effect, valuePct: effect.getCurrentValuePct(1) };
      contributions.push(contribution);
    }
  }
  return contributions;
}

function buildSideFactors(fighter: ResolvedFighter): Record<UnitType, StaticDamageBucketFactors> {
  return Object.fromEntries(
    UNIT_TYPES.map((unit) => {
      const factors = createStaticDamageBucketFactors();
      const stats = unitBaseStats(fighter, unit);
      const bonuses = unitPlayerBonuses(fighter, unit);
      applyStaticDamageBucketValue(factors, "troops.baseAttack", stats.attack);
      applyStaticDamageBucketValue(factors, "troops.baseLethality", stats.lethality);
      applyStaticDamageBucketValue(factors, "troops.baseHealth", stats.health);
      applyStaticDamageBucketValue(factors, "troops.baseDefense", stats.defense);
      applyPlayerBucket(factors, "player.attack", bonuses.attack);
      applyPlayerBucket(factors, "player.lethality", bonuses.lethality);
      applyPlayerBucket(factors, "player.health", bonuses.health);
      applyPlayerBucket(factors, "player.defense", bonuses.defense);
      return [unit, factors];
    })
  ) as Record<UnitType, StaticDamageBucketFactors>;
}

/** Base stats a static entry reads for a unit; units with no troops resolve to neutral 1s. */
export function unitBaseStats(fighter: ResolvedFighter, unit: UnitType): StatBlock {
  return fighter.troopDetails[unit]?.stats ?? FALLBACK_STATS;
}

/** Player stat bonuses a static entry reads for a unit; missing units contribute nothing. */
export function unitPlayerBonuses(fighter: ResolvedFighter, unit: UnitType): StatBlock {
  return fighter.statBonuses[unit] ?? EMPTY_STATS;
}

const FALLBACK_STATS: StatBlock = { attack: 1, defense: 1, lethality: 1, health: 1 };
const EMPTY_STATS: StatBlock = { attack: 0, defense: 0, lethality: 0, health: 0 };
