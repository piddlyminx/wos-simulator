import type { DamageResult } from "./damage";
import { ATOMIC_BUCKETS, BUCKET_DEFINITIONS, type AtomicBucket, type StaticDamageBucket } from "./damageBuckets";
import { sourceLabel } from "./effects";
import type { StaticDamageProfileEntry } from "./staticDamageProfile";
import type {
  ActiveEffect,
  AppliedEffect,
  AttackIntent,
  AttackOutcome,
  BattleTrace,
  DamageAggregationGroupTrace,
  DamageBucketTrace,
  DamageEquationTrace,
  DamageJob,
  ResolvedFighter,
  ResolvedSkill,
  SideId,
  SkillReportEntry,
  SimulationMode,
  UnitType
} from "./types";

type RejectedEffectReason = "same_effect_max_suppressed" | "same_effect_max_superseded";
type GroupPlacement = "numerator" | "denominator";
type NumericBucketId = number;

interface DamageFactorTerm {
  id: string;
  bucket: NumericBucketId;
  bucketName: AtomicBucket;
  placement: GroupPlacement;
  appliesTo?: DamageJob["kind"];
}

export interface DamageRecordingResult {
  job: DamageJob;
  factors: Float64Array;
  staticOffense: StaticDamageProfileEntry;
  staticDefense: StaticDamageProfileEntry;
  armyTerm: number;
  rawDamage: number;
  kills: number;
}

/** Per-damage-job observation sink selected by the enclosing battle recorder. */
export interface DamageJobRecorder {
  recordModifier(effect: ActiveEffect, valuePct: number): void;
  recordRejected(effect: ActiveEffect, reason: RejectedEffectReason): void;
  recordStaticProfile(entry: StaticDamageProfileEntry): void;
  finish(result: DamageRecordingResult): DamageResult;
}

/**
 * Observes the battle without deciding combat behavior. The concrete recorder is selected once,
 * before the round loop, and every simulation path emits the same observations to it.
 */
export interface BattleRecorder {
  startDamageJob(): DamageJobRecorder;
  recordSkillTriggered(skill: ResolvedSkill): void;
  recordSkillActivated(skill: ResolvedSkill): void;
  recordSkillEffectActivated(skill: ResolvedSkill): void;
  recordSkillDamageJob(job: DamageJob, effect: ActiveEffect): void;
  recordBattleOrder(intentId: string, effect: ActiveEffect, chosenTarget: UnitType): void;
  recordScheduledDamageJob(job: DamageJob): void;
  recordExtraAttack(normalJob: DamageJob, effect: ActiveEffect, jobs: DamageJob[], firstJobIndex: number, jobCount: number, processedJobIds: Set<string>): void;
  recordCancelled(intent: AttackIntent, effect: ActiveEffect, reason: "dodge" | "no_attack"): void;
  recordDamageJob(job: DamageJob, result: DamageResult): void;
  recordFinalKills(result: DamageResult): void;
  recordRound(round: number, roundStartTroops: DamageJob["roundStartTroops"], intents: AttackIntent[]): void;
  readonly attacks: AttackOutcome[];
  readonly skillReport: Record<SideId, SkillReportEntry[]>;
  readonly trace: BattleTrace | undefined;
}

const NO_ATTACKS: AttackOutcome[] = [];
const NO_APPLIED_EFFECTS: AppliedEffect[] = [];
const EMPTY_SKILL_REPORT: Record<SideId, SkillReportEntry[]> = { attacker: [], defender: [] };
const REPORT_KEY_CACHE = new WeakMap<ResolvedSkill, string>();

const NULL_DAMAGE_JOB_RECORDER: DamageJobRecorder = {
  recordModifier() {},
  recordRejected() {},
  recordStaticProfile() {},
  finish({ kills }) {
    return { kills };
  }
};

export class NullRecorder implements BattleRecorder {
  readonly attacks = NO_ATTACKS;
  readonly skillReport = EMPTY_SKILL_REPORT;
  readonly trace = undefined;

  startDamageJob(): DamageJobRecorder {
    return NULL_DAMAGE_JOB_RECORDER;
  }

  recordBattleOrder() {}
  recordSkillTriggered() {}
  recordSkillActivated() {}
  recordSkillEffectActivated() {}
  recordSkillDamageJob() {}
  recordScheduledDamageJob() {}
  recordExtraAttack() {}
  recordCancelled() {}
  recordDamageJob() {}
  recordFinalKills() {}
  recordRound() {}
}

export const NULL_RECORDER: BattleRecorder = new NullRecorder();

export function createRecorder(
  mode: SimulationMode,
  fighters: ResolvedFighter[],
  makeResolved: () => BattleTrace["resolved"]
): BattleRecorder {
  if (mode === "fast") return NULL_RECORDER;
  if (mode === "trace") return new FullTraceRecorder(fighters, makeResolved);
  return new BasicInfoRecorder(fighters);
}

export class BasicInfoRecorder implements BattleRecorder {
  readonly attacks: AttackOutcome[] = [];
  protected readonly orderEvents = new Map<string, AppliedEffect>();
  protected readonly extraAttackEvents = new Map<string, AppliedEffect[]>();
  protected readonly skillReports: Record<SideId, Map<string, SkillReportEntry>> = {
    attacker: new Map(),
    defender: new Map()
  };
  protected readonly skillDamageKeys = new Map<string, string>();

  constructor(fighters: ResolvedFighter[] = []) {
    for (const fighter of fighters) {
      for (const skill of [...(fighter.heroSkills ?? []), ...fighter.troopSkills]) {
        this.skillReports[fighter.side].set(skillReportKey(skill), {
          sourceKind: skill.sourceKind,
          heroName: skill.heroName,
          troopType: skill.troopType,
          skillId: skill.id,
          skillName: skill.name,
          level: skill.level,
          triggersSeen: 0,
          skillActivations: 0,
          effectActivations: 0,
          skillKills: 0,
          unsupportedEffects: []
        });
      }
    }
  }

  get trace(): BattleTrace | undefined {
    return undefined;
  }

  get skillReport(): Record<SideId, SkillReportEntry[]> {
    return {
      attacker: [...this.skillReports.attacker.values()],
      defender: [...this.skillReports.defender.values()]
    };
  }

  startDamageJob(): DamageJobRecorder {
    return new BasicDamageJobRecorder();
  }

  recordSkillTriggered(skill: ResolvedSkill): void {
    this.incrementSkillReport(skill, "triggersSeen");
  }

  recordSkillActivated(skill: ResolvedSkill): void {
    this.incrementSkillReport(skill, "skillActivations");
  }

  recordSkillEffectActivated(skill: ResolvedSkill): void {
    this.incrementSkillReport(skill, "effectActivations");
  }

  recordSkillDamageJob(job: DamageJob, effect: ActiveEffect): void {
    const key = skillReportKeyForEffect(effect);
    if (key) this.skillDamageKeys.set(job.id, key);
  }

  recordBattleOrder(intentId: string, effect: ActiveEffect, chosenTarget: UnitType): void {
    this.orderEvents.set(intentId, {
      kind: "battle_order",
      ...appliedEffectBase(effect),
      chosenTarget
    });
  }

  recordScheduledDamageJob(_job: DamageJob): void {}

  recordExtraAttack(
    normalJob: DamageJob,
    effect: ActiveEffect,
    jobs: DamageJob[],
    firstJobIndex: number,
    jobCount: number,
    processedJobIds: Set<string>
  ): void {
    const spawnedJobIds: string[] = [];
    const end = firstJobIndex + jobCount;
    for (let index = firstJobIndex; index < end; index += 1) {
      const jobId = jobs[index]?.id;
      if (jobId && processedJobIds.has(jobId)) spawnedJobIds.push(jobId);
    }
    if (spawnedJobIds.length === 0) return;
    const event: AppliedEffect = {
      kind: "extra_attack",
      ...appliedEffectBase(effect),
      spawnedJobIds
    };
    const events = this.extraAttackEvents.get(normalJob.id);
    if (events) events.push(event);
    else this.extraAttackEvents.set(normalJob.id, [event]);
  }

  recordCancelled(intent: AttackIntent, effect: ActiveEffect, reason: "dodge" | "no_attack"): void {
    const order = this.orderEvents.get(intent.id);
    this.orderEvents.delete(intent.id);
    this.attacks.push({
      jobId: `${intent.id}:cancelled`,
      round: intent.round,
      kind: "normal",
      attackerSide: intent.attackerSide,
      attackerUnit: intent.attackerUnit,
      defenderSide: intent.defenderSide,
      defenderUnit: intent.defenderUnit,
      kills: 0,
      counterDeltas: counterDeltas(intent, "normal_attack"),
      appliedEffects: order
        ? [order, { kind: "control", ...appliedEffectBase(effect), reason }]
        : [{ kind: "control", ...appliedEffectBase(effect), reason }],
      cancelledBy: effect.id,
      cancelReason: reason
    });
  }

  recordDamageJob(job: DamageJob, result: DamageResult): void {
    const sourceSkillReportKey = this.skillDamageKeys.get(job.id);
    this.skillDamageKeys.delete(job.id);
    if (job.kind === "skill" && sourceSkillReportKey && result.kills > 0) {
      const report = this.skillReports[job.attackerSide].get(sourceSkillReportKey);
      if (report) report.skillKills += result.kills;
    }
    const cause = job.kind === "skill" ? "extra_skill_attack" : "normal_attack";
    const order = job.sourceIntentId ? this.orderEvents.get(job.sourceIntentId) : undefined;
    if (job.sourceIntentId) this.orderEvents.delete(job.sourceIntentId);
    const extras = this.extraAttackEvents.get(job.id);
    this.extraAttackEvents.delete(job.id);
    this.attacks.push({
      jobId: job.id,
      round: job.round,
      kind: job.kind,
      sourceEffectId: job.sourceEffectId,
      sourceSkillReportKey,
      attackerSide: job.attackerSide,
      attackerUnit: job.attackerUnit,
      defenderSide: job.defenderSide,
      defenderUnit: job.defenderUnit,
      kills: result.kills,
      counterDeltas: counterDeltas(job, cause),
      appliedEffects: mergeAppliedEffects(result.appliedEffects, order, extras),
      trace: result.trace
    });
  }

  recordFinalKills(_result: DamageResult): void {}

  recordRound(_round: number, _roundStartTroops: DamageJob["roundStartTroops"], _intents: AttackIntent[]): void {
    this.orderEvents.clear();
    this.extraAttackEvents.clear();
    this.skillDamageKeys.clear();
  }

  private incrementSkillReport(skill: ResolvedSkill, field: "triggersSeen" | "skillActivations" | "effectActivations"): void {
    const report = this.skillReports[skill.side].get(skillReportKey(skill));
    if (report) report[field] += 1;
  }
}

export class FullTraceRecorder extends BasicInfoRecorder {
  private readonly rounds: BattleTrace["rounds"] = [];
  private readonly roundJobs: DamageJob[] = [];

  constructor(
    fighters: ResolvedFighter[],
    private readonly makeResolved: () => BattleTrace["resolved"]
  ) { super(fighters); }

  override startDamageJob(): DamageJobRecorder {
    return new FullDamageJobRecorder();
  }

  override recordScheduledDamageJob(job: DamageJob): void {
    const sourceSkillReportKey = this.skillDamageKeys.get(job.id);
    this.roundJobs.push(sourceSkillReportKey ? { ...job, sourceSkillReportKey } : job);
  }

  override recordFinalKills(result: DamageResult): void {
    if (result.trace) result.trace.finalKills = result.kills;
  }

  override recordRound(round: number, roundStartTroops: DamageJob["roundStartTroops"], intents: AttackIntent[]): void {
    this.rounds.push({ round, roundStartTroops, intents, jobs: this.roundJobs.splice(0) });
    super.recordRound(round, roundStartTroops, intents);
  }

  override get trace(): BattleTrace {
    return { resolved: this.makeResolved(), rounds: this.rounds };
  }
}

class BasicDamageJobRecorder implements DamageJobRecorder {
  protected readonly appliedEffects: DamageEquationTrace["appliedEffects"] = [];

  recordModifier(effect: ActiveEffect, valuePct: number): void {
    if (valuePct === 0) return;
    const applied = {
      kind: "modifier" as const,
      activeEffectId: effect.id,
      effectId: effect.source.effectId ?? effect.id,
      bucket: effect.intent.type,
      valuePct,
      source: sourceLabel(effect),
      sourceSide: effect.ownerSide,
      sameEffectStacking: effect.sameEffectStacking,
      ...(effect.stackingKey === undefined ? {} : { stackingKey: effect.stackingKey })
    };
    this.appliedEffects.push(applied);
  }

  recordRejected(_effect: ActiveEffect, _reason: RejectedEffectReason): void {}

  recordStaticProfile(entry: StaticDamageProfileEntry): void {
    for (const [bucket, term] of Object.entries(entry.buckets) as Array<[StaticDamageBucket, StaticDamageProfileEntry["buckets"][StaticDamageBucket]]>) {
      if (!bucket.startsWith("passive.") || !term) continue;
      for (const contributor of term.contributors) {
        this.appliedEffects.push({
          kind: "modifier",
          activeEffectId: contributor.effectId,
          effectId: contributor.effectId,
          bucket,
          valuePct: contributor.valuePct,
          source: contributor.source,
          sourceSide: contributor.sourceSide,
          stackingKey: contributor.stackingKey,
          sameEffectStacking: contributor.sameEffectStacking
        });
      }
    }
  }

  finish({ kills }: DamageRecordingResult): DamageResult {
    return { kills, appliedEffects: this.appliedEffects };
  }
}

class FullDamageJobRecorder extends BasicDamageJobRecorder {
  private readonly contributors: DamageBucketTrace["contributors"][] = Array.from(
    { length: ATOMIC_BUCKETS.length },
    () => []
  );
  private readonly rejectedEffects: DamageEquationTrace["rejectedEffects"] = [];

  override recordModifier(effect: ActiveEffect, valuePct: number): void {
    this.contributors[effect.bucketIndex]?.push({
      effectId: effect.source.effectId ?? effect.id,
      source: sourceLabel(effect),
      sourceSide: effect.ownerSide,
      valuePct,
      bucket: effect.intent.type,
      stackingKey: effect.stackingKey,
      sameEffectStacking: effect.sameEffectStacking
    });
    super.recordModifier(effect, valuePct);
  }

  override recordRejected(effect: ActiveEffect, reason: RejectedEffectReason): void {
    this.rejectedEffects.push({ effectId: effect.source.effectId ?? effect.id, reason });
  }

  override finish(result: DamageRecordingResult): DamageResult {
    const basic = super.finish(result);
    const staticEntries = [result.staticOffense, result.staticDefense];
    return {
      ...basic,
      trace: {
        roundStartTroops: {
          attacker: { ...result.job.roundStartTroops.attacker },
          defender: { ...result.job.roundStartTroops.defender }
        },
        armyTerm: result.armyTerm,
        atomicBuckets: toTraceBuckets(result.factors, this.contributors, staticEntries),
        aggregationGroups: buildAggregationGroups(result.job, result.factors, this.contributors, staticEntries),
        appliedEffects: this.appliedEffects,
        rejectedEffects: this.rejectedEffects,
        rawDamage: result.rawDamage,
        finalKills: result.kills
      }
    };
  }
}

const BUCKET_IDS = Object.fromEntries(ATOMIC_BUCKETS.map((bucket, index) => [bucket, index])) as Record<AtomicBucket, NumericBucketId>;
const DEFAULT_FACTOR_TERMS = ATOMIC_BUCKETS.map((bucket) => factorTerm(bucket));
const DEFAULT_NUMERATOR_TERMS = DEFAULT_FACTOR_TERMS.filter((term) => term.placement === "numerator");
const DEFAULT_DENOMINATOR_TERMS = DEFAULT_FACTOR_TERMS.filter((term) => term.placement === "denominator");

function factorTerm(bucket: AtomicBucket): DamageFactorTerm {
  const definition = BUCKET_DEFINITIONS[bucket];
  return {
    id: bucket,
    bucket: BUCKET_IDS[bucket],
    bucketName: bucket,
    placement: definition.placement,
    appliesTo: definition.appliesTo
  };
}

function buildAggregationGroups(
  job: DamageJob,
  factors: Float64Array,
  contributors: DamageBucketTrace["contributors"][],
  staticEntries: StaticDamageProfileEntry[]
): Record<string, DamageAggregationGroupTrace> {
  const groups: Record<string, DamageAggregationGroupTrace> = {};
  addStaticAggregationGroups(groups, staticEntries);
  for (const term of [...DEFAULT_NUMERATOR_TERMS, ...DEFAULT_DENOMINATOR_TERMS]) {
    if (term.appliesTo && term.appliesTo !== job.kind) continue;
    const definition = BUCKET_DEFINITIONS[term.bucketName];
    const factor = factors[term.bucket];
    groups[term.id] = definition.valueType === "raw"
      ? {
          id: term.id,
          mode: "raw",
          placement: term.placement,
          inputBuckets: [term.bucketName],
          factor,
          contributors: contributors[term.bucket] ?? []
        }
      : {
          id: term.id,
          mode: "sum_pct",
          placement: term.placement,
          inputBuckets: [term.bucketName],
          totalPct: pctFromFactor(factor),
          factor,
          contributors: contributors[term.bucket] ?? []
        };
  }
  return groups;
}

function addStaticAggregationGroups(
  groups: Record<string, DamageAggregationGroupTrace>,
  staticEntries: StaticDamageProfileEntry[]
): void {
  const offense = staticEntries[0];
  const defense = staticEntries[1];
  if (!offense || !defense) return;
  addStaticRawGroup(groups, "troops.baseAttack", "numerator", offense, "troops.baseAttack");
  addStaticRawGroup(groups, "troops.baseLethality", "numerator", offense, "troops.baseLethality");
  addStaticPctGroup(groups, "player.attacker.attack", "numerator", offense, "player.attack");
  addStaticPctGroup(groups, "player.attacker.lethality", "numerator", offense, "player.lethality");
  addStaticPctGroup(groups, "passive.attacker.attack.up", "numerator", offense, "passive.attack.up");
  addStaticPctGroup(groups, "passive.attacker.lethality.up", "numerator", offense, "passive.lethality.up");
  addStaticPctGroup(groups, "passive.defender.health.down", "numerator", defense, "passive.health.down");
  addStaticPctGroup(groups, "passive.defender.defense.down", "numerator", defense, "passive.defense.down");
  addStaticRawGroup(groups, "troops.baseHealth", "denominator", defense, "troops.baseHealth");
  addStaticRawGroup(groups, "troops.baseDefense", "denominator", defense, "troops.baseDefense");
  addStaticPctGroup(groups, "player.defender.health", "denominator", defense, "player.health");
  addStaticPctGroup(groups, "player.defender.defense", "denominator", defense, "player.defense");
  addStaticPctGroup(groups, "passive.attacker.attack.down", "denominator", offense, "passive.attack.down");
  addStaticPctGroup(groups, "passive.attacker.lethality.down", "denominator", offense, "passive.lethality.down");
  addStaticPctGroup(groups, "passive.defender.health.up", "denominator", defense, "passive.health.up");
  addStaticPctGroup(groups, "passive.defender.defense.up", "denominator", defense, "passive.defense.up");
}

function addStaticRawGroup(
  groups: Record<string, DamageAggregationGroupTrace>,
  id: string,
  placement: GroupPlacement,
  entry: StaticDamageProfileEntry,
  bucket: StaticDamageBucket
): void {
  const term = entry.buckets[bucket];
  groups[id] = {
    id,
    mode: "raw",
    placement,
    inputBuckets: [bucket],
    factor: Math.max(0, term?.raw ?? 0),
    contributors: term?.contributors ?? []
  };
}

function addStaticPctGroup(
  groups: Record<string, DamageAggregationGroupTrace>,
  id: string,
  placement: GroupPlacement,
  entry: StaticDamageProfileEntry,
  bucket: StaticDamageBucket
): void {
  const term = entry.buckets[bucket];
  const totalPct = term?.totalPct ?? 0;
  groups[id] = {
    id,
    mode: "sum_pct",
    placement,
    inputBuckets: [bucket],
    totalPct,
    factor: 1 + totalPct / 100,
    contributors: term?.contributors ?? []
  };
}

function toTraceBuckets(
  factors: Float64Array,
  contributors: DamageBucketTrace["contributors"][],
  staticEntries: StaticDamageProfileEntry[]
): Record<string, DamageBucketTrace> {
  const traced = Object.fromEntries(
    ATOMIC_BUCKETS.map((bucket, index) => {
      const definition = BUCKET_DEFINITIONS[bucket];
      const factor = factors[index];
      const bucketContributors = contributors[index] ?? [];
      return definition.valueType === "raw"
        ? [bucket, { raw: factor, factor, contributors: [...bucketContributors] }]
        : [bucket, { totalPct: pctFromFactor(factor), factor, contributors: [...bucketContributors] }];
    })
  ) as Record<string, DamageBucketTrace>;
  for (const entry of staticEntries) {
    for (const [bucket, term] of Object.entries(entry.buckets) as Array<[StaticDamageBucket, StaticDamageProfileEntry["buckets"][StaticDamageBucket]]>) {
      if (!term) continue;
      traced[bucket] = term.raw !== undefined
        ? { raw: term.raw, factor: Math.max(0, term.raw), contributors: [...term.contributors] }
        : { totalPct: term.totalPct ?? 0, factor: 1 + (term.totalPct ?? 0) / 100, contributors: [...term.contributors] };
    }
  }
  return traced;
}

function appliedEffectBase(effect: ActiveEffect): { activeEffectId: string; effectId: string; source: string; sourceSide: SideId } {
  return {
    activeEffectId: effect.id,
    effectId: effect.source.effectId ?? effect.id,
    source: sourceLabel(effect),
    sourceSide: effect.ownerSide
  };
}

function counterDeltas(
  attack: Pick<AttackIntent | DamageJob, "attackerSide" | "attackerUnit" | "defenderSide" | "defenderUnit">,
  cause: "normal_attack" | "extra_skill_attack"
): AttackOutcome["counterDeltas"] {
  return [
    { side: attack.attackerSide, unit: attack.attackerUnit, counter: "attacks", by: 1, cause },
    { side: attack.defenderSide, unit: attack.defenderUnit, counter: "received_attacks", by: 1, cause }
  ];
}

function skillReportKey(skill: ResolvedSkill): string {
  const cached = REPORT_KEY_CACHE.get(skill);
  if (cached) return cached;
  const key = skillReportKeyFromParts(
    skill.sourceKind,
    skill.heroInstanceId ?? skill.heroName ?? skill.troopType ?? "",
    skill.id
  );
  REPORT_KEY_CACHE.set(skill, key);
  return key;
}

function skillReportKeyForEffect(effect: ActiveEffect): string | undefined {
  const source = effect.source;
  if ((source.kind !== "hero_skill" && source.kind !== "troop_skill") || !source.skillId) return undefined;
  return skillReportKeyFromParts(
    source.kind,
    source.heroInstanceId ?? source.heroName ?? source.troopType ?? "",
    source.skillId
  );
}

function skillReportKeyFromParts(
  sourceKind: SkillReportEntry["sourceKind"],
  sourceKey: string,
  skillId: string
): string {
  return `${sourceKind}:${sourceKey}:${skillId}`;
}

function mergeAppliedEffects(
  applied: AppliedEffect[] | undefined,
  order: AppliedEffect | undefined,
  extras: AppliedEffect[] | undefined
): AppliedEffect[] {
  if (!applied?.length && !order && !extras?.length) return NO_APPLIED_EFFECTS;
  if (!order && !extras?.length) return applied ?? NO_APPLIED_EFFECTS;
  if (!applied?.length && !extras?.length) return order ? [order] : NO_APPLIED_EFFECTS;
  if (!applied?.length && !order) return extras ?? NO_APPLIED_EFFECTS;
  return [...(applied ?? []), ...(order ? [order] : []), ...(extras ?? [])];
}

function pctFromFactor(factor: number): number {
  return Number(((factor - 1) * 100).toFixed(12));
}
