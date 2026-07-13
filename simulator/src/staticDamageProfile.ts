import type { ActiveEffect, DamageBucketTrace, EffectIntentDefinition, ResolvedFighter, SideId, SkillFile, StatBlock, UnitType } from "./types";
import { UNIT_TYPES, unitMaskHas } from "./types";
import {
  BUCKET_DEFINITIONS,
  STATIC_BUCKETS,
  type BucketPlacement,
  type BucketRole,
  type BucketValueType,
  type StaticDamageBucket,
  type StaticPassiveBucket,
  type StaticPlayerBucket,
  type StaticRawBucket
} from "./damageBuckets";
import { sourceLabel } from "./effects";

export interface StaticDamageProfileTerm {
  raw?: number;
  totalPct?: number;
  contributors: DamageBucketTrace["contributors"];
}

export interface StaticDamageProfileEntry {
  factor: number;
  playerFactorsValid: boolean;
  buckets: Partial<Record<StaticDamageBucket, StaticDamageProfileTerm>>;
}

export interface StaticDamageProfile {
  offense: Record<SideId, Record<UnitType, StaticDamageProfileEntry>>;
  defense: Record<SideId, Record<UnitType, StaticDamageProfileEntry>>;
}

interface PassiveCandidate {
  effect: ActiveEffect;
  bucket: StaticPassiveBucket;
  valuePct: number;
}

interface PassiveCandidateGroup {
  selected: PassiveCandidate;
  candidates: PassiveCandidate[];
  entry: StaticDamageProfileEntry;
}

export function buildStaticDamageProfile(fighters: Record<SideId, ResolvedFighter>, activeEffects: ActiveEffect[]): StaticDamageProfile {
  const profile: StaticDamageProfile = {
    offense: {
      attacker: buildSideEntries(fighters.attacker, "offense"),
      defender: buildSideEntries(fighters.defender, "offense")
    },
    defense: {
      attacker: buildSideEntries(fighters.attacker, "defense"),
      defender: buildSideEntries(fighters.defender, "defense")
    }
  };

  applyStaticPassives(profile, activeEffects);
  recomputeFactors(profile);
  return profile;
}

export function assertStaticPassiveEffectDefinition(
  trigger: SkillFile["skills"][string]["trigger"],
  effect: EffectIntentDefinition,
  file: string,
  skillId: string,
  effectId: string
): void {
  if (!isPassiveBucket(effect.type)) return;

  const path = `${file}:${skillId}.${effectId}`;
  if (trigger.type !== "battle_start") {
    throw new Error(`passive effect ${effect.type} must use battle_start trigger at ${path}`);
  }
  if (effect.value_evolution !== undefined) {
    throw new Error(`passive effect ${effect.type} cannot define value_evolution at ${path}; passive effects must be static`);
  }

  const duration = effect.duration;
  if (duration === undefined) return;
  if (duration.turns !== undefined || duration.attacks !== undefined) {
    throw new Error(`passive effect ${effect.type} must use battle duration at ${path}`);
  }
}

export function isStaticProfileBucket(bucket: string): bucket is StaticDamageBucket {
  return BUCKET_DEFINITIONS[bucket as StaticDamageBucket]?.phase === "static";
}

export function isPassiveBucket(bucket: string): bucket is StaticPassiveBucket {
  const definition = BUCKET_DEFINITIONS[bucket as StaticPassiveBucket];
  return definition?.phase === "static" && definition.family === "passive";
}

export function staticPassiveBucketRole(bucket: string): BucketRole | undefined {
  return isPassiveBucket(bucket) ? BUCKET_DEFINITIONS[bucket].role : undefined;
}

function buildSideEntries(fighter: ResolvedFighter, role: "offense" | "defense"): Record<UnitType, StaticDamageProfileEntry> {
  return Object.fromEntries(UNIT_TYPES.map((unit) => [unit, buildEntry(fighter, unit, role)])) as Record<UnitType, StaticDamageProfileEntry>;
}

function buildEntry(fighter: ResolvedFighter, unit: UnitType, role: "offense" | "defense"): StaticDamageProfileEntry {
  const stats = fighter.troopDetails[unit]?.stats ?? fallbackStats();
  const bonuses = fighter.statBonuses[unit] ?? emptyStats();
  const buckets: StaticDamageProfileEntry["buckets"] = {};
  if (role === "offense") {
    setRaw(buckets, "troops.baseAttack", stats.attack);
    setRaw(buckets, "troops.baseLethality", stats.lethality);
    setPct(buckets, "player.attack", bonuses.attack, [{ effectId: "input:attack", source: "input_stats", valuePct: bonuses.attack, bucket: "player.attack" }]);
    setPct(buckets, "player.lethality", bonuses.lethality, [
      { effectId: "input:lethality", source: "input_stats", valuePct: bonuses.lethality, bucket: "player.lethality" }
    ]);
  } else {
    setRaw(buckets, "troops.baseHealth", stats.health);
    setRaw(buckets, "troops.baseDefense", stats.defense);
    setPct(buckets, "player.health", bonuses.health, [{ effectId: "input:health", source: "input_stats", valuePct: bonuses.health, bucket: "player.health" }]);
    setPct(buckets, "player.defense", bonuses.defense, [
      { effectId: "input:defense", source: "input_stats", valuePct: bonuses.defense, bucket: "player.defense" }
    ]);
  }
  return { factor: 1, playerFactorsValid: true, buckets };
}

function applyStaticPassives(profile: StaticDamageProfile, activeEffects: ActiveEffect[]): void {
  const groups = new Map<string, PassiveCandidateGroup>();
  for (const effect of activeEffects) {
    const bucket = effect.intent.type;
    if (!isPassiveBucket(bucket)) continue;
    const role = staticPassiveBucketRole(bucket)!;
    const targetEntries = role === "attacker" ? profile.offense[effect.appliesTo.side] : profile.defense[effect.appliesTo.side];
    for (const unit of UNIT_TYPES) {
      if (!unitMaskHas(effect.appliesTo.units, unit)) continue;
      const candidate: PassiveCandidate = { effect, bucket, valuePct: effect.getCurrentValuePct(1) };
      if (effect.sameEffectStacking === "max" && effect.stackingKey) {
        const key = `${role}:${effect.appliesTo.side}:${unit}:${bucket}:${effect.stackingKey}`;
        const group = groups.get(key);
        if (group) {
          group.candidates.push(candidate);
          if (candidate.valuePct > group.selected.valuePct) group.selected = candidate;
        } else {
          groups.set(key, { selected: candidate, candidates: [candidate], entry: targetEntries[unit] });
        }
      } else {
        addPassiveCandidate(targetEntries[unit], candidate);
      }
    }
  }
  for (const group of groups.values()) {
    addPassiveCandidate(group.entry, group.selected);
  }
}

function addPassiveCandidate(entry: StaticDamageProfileEntry, candidate: PassiveCandidate): void {
  addPct(entry.buckets, candidate.bucket, candidate.valuePct, {
    effectId: candidate.effect.source.effectId ?? candidate.effect.id,
    source: sourceLabel(candidate.effect),
    sourceSide: candidate.effect.ownerSide,
    valuePct: candidate.valuePct,
    bucket: candidate.bucket,
    stackingKey: candidate.effect.stackingKey,
    sameEffectStacking: candidate.effect.sameEffectStacking
  });
}

function recomputeFactors(profile: StaticDamageProfile): void {
  for (const side of ["attacker", "defender"] as SideId[]) {
    for (const unit of UNIT_TYPES) {
      const offense = profile.offense[side][unit];
      const defense = profile.defense[side][unit];
      offense.factor = offenseFactor(offense);
      defense.factor = defenseFactor(defense);
      offense.playerFactorsValid = playerPctFactorValid(offense, "player.attack") && playerPctFactorValid(offense, "player.lethality");
      defense.playerFactorsValid = playerPctFactorValid(defense, "player.health") && playerPctFactorValid(defense, "player.defense");
    }
  }
}

function playerPctFactorValid(entry: StaticDamageProfileEntry, bucket: StaticPlayerBucket): boolean {
  return 1 + (entry.buckets[bucket]?.totalPct ?? 0) / 100 > 0;
}

interface StaticFactorTerm {
  bucket: StaticDamageBucket;
  valueType: BucketValueType;
  placement: BucketPlacement;
}

// The closed-pool aggregation is driven entirely by static bucket metadata (role/valueType/
// placement); there is no second hand-written damage equation. Array order fixes the
// numerator/denominator floating-point association.
const STATIC_FACTOR_TERMS_BY_ROLE: Record<BucketRole, StaticFactorTerm[]> = { attacker: [], defender: [] };
for (const definition of STATIC_BUCKETS) {
  STATIC_FACTOR_TERMS_BY_ROLE[definition.role].push({
    bucket: definition.path,
    valueType: definition.valueType,
    placement: definition.placement
  });
}

function roleFactor(entry: StaticDamageProfileEntry, terms: StaticFactorTerm[]): number {
  let numerator = 1;
  let denominator = 1;
  for (const term of terms) {
    const value = term.valueType === "raw" ? raw(entry, term.bucket) : pct(entry, term.bucket);
    if (term.placement === "numerator") numerator *= value;
    else denominator *= value;
  }
  return numerator / denominator;
}

function offenseFactor(entry: StaticDamageProfileEntry): number {
  return roleFactor(entry, STATIC_FACTOR_TERMS_BY_ROLE.attacker);
}

function defenseFactor(entry: StaticDamageProfileEntry): number {
  return roleFactor(entry, STATIC_FACTOR_TERMS_BY_ROLE.defender);
}

function raw(entry: StaticDamageProfileEntry, bucket: StaticDamageBucket): number {
  return Math.max(0, entry.buckets[bucket]?.raw ?? 0);
}

function pct(entry: StaticDamageProfileEntry, bucket: StaticDamageBucket): number {
  return 1 + (entry.buckets[bucket]?.totalPct ?? 0) / 100;
}

function setRaw(buckets: StaticDamageProfileEntry["buckets"], bucket: StaticRawBucket, raw: number): void {
  buckets[bucket] = { raw, contributors: [] };
}

function setPct(
  buckets: StaticDamageProfileEntry["buckets"],
  bucket: StaticPlayerBucket,
  valuePct: number,
  contributors: DamageBucketTrace["contributors"] = []
): void {
  buckets[bucket] = { totalPct: valuePct, contributors };
}

function addPct(buckets: StaticDamageProfileEntry["buckets"], bucket: StaticPassiveBucket, valuePct: number, contributor: DamageBucketTrace["contributors"][number]): void {
  const existing = buckets[bucket];
  if (existing) {
    existing.totalPct = (existing.totalPct ?? 0) + valuePct;
    existing.contributors.push(contributor);
  } else {
    buckets[bucket] = { totalPct: valuePct, contributors: [contributor] };
  }
}

function fallbackStats(): StatBlock {
  return { attack: 1, defense: 1, lethality: 1, health: 1 };
}

function emptyStats(): StatBlock {
  return { attack: 0, defense: 0, lethality: 0, health: 0 };
}
