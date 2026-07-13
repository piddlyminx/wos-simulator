import type { DamageKind } from "./types";

export type BucketRole = "attacker" | "defender";
export type BucketValueType = "raw" | "pct";
export type BucketUpdate = "assign_factor" | "add_pct_factor" | "multiply_pct_factor";
export type BucketPlacement = "numerator" | "denominator";
type BucketFamily = "troops" | "player" | "passive" | "active" | "type" | "source";

interface BucketSpec {
  path: string;
  family: BucketFamily;
  role: BucketRole;
  valueType: BucketValueType;
  update: BucketUpdate;
  placement: BucketPlacement;
  appliesTo?: DamageKind;
}

// Closed pools: every contributor is known while preparing the battle, so these
// buckets are aggregated once into StaticDamageProfile factors.
export const STATIC_BUCKETS = [
  { path: "troops.baseAttack", family: "troops", role: "attacker", valueType: "raw", update: "assign_factor", placement: "numerator" },
  { path: "troops.baseLethality", family: "troops", role: "attacker", valueType: "raw", update: "assign_factor", placement: "numerator" },
  { path: "troops.baseHealth", family: "troops", role: "defender", valueType: "raw", update: "assign_factor", placement: "denominator" },
  { path: "troops.baseDefense", family: "troops", role: "defender", valueType: "raw", update: "assign_factor", placement: "denominator" },
  { path: "player.attack", family: "player", role: "attacker", valueType: "pct", update: "add_pct_factor", placement: "numerator" },
  { path: "player.lethality", family: "player", role: "attacker", valueType: "pct", update: "add_pct_factor", placement: "numerator" },
  { path: "player.health", family: "player", role: "defender", valueType: "pct", update: "add_pct_factor", placement: "denominator" },
  { path: "player.defense", family: "player", role: "defender", valueType: "pct", update: "add_pct_factor", placement: "denominator" },
  { path: "passive.attack.up", family: "passive", role: "attacker", valueType: "pct", update: "add_pct_factor", placement: "numerator" },
  { path: "passive.attack.down", family: "passive", role: "attacker", valueType: "pct", update: "add_pct_factor", placement: "denominator" },
  { path: "passive.lethality.up", family: "passive", role: "attacker", valueType: "pct", update: "add_pct_factor", placement: "numerator" },
  { path: "passive.lethality.down", family: "passive", role: "attacker", valueType: "pct", update: "add_pct_factor", placement: "denominator" },
  { path: "passive.health.up", family: "passive", role: "defender", valueType: "pct", update: "add_pct_factor", placement: "denominator" },
  { path: "passive.health.down", family: "passive", role: "defender", valueType: "pct", update: "add_pct_factor", placement: "numerator" },
  { path: "passive.defense.up", family: "passive", role: "defender", valueType: "pct", update: "add_pct_factor", placement: "denominator" },
  { path: "passive.defense.down", family: "passive", role: "defender", valueType: "pct", update: "add_pct_factor", placement: "numerator" }
] as const satisfies readonly BucketSpec[];

// Open pools: runtime effects can feed these buckets while the battle is running.
// Array order is the numeric slot order used by the fast damage scratch.
export const DYNAMIC_BUCKETS = [
  { path: "active.hero.attack.down", family: "active", role: "attacker", valueType: "pct", update: "add_pct_factor", placement: "denominator" },
  { path: "active.hero.attack.up", family: "active", role: "attacker", valueType: "pct", update: "add_pct_factor", placement: "numerator" },
  { path: "active.hero.damage.down", family: "active", role: "attacker", valueType: "pct", update: "add_pct_factor", placement: "denominator" },
  { path: "active.hero.damage.up", family: "active", role: "attacker", valueType: "pct", update: "add_pct_factor", placement: "numerator" },
  { path: "active.hero.damageTaken.down", family: "active", role: "defender", valueType: "pct", update: "add_pct_factor", placement: "denominator" },
  { path: "active.hero.damageTaken.up", family: "active", role: "defender", valueType: "pct", update: "add_pct_factor", placement: "numerator" },
  { path: "active.hero.defense.down", family: "active", role: "defender", valueType: "pct", update: "add_pct_factor", placement: "numerator" },
  { path: "active.hero.defense.up", family: "active", role: "defender", valueType: "pct", update: "add_pct_factor", placement: "denominator" },
  { path: "active.hero.health.down", family: "active", role: "defender", valueType: "pct", update: "add_pct_factor", placement: "numerator" },
  { path: "active.hero.health.up", family: "active", role: "defender", valueType: "pct", update: "add_pct_factor", placement: "denominator" },
  { path: "active.hero.lethality.down", family: "active", role: "attacker", valueType: "pct", update: "add_pct_factor", placement: "denominator" },
  { path: "active.hero.lethality.up", family: "active", role: "attacker", valueType: "pct", update: "add_pct_factor", placement: "numerator" },
  { path: "active.troop.attack.down", family: "active", role: "attacker", valueType: "pct", update: "add_pct_factor", placement: "denominator" },
  { path: "active.troop.attack.up", family: "active", role: "attacker", valueType: "pct", update: "add_pct_factor", placement: "numerator" },
  { path: "active.troop.damage.down", family: "active", role: "attacker", valueType: "pct", update: "add_pct_factor", placement: "denominator" },
  { path: "active.troop.damage.up", family: "active", role: "attacker", valueType: "pct", update: "add_pct_factor", placement: "numerator" },
  { path: "active.troop.damageTaken.down", family: "active", role: "defender", valueType: "pct", update: "add_pct_factor", placement: "denominator" },
  { path: "active.troop.damageTaken.up", family: "active", role: "defender", valueType: "pct", update: "add_pct_factor", placement: "numerator" },
  { path: "active.troop.defense.down", family: "active", role: "defender", valueType: "pct", update: "add_pct_factor", placement: "numerator" },
  { path: "active.troop.defense.up", family: "active", role: "defender", valueType: "pct", update: "add_pct_factor", placement: "denominator" },
  { path: "active.troop.health.down", family: "active", role: "defender", valueType: "pct", update: "add_pct_factor", placement: "numerator" },
  { path: "active.troop.health.up", family: "active", role: "defender", valueType: "pct", update: "add_pct_factor", placement: "denominator" },
  { path: "active.troop.lethality.down", family: "active", role: "attacker", valueType: "pct", update: "add_pct_factor", placement: "denominator" },
  { path: "active.troop.lethality.up", family: "active", role: "attacker", valueType: "pct", update: "add_pct_factor", placement: "numerator" },
  { path: "source.extraSkill", family: "source", role: "attacker", valueType: "raw", update: "assign_factor", placement: "numerator", appliesTo: "skill" },
  { path: "troops.count", family: "troops", role: "attacker", valueType: "raw", update: "assign_factor", placement: "numerator" },
  { path: "type.all.damage.down", family: "type", role: "attacker", valueType: "pct", update: "multiply_pct_factor", placement: "denominator" },
  { path: "type.all.damage.up", family: "type", role: "attacker", valueType: "pct", update: "multiply_pct_factor", placement: "numerator" },
  { path: "type.normal.damage.down", family: "type", role: "attacker", valueType: "pct", update: "add_pct_factor", placement: "denominator", appliesTo: "normal" },
  { path: "type.normal.damage.up", family: "type", role: "attacker", valueType: "pct", update: "add_pct_factor", placement: "numerator", appliesTo: "normal" },
  { path: "type.normal.damageTaken.down", family: "type", role: "defender", valueType: "pct", update: "add_pct_factor", placement: "denominator", appliesTo: "normal" },
  { path: "type.normal.damageTaken.up", family: "type", role: "defender", valueType: "pct", update: "add_pct_factor", placement: "numerator", appliesTo: "normal" },
  { path: "type.skill.damage.down", family: "type", role: "attacker", valueType: "pct", update: "add_pct_factor", placement: "denominator", appliesTo: "skill" },
  { path: "type.skill.damage.up", family: "type", role: "attacker", valueType: "pct", update: "add_pct_factor", placement: "numerator", appliesTo: "skill" },
  { path: "type.skill.damageTaken.down", family: "type", role: "defender", valueType: "pct", update: "add_pct_factor", placement: "denominator", appliesTo: "skill" },
  { path: "type.skill.damageTaken.up", family: "type", role: "defender", valueType: "pct", update: "add_pct_factor", placement: "numerator", appliesTo: "skill" }
] as const satisfies readonly BucketSpec[];

export type StaticBucketSpec = (typeof STATIC_BUCKETS)[number];
export type DynamicBucketSpec = (typeof DYNAMIC_BUCKETS)[number];
export type StaticDamageBucket = StaticBucketSpec["path"];
export type AtomicBucket = DynamicBucketSpec["path"];
export type BucketName = AtomicBucket;
export type StaticRawBucket = Extract<StaticBucketSpec, { valueType: "raw" }>["path"];
export type StaticPlayerBucket = Extract<StaticBucketSpec, { family: "player" }>["path"];
export type StaticPassiveBucket = Extract<StaticBucketSpec, { family: "passive" }>["path"];
export type BucketPath = StaticDamageBucket | AtomicBucket;

type BucketDefinitionFields = Omit<BucketSpec, "path">;
export type BucketDefinition =
  | (BucketDefinitionFields & { path: StaticDamageBucket; phase: "static" })
  | (BucketDefinitionFields & { path: AtomicBucket; phase: "dynamic" });

export const ATOMIC_BUCKETS = DYNAMIC_BUCKETS.map((bucket) => bucket.path) as AtomicBucket[];
export const DYNAMIC_EFFECT_BUCKETS = DYNAMIC_BUCKETS
  .filter((bucket) => bucket.family === "active" || bucket.family === "type")
  .map((bucket) => bucket.path) as AtomicBucket[];
export const STATIC_PASSIVE_BUCKETS = STATIC_BUCKETS
  .filter((bucket): bucket is Extract<StaticBucketSpec, { family: "passive" }> => bucket.family === "passive")
  .map((bucket) => bucket.path) as StaticPassiveBucket[];

const ALL_BUCKET_DEFINITIONS: BucketDefinition[] = [
  ...STATIC_BUCKETS.map((bucket) => ({ ...bucket, phase: "static" as const })),
  ...DYNAMIC_BUCKETS.map((bucket) => ({ ...bucket, phase: "dynamic" as const }))
];

export const BUCKET_DEFINITIONS = Object.fromEntries(
  ALL_BUCKET_DEFINITIONS.map((definition) => [definition.path, definition])
) as Record<BucketPath, BucketDefinition>;

export function bucketDefinition(path: string): BucketDefinition | undefined {
  return BUCKET_DEFINITIONS[path as BucketPath];
}
