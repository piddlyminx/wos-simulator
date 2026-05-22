export type SideId = "attacker" | "defender";
export type UnitType = "infantry" | "lancer" | "marksman";
export type DamageKind = "normal" | "skill";
export type UnitMask = number;
export type ActiveEffectKind = "modifier" | "extra_attack" | "control" | "battle_order";
export type SameEffectStacking = "add" | "max";

export const UNIT_TYPES: UnitType[] = ["infantry", "lancer", "marksman"];
export const UNIT_BITS: Record<UnitType, UnitMask> = {
  infantry: 1 << 0,
  lancer: 1 << 1,
  marksman: 1 << 2
};
export const ALL_UNIT_MASK: UnitMask = UNIT_TYPES.reduce((mask, unit) => mask | UNIT_BITS[unit], 0);

export interface ResolvedUnitScope {
  side: SideId;
  units: UnitMask;
}

export type SupportedTriggerDamageJobSelector =
  | "use.source"
  | "use.target"
  | "activation.source"
  | "activation.target"
  | "enemy.living"
  | "self.living";
export type TriggerDamageJobSelector = SupportedTriggerDamageJobSelector | UnitType | UnitType[];
export type TriggerDamageJobMultiplier = number;

export interface TriggerDamageJobDefinition {
  source: TriggerDamageJobSelector;
  target: TriggerDamageJobSelector;
  multiplier?: TriggerDamageJobMultiplier;
}

export function unitMask(units: UnitType | UnitType[]): UnitMask {
  const list = Array.isArray(units) ? units : [units];
  return list.reduce((mask, unit) => mask | UNIT_BITS[unit], 0);
}

export function unitMaskHas(mask: UnitMask, unit: UnitType): boolean {
  return (mask & UNIT_BITS[unit]) !== 0;
}

export function unitsFromMask(mask: UnitMask): UnitType[] {
  return UNIT_TYPES.filter((unit) => unitMaskHas(mask, unit));
}

export interface StatBlock {
  attack: number;
  defense: number;
  lethality: number;
  health: number;
}

export interface TroopStatsRecord {
  id: string;
  type: UnitType | string;
  tier: number;
  fc?: number;
  stats: Record<string, number>;
}

export type TroopStatsCatalogue = Record<string, TroopStatsRecord>;
export type HeroGenerationStatsCatalogue = Record<string, Partial<StatBlock>>;

export interface EffectDuration {
  type: "battle" | "round" | "attack";
  value: number;
  delay?: number;
}

export interface EffectIntentDefinition {
  id: string;
  type: string;
  value?: unknown;
  value_evolution?: { type?: string; step?: string; value?: number };
  units?: Record<string, unknown>;
  trigger_damage_jobs?: TriggerDamageJobDefinition[];
  duration?: { type?: string; value?: number; delay?: number };
  same_effect_stacking?: SameEffectStacking;
  reason?: string;
}

export interface TriggerDefinition {
  type: string;
  probability?: unknown;
  every?: number;
  source?: unknown;
  target?: unknown;
}

export interface SkillDefinition {
  id: string;
  name: string;
  description?: string;
  troop_type?: UnitType | string;
  requirements?: SkillRequirement[];
  trigger: TriggerDefinition;
  effects: Record<string, Omit<EffectIntentDefinition, "id">>;
}

export interface SkillRequirement {
  level: number;
  type: "tier" | "fc" | "engagement_type" | string;
  value: number | string;
}

export interface SkillFile {
  name: string;
  hero_generation?: string;
  skills: Record<string, Omit<SkillDefinition, "id" | "name">>;
}

export interface ConfigDiagnostics {
  legacyFields: Array<{ file: string; path: string; field: string }>;
  effectTypes: Record<string, number>;
  unsupportedEffects: Array<{ file: string; skillId: string; effectId: string; type: string; reason: string }>;
  ambiguousTurnTriggerSelectors: Array<{ file: string; skillId: string; effectId: string; selector: string; reason: string }>;
}

export interface SimulatorConfig {
  troopStats: TroopStatsCatalogue;
  heroGenerationStats: HeroGenerationStatsCatalogue;
  heroDefinitions: Record<string, SkillFile>;
  heroAliasIndex?: Record<string, string>;
  troopSkills: SkillFile;
  diagnostics: ConfigDiagnostics;
}

export interface FighterInput {
  name?: string;
  troops: Record<string, number>;
  stats?: Record<string, Partial<StatBlock>>;
  heroes?: Record<string, Record<string, number>>;
  joiner_heroes?: Record<string, Record<string, number>>;
}

export interface BattleInput {
  attacker: FighterInput;
  defender: FighterInput;
  seed?: string | number;
  maxRounds?: number;
  trace?: boolean;
  mechanics?: Record<string, unknown>;
}

export interface ResolvedTroopLine {
  id: string;
  type: UnitType;
  tier: number;
  fc: number;
  count: number;
  stats: StatBlock;
}

export interface ResolvedSkill {
  id: string;
  name: string;
  sourceKind: "hero_skill" | "troop_skill";
  side: SideId;
  heroName?: string;
  troopType?: UnitType;
  level: number;
  trigger: TriggerDefinition;
  effects: EffectIntentDefinition[];
}

export interface ResolvedHero {
  name: string;
  heroGeneration?: string;
  generationStats: StatBlock;
  skillIds: string[];
  missing?: boolean;
}

export interface ResolvedFighter {
  side: SideId;
  name: string;
  troops: Record<UnitType, number>;
  initialTroops: Record<UnitType, number>;
  troopDetails: Partial<Record<UnitType, ResolvedTroopLine>>;
  statBonuses: Record<UnitType, StatBlock>;
  heroes: ResolvedHero[];
  troopSkills: ResolvedSkill[];
  heroSkills?: ResolvedSkill[];
  diagnostics: string[];
}

export interface EffectSource {
  kind: "hero_skill" | "troop_skill" | "input_stat" | "unknown";
  side: SideId;
  heroName?: string;
  troopType?: UnitType;
  skillId?: string;
  skillName?: string;
  effectId?: string;
}

export interface ActiveEffect {
  id: string;
  source: EffectSource;
  intent: EffectIntentDefinition;
  ownerSide: SideId;
  kind: ActiveEffectKind;
  valuePct?: number;
  // Resolved ActiveEffect usage gates. Native applies_vs config accepts "any",
  // trigger-relative selectors, or concrete unit selectors; it does not accept "all".
  appliesTo: ResolvedUnitScope;
  appliesVs: ResolvedUnitScope;
  triggerDamageJobs?: TriggerDamageJobDefinition[];
  createdRound: number;
  startRound: number;
  duration: EffectDuration;
  uses: number;
  stackingKey?: string;
  sameEffectStacking: SameEffectStacking;
}

export interface AttackIntent {
  id: string;
  round: number;
  source: "normal";
  attackerSide: SideId;
  attackerUnit: UnitType;
  defenderSide: SideId;
  defenderUnit: UnitType;
  orderIndex: number;
  previousAttackCount: number;
  projectedAttackCount: number;
  previousReceivedAttackCount: number;
  projectedReceivedAttackCount: number;
}

export interface DamageJob {
  id: string;
  round: number;
  kind: DamageKind;
  sourceIntentId: string;
  roundStartTroops: Record<SideId, Record<UnitType, number>>;
  attackerSide: SideId;
  attackerUnit: UnitType;
  defenderSide: SideId;
  defenderUnit: UnitType;
  sourceEffectId?: string;
  sourceMultiplier?: number;
  consumedEffectIds?: string[];
  consumedEffectUseKey?: string;
  consumedEffectUseId?: string;
  consumedEffectUseIds?: string[];
}

export interface CounterDelta {
  side: SideId;
  unit: UnitType;
  counter: "attacks" | "received_attacks";
  by: number;
  cause: "normal_attack" | "extra_skill_attack";
}

export interface DamageBucketTrace {
  totalPct?: number;
  factor: number;
  raw?: number;
  contributors: Array<{ effectId: string; source: string; valuePct: number; bucket: string; stackingKey?: string; sameEffectStacking?: SameEffectStacking }>;
}

export interface DamageAggregationGroupTrace {
  id: string;
  mode: string;
  placement: "numerator" | "denominator";
  inputBuckets: string[];
  totalPct?: number;
  factor: number;
  contributors: DamageBucketTrace["contributors"];
}

export interface DamageEquationTrace {
  roundStartTroops: Record<SideId, Record<UnitType, number>>;
  armyTerm: number;
  atomicBuckets: Record<string, DamageBucketTrace>;
  aggregationGroups: Record<string, DamageAggregationGroupTrace>;
  appliedEffects: AppliedEffectTrace[];
  rejectedEffects: Array<{ effectId: string; reason: string }>;
  rawDamage: number;
  finalKills: number;
}

export interface AppliedEffectTrace {
  effectId: string;
  bucket: string;
  valuePct: number;
  source: string;
  stackingKey?: string;
  sameEffectStacking?: SameEffectStacking;
}

export interface AttackOutcome {
  jobId: string;
  kind: DamageKind;
  attackerSide: SideId;
  attackerUnit: UnitType;
  defenderSide: SideId;
  defenderUnit: UnitType;
  kills: number;
  counterDeltas: CounterDelta[];
  appliedEffectIds: string[];
  appliedEffects: AppliedEffectTrace[];
  consumedEffectIds: string[];
  consumedEffectUseKey?: string;
  consumedEffectUseId?: string;
  consumedEffectUseIds?: string[];
  cancelledBy?: string;
  cancelReason?: "dodge" | "no_attack";
  trace?: DamageEquationTrace;
}

export interface SkillReportEntry {
  sourceKind: "hero_skill" | "troop_skill";
  heroName?: string;
  troopType?: UnitType;
  skillId: string;
  skillName: string;
  level: number;
  triggersSeen: number;
  skillActivations: number;
  effectActivations: number;
  unsupportedEffects: string[];
}

export interface BattleResult {
  winner: SideId | "draw";
  rounds: number;
  remaining: Record<SideId, Record<UnitType, number>>;
  attacks: AttackOutcome[];
  skillReport: Record<SideId, SkillReportEntry[]>;
  resolved: {
    attacker: {
      troops: Record<UnitType, number>;
      heroes: ResolvedHero[];
      troopSkillIds: string[];
      diagnostics: string[];
    };
    defender: {
      troops: Record<UnitType, number>;
      heroes: ResolvedHero[];
      troopSkillIds: string[];
      diagnostics: string[];
    };
  };
  effectActivationCounts: Record<SideId, number>;
  extraSkillAttackJobsByEffect: Record<string, number>;
  attackControlCounts: { dodge: number; no_attack: number };
  randomness: BattleRandomness;
  trace?: BattleTrace;
}

export interface BattleRandomness {
  deterministic: boolean;
  chanceSkillIds: Record<SideId, string[]>;
}

export interface BattleTrace {
  resolved: BattleResult["resolved"];
  rounds: Array<{ round: number; roundStartTroops: Record<SideId, Record<UnitType, number>>; intents: AttackIntent[]; jobs: DamageJob[] }>;
}
