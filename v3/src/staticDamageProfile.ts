import type { ActiveEffect, DamageBucketTrace, EffectIntentDefinition, ResolvedFighter, SideId, SkillFile, StatBlock, UnitType } from "./types.js";
import { UNIT_TYPES, unitMaskHas } from "./types.js";
import type { BucketRole } from "./damageBuckets.js";
import { currentEffectValuePct } from "./effects.js";

export interface StaticDamageProfileTerm {
  raw?: number;
  totalPct?: number;
  contributors: DamageBucketTrace["contributors"];
}

export interface StaticDamageProfileEntry {
  factor: number;
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

export const STATIC_RAW_BUCKETS = ["troops.baseAttack", "troops.baseLethality", "troops.baseHealth", "troops.baseDefense"] as const;
export const STATIC_PLAYER_BUCKETS = ["player.attack", "player.lethality", "player.health", "player.defense"] as const;
export const STATIC_PASSIVE_BUCKETS = [
  "passive.attack.up",
  "passive.attack.down",
  "passive.lethality.up",
  "passive.lethality.down",
  "passive.health.up",
  "passive.health.down",
  "passive.defense.up",
  "passive.defense.down"
] as const;

export type StaticRawBucket = (typeof STATIC_RAW_BUCKETS)[number];
export type StaticPlayerBucket = (typeof STATIC_PLAYER_BUCKETS)[number];
export type StaticPassiveBucket = (typeof STATIC_PASSIVE_BUCKETS)[number];
export type StaticDamageBucket = StaticRawBucket | StaticPlayerBucket | StaticPassiveBucket;

const STATIC_PASSIVE_BUCKET_ROLES: Record<StaticPassiveBucket, BucketRole> = {
  "passive.attack.up": "attacker",
  "passive.attack.down": "attacker",
  "passive.lethality.up": "attacker",
  "passive.lethality.down": "attacker",
  "passive.health.up": "defender",
  "passive.health.down": "defender",
  "passive.defense.up": "defender",
  "passive.defense.down": "defender"
};

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
  const durationType = duration.type ?? "battle";
  if (durationType !== "battle") {
    throw new Error(`passive effect ${effect.type} must use battle duration at ${path}`);
  }
  if (duration.delay !== undefined && duration.delay !== 0) {
    throw new Error(`passive effect ${effect.type} must use battle duration with no delay at ${path}`);
  }
}

export function isStaticProfileBucket(bucket: string): bucket is StaticDamageBucket {
  return (STATIC_BUCKET_SET as Set<string>).has(bucket);
}

export function isPassiveBucket(bucket: string): bucket is StaticPassiveBucket {
  return (STATIC_PASSIVE_BUCKET_SET as Set<string>).has(bucket);
}

export function staticPassiveBucketRole(bucket: string): BucketRole | undefined {
  return isPassiveBucket(bucket) ? STATIC_PASSIVE_BUCKET_ROLES[bucket] : undefined;
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
  return { factor: 1, buckets };
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
      const candidate: PassiveCandidate = { effect, bucket, valuePct: currentEffectValuePct(effect, 1) };
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
    valuePct: candidate.valuePct,
    bucket: candidate.bucket,
    stackingKey: candidate.effect.stackingKey,
    sameEffectStacking: candidate.effect.sameEffectStacking
  });
}

function recomputeFactors(profile: StaticDamageProfile): void {
  for (const side of ["attacker", "defender"] as SideId[]) {
    for (const unit of UNIT_TYPES) {
      profile.offense[side][unit].factor = offenseFactor(profile.offense[side][unit]);
      profile.defense[side][unit].factor = defenseFactor(profile.defense[side][unit]);
    }
  }
}

function offenseFactor(entry: StaticDamageProfileEntry): number {
  return (
    raw(entry, "troops.baseAttack") *
    raw(entry, "troops.baseLethality") *
    pct(entry, "player.attack") *
    pct(entry, "player.lethality") *
    pct(entry, "passive.attack.up") *
    pct(entry, "passive.lethality.up") /
    (pct(entry, "passive.attack.down") * pct(entry, "passive.lethality.down"))
  );
}

function defenseFactor(entry: StaticDamageProfileEntry): number {
  return (
    (pct(entry, "passive.health.down") * pct(entry, "passive.defense.down")) /
    (raw(entry, "troops.baseHealth") *
      raw(entry, "troops.baseDefense") *
      pct(entry, "player.health") *
      pct(entry, "player.defense") *
      pct(entry, "passive.health.up") *
      pct(entry, "passive.defense.up"))
  );
}

function raw(entry: StaticDamageProfileEntry, bucket: StaticRawBucket): number {
  return Math.max(0, entry.buckets[bucket]?.raw ?? 0);
}

function pct(entry: StaticDamageProfileEntry, bucket: StaticPlayerBucket | StaticPassiveBucket): number {
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

function sourceLabel(effect: ActiveEffect): string {
  return [effect.source.heroName ?? effect.source.troopType ?? effect.source.kind, effect.source.skillId, effect.source.effectId].filter(Boolean).join("/");
}

const STATIC_BUCKET_SET = new Set<string>([...STATIC_RAW_BUCKETS, ...STATIC_PLAYER_BUCKETS, ...STATIC_PASSIVE_BUCKETS]);
const STATIC_PASSIVE_BUCKET_SET = new Set<string>(STATIC_PASSIVE_BUCKETS);
