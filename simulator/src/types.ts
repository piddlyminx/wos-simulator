export type SideId = "attacker" | "defender";
export type UnitType = "infantry" | "lancer" | "marksman";
export type DamageKind = "normal" | "skill";
export type UnitMask = number;
export type ActiveEffectKind = "modifier" | "shield" | "extra_attack" | "control" | "battle_order";
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
  | "effect.applies_to"
  | "effect.applies_vs"
  | "enemy.living"
  | "self.living";
export type TriggerDamageJobSelector = SupportedTriggerDamageJobSelector | UnitType | UnitType[];

export interface TriggerDamageJobDefinition {
  source: TriggerDamageJobSelector;
  target: TriggerDamageJobSelector;
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

export type MainStat = keyof StatBlock;

export interface PassiveEffectBucket {
  up?: number;
  down?: number;
}

export type PassiveEffects = Partial<Record<MainStat, PassiveEffectBucket>>;

export interface TroopStatsRecord {
  id: string;
  type: UnitType | string;
  tier: number;
  fc?: number;
  stats: Record<string, number>;
}

export type TroopStatsCatalogue = Record<string, TroopStatsRecord>;
export type HeroGenerationStatsCatalogue = Record<string, Partial<StatBlock>>;

export interface EffectDurationAxis {
  count?: number;
  delay?: number;
}

export interface EffectDuration {
  turns?: EffectDurationAxis;
  attacks?: EffectDurationAxis;
}

export interface EffectIntentDefinition {
  id: string;
  type: string;
  value?: unknown;
  /** Apply this modifier only while the named effect is applicable to the same damage job. */
  requires_effect?: string;
  value_formula?: PercentOfValueFormula;
  value_evolution?: { type?: string; step?: string; value?: number };
  units?: Record<string, unknown>;
  trigger_damage_jobs?: TriggerDamageJobDefinition[];
  duration?: EffectDuration;
  same_effect_stacking?: SameEffectStacking;
  reason?: string;
}

export type TriggerValueSource =
  | "trigger.normal_kills"
  | "trigger.skill_kills"
  | "trigger.total_kills"
  | "trigger.source_attack";

export interface PercentOfValueFormula {
  type: "percent_of";
  source: TriggerValueSource;
}

export interface ResolvedEffectIntentDefinition extends EffectIntentDefinition {
  // Canonical config object retained across per-instance/level resolution. Duplicate
  // main/joiner copies use this identity to share prepared activation groups.
  sourceDefinition: Omit<EffectIntentDefinition, "id">;
  // Runtime damage modifiers only: prepared groups for every resolved scope this definition can
  // activate with, indexed by resolvedEffectScopeKey. Populated during battle preparation.
  effectGroupsByScopeKey?: Array<ActiveEffectGroup | undefined>;
}

export interface TriggerDefinition {
  type: string;
  probability?: unknown;
  first?: number;
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
  aliases?: string[];
  hero_generation?: string;
  troop_type?: UnitType | string;
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

export type HeroSkillLevels = Record<string, number>;

export interface HeroInputEntry {
  name: string;
  levels?: HeroSkillLevels;
}

export type HeroInputCollection = Record<string, HeroSkillLevels> | HeroInputEntry[];

export interface FighterInput {
  name?: string;
  troops: Record<string, number>;
  stats?: Record<string, Partial<StatBlock>>;
  passive?: PassiveEffects;
  heroes?: HeroInputCollection;
  joiner_heroes?: HeroInputCollection;
}

export interface BattleInput {
  attacker: FighterInput;
  defender: FighterInput;
  seed?: string | number;
  maxRounds?: number;
  // The type of battle (e.g. "rally", "garrison"); gates engagement-specific hero skills.
  engagement_type?: string;
}

// fast: signed-score only (no per-attack outcomes); standard: attack-by-attack
// outcomes without per-attack damage traces; trace: full per-attack equation traces.
export type SimulationMode = "fast" | "standard" | "trace";

export interface SimulationOptions {
  mode?: SimulationMode;
  // Whether a dodged / no_attack'd attack still charges (uses += 1) the attacker's
  // attack-constrained effects, as the game does. Default true.
  useEffectsOnDodge?: boolean;
  useEffectsOnNoAttack?: boolean;
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
  heroInstanceId?: string;
  heroRole?: "main" | "joiner";
  troopType?: UnitType;
  level: number;
  trigger: TriggerDefinition;
  effects: ResolvedEffectIntentDefinition[];
  compiledTrigger?: {
    definition: TriggerDefinition;
    side: SideId;
    level: number;
    source: ResolvedUnitScope;
    target: ResolvedUnitScope;
    probabilityPct: number;
  };
}

export interface ResolvedHero {
  name: string;
  heroGeneration?: string;
  skillIds: string[];
  instanceId?: string;
  role?: "main" | "joiner";
  missing?: boolean;
}

// Immutable once resolved; live troop counts during a run belong to the runtime, not the fighter.
export interface ResolvedFighter {
  side: SideId;
  name: string;
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
  heroInstanceId?: string;
  troopType?: UnitType;
  skillId?: string;
  skillName?: string;
  effectId?: string;
}

// Runtime modifiers with the same definition and resolved unit scopes share one stable,
// immutable group descriptor. Live activations for a run are held per runtime in
// EffectIndex.liveEffectsByGroup[ordinal]; job-producing and control effects are indexed
// independently and never enter these groups.
export interface ActiveEffectGroup {
  // Index into RuntimeSkills.effectGroups and every runtime's liveEffectsByGroup.
  ordinal: number;
  bucketIndex: number;
  sameEffectStacking: SameEffectStacking;
  // Prepared dependency lookup indexed by damage-job shape. An empty slot means the
  // required effect cannot apply to that job, so this group must not contribute.
  requiredGroupOrdinalsByJobShape?: Array<number[] | undefined>;
}

export interface ActiveEffect {
  expired?: boolean;
  source: EffectSource;
  /** Direct runtime association used for skill reporting; never emitted. */
  sourceSkill?: ResolvedSkill;
  intent: EffectIntentDefinition;
  ownerSide: SideId;
  kind: ActiveEffectKind;
  // Numeric slot in the runtime damage scratch. Dynamic damage effects receive it
  // when indexed; non-damage effects keep -1.
  bucketIndex: number;
  initialValue: number;
  getCurrentValue(round: number): number;
  // Resolved ActiveEffect usage gates. Native applies_vs config accepts "any",
  // trigger-relative selectors, or concrete unit selectors; it does not accept "all".
  appliesTo: ResolvedUnitScope;
  appliesVs: ResolvedUnitScope;
  triggerDamageJobs?: TriggerDamageJobDefinition[];
  // battle_order effects only: the target preference resolved once from intent.value.
  attackOrder?: readonly UnitType[];
  createdRound: number;
  startRound: number;
  duration: EffectDuration;
  // Eligible attacks remaining before an attacks.delay effect can apply. This is
  // runtime state resolved from config, separate from `uses` after activation.
  remainingAttackDelay: number;
  // Times this instance affected battle mechanics (damage bucket applied, control fired,
  // attack ordered, extra attack spawned). Attack duration constraints and step:"attack"
  // value evolution read it; cancelled attacks still charge attack-constrained effects
  // unless useEffectsOnDodge/useEffectsOnNoAttack disable that.
  uses: number;
  sameEffectStacking: SameEffectStacking;
  effectGroup?: ActiveEffectGroup;
  effectGroupPosition?: number;
}

export interface EvolvingActiveEffect extends ActiveEffect {
  valueEvolution: {
    type?: string;
    step?: string;
    amount: number;
  };
}

export interface AttackIntent {
  round: number;
  source: "normal";
  dealerSide: SideId;
  dealerUnit: UnitType;
  takerSide: SideId;
  takerUnit: UnitType;
  orderIndex: number;
  previousAttackCount: number;
  projectedAttackCount: number;
  previousReceivedAttackCount: number;
  projectedReceivedAttackCount: number;
}

export interface DamageJob {
  round: number;
  kind: DamageKind;
  roundStartTroops: Record<SideId, Record<UnitType, number>>;
  dealerSide: SideId;
  dealerUnit: UnitType;
  takerSide: SideId;
  takerUnit: UnitType;
  sourceEffectId?: string;
  sourceMultiplier?: number;
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
  contributors: Array<{
    effectId: string;
    source: string;
    sourceSide?: SideId;
    valuePct?: number;
    value?: number;
    bucket: string;
    sameEffectStacking?: SameEffectStacking;
  }>;
}

export interface DamageAggregationGroupTrace {
  id: string;
  mode: string;
  placement: "numerator" | "denominator" | "post_subtract";
  inputBuckets: string[];
  raw?: number;
  totalPct?: number;
  factor: number;
  contributors: DamageBucketTrace["contributors"];
}

export interface DamageEquationTrace {
  roundStartTroops: Record<SideId, Record<UnitType, number>>;
  armyTerm: number;
  atomicBuckets: Record<string, DamageBucketTrace>;
  aggregationGroups: Record<string, DamageAggregationGroupTrace>;
  appliedEffects: Array<AppliedModifierEffect | AppliedShieldEffect>;
  rejectedEffects: Array<{ effectId: string; reason: string }>;
  damageBeforeOffsets: number;
  offsetDamage: number;
  rawDamage: number;
  finalKills: number;
}

interface AppliedEffectIdentity {
  effectId: string;
  sourceSide: SideId;
  bucket: string;
}

export interface AppliedPercentageEffectSummary extends AppliedEffectIdentity {
  valuePct: number;
}

export interface AppliedShieldEffectSummary extends AppliedEffectIdentity {
  value: number;
}

interface DetailedPercentageEffectBase extends AppliedPercentageEffectSummary {
  source: string;
}

export interface AppliedModifierEffect extends DetailedPercentageEffectBase {
  kind: "modifier";
  sameEffectStacking: SameEffectStacking;
}

export interface AppliedShieldEffect extends AppliedShieldEffectSummary {
  kind: "shield";
  source: string;
  sameEffectStacking: SameEffectStacking;
}

export interface AppliedControlEffect extends DetailedPercentageEffectBase {
  kind: "control";
  reason: "dodge" | "no_attack";
}

export interface AppliedOrderEffect extends DetailedPercentageEffectBase {
  kind: "battle_order";
  chosenTarget: UnitType;
}

export interface AppliedExtraAttackEffect extends DetailedPercentageEffectBase {
  kind: "extra_attack";
  spawnedJobCount: number;
}

export type DetailedAppliedEffect = AppliedModifierEffect | AppliedShieldEffect | AppliedControlEffect | AppliedOrderEffect | AppliedExtraAttackEffect;
export type AppliedEffect = AppliedPercentageEffectSummary | AppliedShieldEffectSummary | DetailedAppliedEffect;

export interface AttackOutcome {
  round: number;
  kind: DamageKind;
  sourceEffectId?: string;
  dealerSide: SideId;
  dealerUnit: UnitType;
  takerSide: SideId;
  takerUnit: UnitType;
  kills: number;
  /** Trace-only counter bookkeeping. */
  counterDeltas?: CounterDelta[];
  /** Standard emits four-field summaries; trace emits detailed causal events. */
  appliedEffects?: AppliedEffect[];
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
  /** Matching trigger opportunities, including failed probability rolls; populated only in trace mode. */
  triggersSeen: number;
  /** Successful triggers whose probability gate passed. */
  skillActivations: number;
  effectActivations: number;
  skillKills: number;
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

export interface BearBattleResult extends BattleResult {
  score: number;
}

export interface BattleRandomness {
  deterministic: boolean;
  chanceSkillIds: Record<SideId, string[]>;
}

export interface BattleTrace {
  resolved: BattleResult["resolved"];
  rounds: Array<{ round: number; roundStartTroops: Record<SideId, Record<UnitType, number>>; intents: AttackIntent[]; jobs: DamageJob[] }>;
}
