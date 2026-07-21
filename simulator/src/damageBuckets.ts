import type { DamageKind } from "./types";

export type BucketJobSide = "dealer" | "taker";
export type BucketUpdate = "assign_factor" | "add_pct_factor" | "multiply_pct_factor" | "add_raw";
export type BucketPlacement = "numerator" | "denominator" | "post_subtract";

export interface BucketSpec {
  name: string;
  jobSide: BucketJobSide;
  update: BucketUpdate;
  placement: BucketPlacement;
  damageKind?: DamageKind;
  /** This bucket may be named by an EffectIntentDefinition. */
  effectBucket?: true;
}

// Closed pools: every contributor is known while preparing the battle, so these
// buckets are aggregated once into StaticDamageProfile factors.
export const STATIC_BUCKETS = [
  { name: "troops.baseAttack", jobSide: "dealer", update: "assign_factor", placement: "numerator" },
  { name: "troops.baseLethality", jobSide: "dealer", update: "assign_factor", placement: "numerator" },
  { name: "troops.baseHealth", jobSide: "taker", update: "assign_factor", placement: "denominator" },
  { name: "troops.baseDefense", jobSide: "taker", update: "assign_factor", placement: "denominator" },
  { name: "player.attack", jobSide: "dealer", update: "add_pct_factor", placement: "numerator" },
  { name: "player.lethality", jobSide: "dealer", update: "add_pct_factor", placement: "numerator" },
  { name: "player.health", jobSide: "taker", update: "add_pct_factor", placement: "denominator" },
  { name: "player.defense", jobSide: "taker", update: "add_pct_factor", placement: "denominator" },
  { name: "passive.attack.up", jobSide: "dealer", update: "add_pct_factor", placement: "numerator", effectBucket: true },
  { name: "passive.attack.down", jobSide: "dealer", update: "add_pct_factor", placement: "denominator", effectBucket: true },
  { name: "passive.lethality.up", jobSide: "dealer", update: "add_pct_factor", placement: "numerator", effectBucket: true },
  { name: "passive.lethality.down", jobSide: "dealer", update: "add_pct_factor", placement: "denominator", effectBucket: true },
  { name: "passive.health.up", jobSide: "taker", update: "add_pct_factor", placement: "denominator", effectBucket: true },
  { name: "passive.health.down", jobSide: "taker", update: "add_pct_factor", placement: "numerator", effectBucket: true },
  { name: "passive.defense.up", jobSide: "taker", update: "add_pct_factor", placement: "denominator", effectBucket: true },
  { name: "passive.defense.down", jobSide: "taker", update: "add_pct_factor", placement: "numerator", effectBucket: true }
] as const satisfies readonly BucketSpec[];

// Open pools: runtime effects can feed these buckets while the battle is running.
// Array order is the numeric slot order used by the fast damage scratch.
export const DYNAMIC_BUCKETS = [
  { name: "active.hero.attack.down", jobSide: "dealer", update: "add_pct_factor", placement: "denominator", effectBucket: true },
  { name: "active.hero.attack.up", jobSide: "dealer", update: "add_pct_factor", placement: "numerator", effectBucket: true },
  { name: "active.hero.damage.down", jobSide: "dealer", update: "add_pct_factor", placement: "denominator", effectBucket: true },
  { name: "active.hero.damage.up", jobSide: "dealer", update: "add_pct_factor", placement: "numerator", effectBucket: true },
  { name: "active.hero.damageTaken.down", jobSide: "taker", update: "add_pct_factor", placement: "denominator", effectBucket: true },
  { name: "active.hero.damageTaken.up", jobSide: "taker", update: "add_pct_factor", placement: "numerator", effectBucket: true },
  { name: "active.hero.defense.down", jobSide: "taker", update: "add_pct_factor", placement: "numerator", effectBucket: true },
  { name: "active.hero.defense.up", jobSide: "taker", update: "add_pct_factor", placement: "denominator", effectBucket: true },
  { name: "active.hero.health.down", jobSide: "taker", update: "add_pct_factor", placement: "numerator", effectBucket: true },
  { name: "active.hero.health.up", jobSide: "taker", update: "add_pct_factor", placement: "denominator", effectBucket: true },
  { name: "active.hero.lethality.down", jobSide: "dealer", update: "add_pct_factor", placement: "denominator", effectBucket: true },
  { name: "active.hero.lethality.up", jobSide: "dealer", update: "add_pct_factor", placement: "numerator", effectBucket: true },
  { name: "active.hero.shield", jobSide: "taker", update: "add_raw", placement: "post_subtract", effectBucket: true },
  { name: "active.troop.attack.down", jobSide: "dealer", update: "add_pct_factor", placement: "denominator", effectBucket: true },
  { name: "active.troop.attack.up", jobSide: "dealer", update: "add_pct_factor", placement: "numerator", effectBucket: true },
  { name: "active.troop.damage.down", jobSide: "dealer", update: "add_pct_factor", placement: "denominator", effectBucket: true },
  { name: "active.troop.damage.up", jobSide: "dealer", update: "add_pct_factor", placement: "numerator", effectBucket: true },
  { name: "active.troop.damageTaken.down", jobSide: "taker", update: "add_pct_factor", placement: "denominator", effectBucket: true },
  { name: "active.troop.damageTaken.up", jobSide: "taker", update: "add_pct_factor", placement: "numerator", effectBucket: true },
  { name: "active.troop.defense.down", jobSide: "taker", update: "add_pct_factor", placement: "numerator", effectBucket: true },
  { name: "active.troop.defense.up", jobSide: "taker", update: "add_pct_factor", placement: "denominator", effectBucket: true },
  { name: "active.troop.health.down", jobSide: "taker", update: "add_pct_factor", placement: "numerator", effectBucket: true },
  { name: "active.troop.health.up", jobSide: "taker", update: "add_pct_factor", placement: "denominator", effectBucket: true },
  { name: "active.troop.lethality.down", jobSide: "dealer", update: "add_pct_factor", placement: "denominator", effectBucket: true },
  { name: "active.troop.lethality.up", jobSide: "dealer", update: "add_pct_factor", placement: "numerator", effectBucket: true },
  { name: "active.troop.shield", jobSide: "taker", update: "add_raw", placement: "post_subtract", effectBucket: true },
  { name: "source.extraSkill", jobSide: "dealer", update: "assign_factor", placement: "numerator", damageKind: "skill" },
  { name: "troops.count", jobSide: "dealer", update: "assign_factor", placement: "numerator" },
  { name: "type.all.damage.down", jobSide: "dealer", update: "multiply_pct_factor", placement: "denominator", effectBucket: true },
  { name: "type.all.damage.up", jobSide: "dealer", update: "multiply_pct_factor", placement: "numerator", effectBucket: true },
  { name: "type.normal.damage.down", jobSide: "dealer", update: "add_pct_factor", placement: "denominator", damageKind: "normal", effectBucket: true },
  { name: "type.normal.damage.up", jobSide: "dealer", update: "add_pct_factor", placement: "numerator", damageKind: "normal", effectBucket: true },
  { name: "type.normal.damageTaken.down", jobSide: "taker", update: "add_pct_factor", placement: "denominator", damageKind: "normal", effectBucket: true },
  { name: "type.normal.damageTaken.up", jobSide: "taker", update: "add_pct_factor", placement: "numerator", damageKind: "normal", effectBucket: true },
  { name: "type.skill.damage.down", jobSide: "dealer", update: "add_pct_factor", placement: "denominator", damageKind: "skill", effectBucket: true },
  { name: "type.skill.damage.up", jobSide: "dealer", update: "add_pct_factor", placement: "numerator", damageKind: "skill", effectBucket: true },
  { name: "type.skill.damageTaken.down", jobSide: "taker", update: "add_pct_factor", placement: "denominator", damageKind: "skill", effectBucket: true },
  { name: "type.skill.damageTaken.up", jobSide: "taker", update: "add_pct_factor", placement: "numerator", damageKind: "skill", effectBucket: true }
] as const satisfies readonly BucketSpec[];

export type StaticBucketSpec = (typeof STATIC_BUCKETS)[number] & BucketSpec;
export type DynamicBucketSpec = (typeof DYNAMIC_BUCKETS)[number] & BucketSpec;
export type StaticDamageBucket = StaticBucketSpec["name"];
export type DynamicDamageBucket = DynamicBucketSpec["name"];
export type StaticRawBucket = Extract<StaticBucketSpec, { update: "assign_factor" }>["name"];
export type PassiveBucket = Extract<StaticBucketSpec, { effectBucket: true }>["name"];
export type StaticPlayerBucket = Exclude<StaticDamageBucket, StaticRawBucket | PassiveBucket>;
export type DynamicEffectBucket = Extract<DynamicBucketSpec, { effectBucket: true }>["name"];

export const STATIC_BUCKET_INDEX = Object.fromEntries(
  STATIC_BUCKETS.map((bucket, index) => [bucket.name, index])
) as Readonly<Record<StaticDamageBucket, number>>;
export const DYNAMIC_BUCKET_INDEX = Object.fromEntries(
  DYNAMIC_BUCKETS.map((bucket, index) => [bucket.name, index])
) as Readonly<Record<DynamicDamageBucket, number>>;

export const STATIC_EFFECT_BUCKETS = STATIC_BUCKETS
  .filter((bucket): bucket is Extract<StaticBucketSpec, { effectBucket: true }> => "effectBucket" in bucket)
  .map((bucket) => bucket.name) as PassiveBucket[];
export const DYNAMIC_EFFECT_BUCKETS = DYNAMIC_BUCKETS
  .filter((bucket): bucket is Extract<DynamicBucketSpec, { effectBucket: true }> => "effectBucket" in bucket)
  .map((bucket) => bucket.name) as DynamicEffectBucket[];

export function staticBucketDefinition(name: string): StaticBucketSpec | undefined {
  const index = STATIC_BUCKET_INDEX[name as StaticDamageBucket];
  return index === undefined ? undefined : STATIC_BUCKETS[index];
}

export function dynamicBucketDefinition(name: string): DynamicBucketSpec | undefined {
  const index = DYNAMIC_BUCKET_INDEX[name as DynamicDamageBucket];
  return index === undefined ? undefined : DYNAMIC_BUCKETS[index];
}

export function isPassiveBucket(name: string): name is PassiveBucket {
  return staticBucketDefinition(name)?.effectBucket === true;
}

// Bucket updates encode both their input representation and their aggregation rule.
export function rawBucketFactor(raw: number): number {
  return Math.max(0, raw);
}

export function pctBucketDelta(totalPct: number): number {
  return totalPct / 100;
}

export function pctBucketFactor(totalPct: number): number {
  return 1 + pctBucketDelta(totalPct);
}

export function bucketNeutralValue(update: BucketUpdate): number {
  return update === "add_raw" ? 0 : 1;
}
