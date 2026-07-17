import type { DamageResult } from "./damage";
import {
  DYNAMIC_BUCKET_INDEX,
  DYNAMIC_BUCKETS,
  dynamicBucketDefinition,
  pctBucketFactor,
  rawBucketFactor,
  type DynamicDamageBucket,
  type StaticDamageBucket,
  type StaticPlayerBucket,
  type StaticRawBucket
} from "./damageBuckets";
import { sourceLabel } from "./effects";
import { selectPassiveContributions, unitBaseStats, unitPlayerBonuses, type PassiveContribution } from "./staticDamageProfile";
import { UNIT_TYPES } from "./types";
import type {
  ActiveEffect,
  AppliedEffect,
  AppliedModifierEffect,
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
  bucketName: DynamicDamageBucket;
  placement: GroupPlacement;
  damageKind?: DamageJob["kind"];
}

export interface DamageRecordingResult {
  job: DamageJob;
  factors: Float64Array;
  armyTerm: number;
  rawDamage: number;
  kills: number;
}

/** Per-damage-job observation sink selected by the enclosing battle recorder. */
export interface DamageJobRecorder {
  recordModifier(effect: ActiveEffect, valuePct: number): void;
  recordRejected(effect: ActiveEffect, reason: RejectedEffectReason): void;
  finish(result: DamageRecordingResult): DamageResult;
}

// Recorder-side description of how the static damage factors were assembled: the same selection
// the numeric profile uses (via selectPassiveContributions) expanded into per-bucket terms with
// contributors. The battle runtime never sees these shapes; fast mode never builds them.
interface StaticProfileTerm {
  raw?: number;
  totalPct?: number;
  factor: number;
  contributors: DamageBucketTrace["contributors"];
}

interface StaticProfileEntry {
  buckets: Partial<Record<StaticDamageBucket, StaticProfileTerm>>;
}

interface StaticProfileDescription {
  dealer: Record<SideId, Record<UnitType, StaticProfileEntry>>;
  taker: Record<SideId, Record<UnitType, StaticProfileEntry>>;
}

// Per-(side, unit) applied-effect fragments prebuilt from the static profile description; the
// per-job recorders splice them into each damage event instead of re-walking the description.
interface StaticAppliedIndex {
  dealer: Record<SideId, Record<UnitType, AppliedEffect[]>>;
  taker: Record<SideId, Record<UnitType, AppliedEffect[]>>;
}

/**
 * Observes the battle without deciding combat behavior. The concrete recorder is selected once,
 * before the round loop, and every simulation path emits the same observations to it.
 */
export interface BattleRecorder {
  /**
   * Receives the battle's fighters and setup effects before any damage job runs. Recorders that
   * report static contributions build their description of the static profile here; the null
   * recorder does nothing, so fast mode pays nothing.
   */
  recordStaticProfile(fighters: Record<SideId, ResolvedFighter>, setupEffects: ActiveEffect[]): void;
  startDamageJob(): DamageJobRecorder;
  recordSkillTriggerAttempt(skill: ResolvedSkill): void;
  recordSkillTriggered(skill: ResolvedSkill): void;
  recordSkillEffectActivated(skill: ResolvedSkill): void;
  recordSkillDamageJob(job: DamageJob, effect: ActiveEffect): void;
  recordBattleOrder(intent: AttackIntent, effect: ActiveEffect, chosenTarget: UnitType): void;
  recordScheduledDamageJob(job: DamageJob): void;
  /** One extra_skill_attack firing on a normal attack; spawnedJobCount is the number of its jobs that ran (always > 0). */
  recordExtraAttack(normalJob: DamageJob, effect: ActiveEffect, spawnedJobCount: number): void;
  recordCancelled(intent: AttackIntent, effect: ActiveEffect, reason: "dodge" | "no_attack"): void;
  recordDamageJob(job: DamageJob, result: DamageResult, intent?: AttackIntent): void;
  recordFinalKills(result: DamageResult): void;
  recordRound(round: number, roundStartTroops: DamageJob["roundStartTroops"], intents: AttackIntent[]): void;
  readonly attacks: AttackOutcome[];
  readonly skillReport: Record<SideId, SkillReportEntry[]>;
  readonly trace: BattleTrace | undefined;
}

const NO_ATTACKS: AttackOutcome[] = [];
const NO_APPLIED_EFFECTS: AppliedEffect[] = [];
const EMPTY_SKILL_REPORT: Record<SideId, SkillReportEntry[]> = { attacker: [], defender: [] };

const NULL_DAMAGE_JOB_RECORDER: DamageJobRecorder = {
  recordModifier() {},
  recordRejected() {},
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

  recordStaticProfile() {}
  recordBattleOrder() {}
  recordSkillTriggerAttempt() {}
  recordSkillTriggered() {}
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
  protected readonly detailedAttackEffects: boolean = false;
  protected staticApplied?: StaticAppliedIndex;
  protected readonly orderEvents = new Map<AttackIntent, AppliedEffect>();
  protected readonly extraAttackEvents = new Map<DamageJob, AppliedEffect[]>();
  protected readonly skillReports: Record<SideId, Map<ResolvedSkill, SkillReportEntry>> = {
    attacker: new Map(),
    defender: new Map()
  };
  protected readonly skillDamageReports = new Map<DamageJob, SkillReportEntry>();

  constructor(fighters: ResolvedFighter[] = []) {
    for (const fighter of fighters) {
      for (const skill of [...(fighter.heroSkills ?? []), ...fighter.troopSkills]) {
        this.skillReports[fighter.side].set(skill, {
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

  recordStaticProfile(fighters: Record<SideId, ResolvedFighter>, setupEffects: ActiveEffect[]): void {
    this.applyStaticDescription(buildStaticProfileDescription(fighters, setupEffects, this.detailedAttackEffects));
  }

  protected applyStaticDescription(description: StaticProfileDescription): void {
    this.staticApplied = {
      dealer: staticAppliedFragments(description.dealer, this.detailedAttackEffects),
      taker: staticAppliedFragments(description.taker, this.detailedAttackEffects)
    };
  }

  startDamageJob(): DamageJobRecorder {
    return new BasicDamageJobRecorder(this.staticApplied);
  }

  recordSkillTriggerAttempt(_skill: ResolvedSkill): void {}

  recordSkillTriggered(skill: ResolvedSkill): void {
    this.incrementSkillReport(skill, "skillActivations");
  }

  recordSkillEffectActivated(skill: ResolvedSkill): void {
    this.incrementSkillReport(skill, "effectActivations");
  }

  recordSkillDamageJob(job: DamageJob, effect: ActiveEffect): void {
    const skill = effect.sourceSkill;
    const report = skill && this.skillReports[skill.side].get(skill);
    if (report) this.skillDamageReports.set(job, report);
  }

  recordBattleOrder(intent: AttackIntent, effect: ActiveEffect, chosenTarget: UnitType): void {
    this.orderEvents.set(intent, this.effectEvent(effect, intent.round, { kind: "battle_order", chosenTarget }));
  }

  recordScheduledDamageJob(_job: DamageJob): void {}

  recordExtraAttack(normalJob: DamageJob, effect: ActiveEffect, spawnedJobCount: number): void {
    const event = this.effectEvent(effect, normalJob.round, { kind: "extra_attack", spawnedJobCount });
    const events = this.extraAttackEvents.get(normalJob);
    if (events) events.push(event);
    else this.extraAttackEvents.set(normalJob, [event]);
  }

  recordCancelled(intent: AttackIntent, effect: ActiveEffect, reason: "dodge" | "no_attack"): void {
    const order = this.orderEvents.get(intent);
    this.orderEvents.delete(intent);
    const control = this.effectEvent(effect, intent.round, { kind: "control", reason });
    const appliedEffects = order ? [order, control] : [control];
    this.attacks.push({
      round: intent.round,
      kind: "normal",
      dealerSide: intent.dealerSide,
      dealerUnit: intent.dealerUnit,
      takerSide: intent.takerSide,
      takerUnit: intent.takerUnit,
      kills: 0,
      ...(this.detailedAttackEffects ? { counterDeltas: counterDeltas(intent, "normal_attack") } : {}),
      appliedEffects,
      cancelReason: reason
    });
  }

  recordDamageJob(job: DamageJob, result: DamageResult, intent?: AttackIntent): void {
    const sourceSkillReport = this.skillDamageReports.get(job);
    this.skillDamageReports.delete(job);
    if (job.kind === "skill" && sourceSkillReport && result.kills > 0) {
      sourceSkillReport.skillKills += result.kills;
    }
    const order = intent && job.kind === "normal" ? this.orderEvents.get(intent) : undefined;
    if (intent && job.kind === "normal") this.orderEvents.delete(intent);
    const extras = this.extraAttackEvents.get(job);
    this.extraAttackEvents.delete(job);
    const appliedEffects = mergeAppliedEffects(result.appliedEffects, order, extras);
    const cause = job.kind === "skill" ? "extra_skill_attack" : "normal_attack";
    this.attacks.push({
      round: job.round,
      kind: job.kind,
      sourceEffectId: job.sourceEffectId,
      dealerSide: job.dealerSide,
      dealerUnit: job.dealerUnit,
      takerSide: job.takerSide,
      takerUnit: job.takerUnit,
      kills: result.kills,
      ...(this.detailedAttackEffects ? { counterDeltas: counterDeltas(job, cause) } : {}),
      ...(appliedEffects.length ? { appliedEffects } : {}),
      trace: result.trace
    });
  }

  protected effectEvent(
    effect: ActiveEffect,
    round: number,
    detail: { kind: "control"; reason: "dodge" | "no_attack" } | { kind: "battle_order"; chosenTarget: UnitType } | { kind: "extra_attack"; spawnedJobCount: number }
  ): AppliedEffect {
    const summary = appliedEffectSummary(effect, effect.getCurrentValuePct(round));
    return this.detailedAttackEffects
      ? { ...summary, source: sourceLabel(effect), ...detail }
      : summary;
  }

  recordFinalKills(_result: DamageResult): void {}

  recordRound(_round: number, _roundStartTroops: DamageJob["roundStartTroops"], _intents: AttackIntent[]): void {
    this.orderEvents.clear();
    this.extraAttackEvents.clear();
    this.skillDamageReports.clear();
  }

  protected incrementSkillReport(skill: ResolvedSkill, field: "triggersSeen" | "skillActivations" | "effectActivations"): void {
    const report = this.skillReports[skill.side].get(skill);
    if (report) report[field] += 1;
  }
}

export class FullTraceRecorder extends BasicInfoRecorder {
  protected override readonly detailedAttackEffects: boolean = true;
  private readonly rounds: BattleTrace["rounds"] = [];
  private readonly roundJobs: DamageJob[] = [];
  private staticDescription?: StaticProfileDescription;

  constructor(
    fighters: ResolvedFighter[],
    private readonly makeResolved: () => BattleTrace["resolved"]
  ) { super(fighters); }

  protected override applyStaticDescription(description: StaticProfileDescription): void {
    super.applyStaticDescription(description);
    this.staticDescription = description;
  }

  override startDamageJob(): DamageJobRecorder {
    return new FullDamageJobRecorder(this.staticApplied, this.staticDescription);
  }

  override recordSkillTriggerAttempt(skill: ResolvedSkill): void {
    this.incrementSkillReport(skill, "triggersSeen");
  }

  override recordScheduledDamageJob(job: DamageJob): void {
    this.roundJobs.push(job);
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
  private readonly appliedEffects: AppliedEffect[] = [];

  constructor(private readonly staticApplied?: StaticAppliedIndex) {}

  recordModifier(effect: ActiveEffect, valuePct: number): void {
    if (valuePct !== 0) this.appliedEffects.push(appliedEffectSummary(effect, valuePct));
  }
  recordRejected(_effect: ActiveEffect, _reason: RejectedEffectReason): void {}

  finish({ job, kills }: DamageRecordingResult): DamageResult {
    const statics = this.staticApplied;
    if (!statics) return { kills, appliedEffects: this.appliedEffects };
    const dealer = statics.dealer[job.dealerSide][job.dealerUnit];
    const taker = statics.taker[job.takerSide][job.takerUnit];
    return { kills, appliedEffects: [...this.appliedEffects, ...dealer, ...taker] };
  }
}

class FullDamageJobRecorder implements DamageJobRecorder {
  private readonly appliedEffects: DamageEquationTrace["appliedEffects"] = [];
  private readonly contributors: DamageBucketTrace["contributors"][] = Array.from(
    { length: DYNAMIC_BUCKETS.length },
    () => []
  );
  private readonly rejectedEffects: DamageEquationTrace["rejectedEffects"] = [];

  constructor(
    private readonly staticApplied?: StaticAppliedIndex,
    private readonly staticDescription?: StaticProfileDescription
  ) {}

  recordModifier(effect: ActiveEffect, valuePct: number): void {
    if (valuePct === 0) return;
    this.contributors[effect.bucketIndex]?.push({
      effectId: effectId(effect),
      source: sourceLabel(effect),
      sourceSide: effect.ownerSide,
      valuePct,
      bucket: effect.intent.type,
      sameEffectStacking: effect.sameEffectStacking
    });
    this.appliedEffects.push({
      kind: "modifier",
      effectId: effectId(effect),
      bucket: effect.intent.type,
      valuePct,
      source: sourceLabel(effect),
      sourceSide: effect.ownerSide,
      sameEffectStacking: effect.sameEffectStacking
    });
  }

  recordRejected(effect: ActiveEffect, reason: RejectedEffectReason): void {
    this.rejectedEffects.push({ effectId: effectId(effect), reason });
  }

  finish(result: DamageRecordingResult): DamageResult {
    const job = result.job;
    const appliedEffects = this.appliedEffectsFor(job);
    const staticEntries = this.staticDescription
      ? [this.staticDescription.dealer[job.dealerSide][job.dealerUnit], this.staticDescription.taker[job.takerSide][job.takerUnit]]
      : [];
    return {
      kills: result.kills,
      appliedEffects,
      trace: {
        roundStartTroops: {
          attacker: { ...job.roundStartTroops.attacker },
          defender: { ...job.roundStartTroops.defender }
        },
        armyTerm: result.armyTerm,
        atomicBuckets: toTraceBuckets(result.factors, this.contributors, staticEntries),
        aggregationGroups: buildAggregationGroups(job, result.factors, this.contributors, staticEntries),
        appliedEffects,
        rejectedEffects: this.rejectedEffects,
        rawDamage: result.rawDamage,
        finalKills: result.kills
      }
    };
  }

  // Dynamic modifiers first, then the prebuilt static passive fragments for the job's
  // participants — the same order the per-job walk used to produce.
  private appliedEffectsFor(job: DamageJob): AppliedModifierEffect[] {
    const statics = this.staticApplied;
    if (!statics) return this.appliedEffects;
    const dealer = statics.dealer[job.dealerSide][job.dealerUnit];
    const taker = statics.taker[job.takerSide][job.takerUnit];
    if (dealer.length === 0 && taker.length === 0) return this.appliedEffects;
    return [...this.appliedEffects, ...dealer, ...taker] as AppliedModifierEffect[];
  }
}

const DEFAULT_FACTOR_TERMS = DYNAMIC_BUCKETS.map((definition) => factorTerm(definition.name));
const DEFAULT_NUMERATOR_TERMS = DEFAULT_FACTOR_TERMS.filter((term) => term.placement === "numerator");
const DEFAULT_DENOMINATOR_TERMS = DEFAULT_FACTOR_TERMS.filter((term) => term.placement === "denominator");

function factorTerm(bucket: DynamicDamageBucket): DamageFactorTerm {
  const definition = dynamicBucketDefinition(bucket)!;
  return {
    id: bucket,
    bucket: DYNAMIC_BUCKET_INDEX[bucket],
    bucketName: bucket,
    placement: definition.placement,
    damageKind: "damageKind" in definition ? definition.damageKind : undefined
  };
}

function buildStaticProfileDescription(
  fighters: Record<SideId, ResolvedFighter>,
  setupEffects: ActiveEffect[],
  detailed: boolean
): StaticProfileDescription {
  const description: StaticProfileDescription = {
    dealer: {
      attacker: buildSideEntries(fighters.attacker, "dealer"),
      defender: buildSideEntries(fighters.defender, "dealer")
    },
    taker: {
      attacker: buildSideEntries(fighters.attacker, "taker"),
      defender: buildSideEntries(fighters.defender, "taker")
    }
  };
  for (const contribution of selectPassiveContributions(setupEffects)) {
    addPassiveTerm(description[contribution.jobSide][contribution.side][contribution.unit], contribution, detailed);
  }
  return description;
}

function buildSideEntries(fighter: ResolvedFighter, role: "dealer" | "taker"): Record<UnitType, StaticProfileEntry> {
  return Object.fromEntries(UNIT_TYPES.map((unit) => [unit, buildStaticEntry(fighter, unit, role)])) as Record<UnitType, StaticProfileEntry>;
}

function buildStaticEntry(fighter: ResolvedFighter, unit: UnitType, role: "dealer" | "taker"): StaticProfileEntry {
  if (fighter.initialTroops[unit] <= 0) return { buckets: {} };
  const stats = unitBaseStats(fighter, unit);
  const bonuses = unitPlayerBonuses(fighter, unit);
  const buckets: StaticProfileEntry["buckets"] = {};
  if (role === "dealer") {
    setRawTerm(buckets, "troops.baseAttack", stats.attack);
    setRawTerm(buckets, "troops.baseLethality", stats.lethality);
    setPlayerTerm(buckets, "player.attack", bonuses.attack);
    setPlayerTerm(buckets, "player.lethality", bonuses.lethality);
  } else {
    setRawTerm(buckets, "troops.baseHealth", stats.health);
    setRawTerm(buckets, "troops.baseDefense", stats.defense);
    setPlayerTerm(buckets, "player.health", bonuses.health);
    setPlayerTerm(buckets, "player.defense", bonuses.defense);
  }
  return { buckets };
}

function setRawTerm(buckets: StaticProfileEntry["buckets"], bucket: StaticRawBucket, raw: number): void {
  buckets[bucket] = { raw, factor: rawBucketFactor(raw), contributors: [] };
}

function setPlayerTerm(buckets: StaticProfileEntry["buckets"], bucket: StaticPlayerBucket, valuePct: number): void {
  buckets[bucket] = {
    totalPct: valuePct,
    factor: pctBucketFactor(valuePct),
    contributors: [{ effectId: `input:${bucket.slice("player.".length)}`, source: "input_stats", valuePct, bucket }]
  };
}

function addPassiveTerm(entry: StaticProfileEntry, contribution: PassiveContribution, detailed: boolean): void {
  const { bucket, effect, valuePct } = contribution;
  const contributor = {
    effectId: effectId(effect),
    source: detailed ? sourceLabel(effect) : "",
    sourceSide: effect.ownerSide,
    valuePct,
    bucket,
    ...(detailed ? { sameEffectStacking: effect.sameEffectStacking } : {})
  };
  const existing = entry.buckets[bucket];
  if (existing) {
    existing.totalPct = (existing.totalPct ?? 0) + valuePct;
    existing.factor = pctBucketFactor(existing.totalPct);
    existing.contributors.push(contributor);
  } else {
    entry.buckets[bucket] = { totalPct: valuePct, factor: pctBucketFactor(valuePct), contributors: [contributor] };
  }
}

function staticAppliedFragments(
  entries: Record<SideId, Record<UnitType, StaticProfileEntry>>,
  detailed: boolean
): Record<SideId, Record<UnitType, AppliedEffect[]>> {
  return Object.fromEntries(
    (Object.entries(entries) as Array<[SideId, Record<UnitType, StaticProfileEntry>]>).map(([side, units]) => [
      side,
      Object.fromEntries(
        (Object.entries(units) as Array<[UnitType, StaticProfileEntry]>).map(([unit, entry]) => [unit, passiveAppliedEffects(entry, detailed)])
      )
    ])
  ) as Record<SideId, Record<UnitType, AppliedEffect[]>>;
}

function passiveAppliedEffects(entry: StaticProfileEntry, detailed: boolean): AppliedEffect[] {
  const applied: AppliedEffect[] = [];
  for (const [bucket, term] of Object.entries(entry.buckets) as Array<[StaticDamageBucket, StaticProfileEntry["buckets"][StaticDamageBucket]]>) {
    if (!bucket.startsWith("passive.") || !term) continue;
    for (const contributor of term.contributors) {
      const summary = {
        effectId: contributor.effectId,
        bucket,
        valuePct: contributor.valuePct,
        sourceSide: contributor.sourceSide!
      };
      applied.push(detailed
        ? {
            ...summary,
            kind: "modifier",
            source: contributor.source,
            sameEffectStacking: contributor.sameEffectStacking ?? "add"
          }
        : summary);
    }
  }
  return applied;
}

function buildAggregationGroups(
  job: DamageJob,
  factors: Float64Array,
  contributors: DamageBucketTrace["contributors"][],
  staticEntries: StaticProfileEntry[]
): Record<string, DamageAggregationGroupTrace> {
  const groups: Record<string, DamageAggregationGroupTrace> = {};
  addStaticAggregationGroups(groups, staticEntries);
  for (const term of [...DEFAULT_NUMERATOR_TERMS, ...DEFAULT_DENOMINATOR_TERMS]) {
    if (term.damageKind && term.damageKind !== job.kind) continue;
    const definition = dynamicBucketDefinition(term.bucketName)!;
    const factor = factors[term.bucket];
    groups[term.id] = definition.update === "assign_factor"
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
  staticEntries: StaticProfileEntry[]
): void {
  const dealer = staticEntries[0];
  const taker = staticEntries[1];
  if (!dealer || !taker) return;
  addStaticRawGroup(groups, "troops.baseAttack", "numerator", dealer, "troops.baseAttack");
  addStaticRawGroup(groups, "troops.baseLethality", "numerator", dealer, "troops.baseLethality");
  addStaticPctGroup(groups, "player.dealer.attack", "numerator", dealer, "player.attack");
  addStaticPctGroup(groups, "player.dealer.lethality", "numerator", dealer, "player.lethality");
  addStaticPctGroup(groups, "passive.dealer.attack.up", "numerator", dealer, "passive.attack.up");
  addStaticPctGroup(groups, "passive.dealer.lethality.up", "numerator", dealer, "passive.lethality.up");
  addStaticPctGroup(groups, "passive.taker.health.down", "numerator", taker, "passive.health.down");
  addStaticPctGroup(groups, "passive.taker.defense.down", "numerator", taker, "passive.defense.down");
  addStaticRawGroup(groups, "troops.baseHealth", "denominator", taker, "troops.baseHealth");
  addStaticRawGroup(groups, "troops.baseDefense", "denominator", taker, "troops.baseDefense");
  addStaticPctGroup(groups, "player.taker.health", "denominator", taker, "player.health");
  addStaticPctGroup(groups, "player.taker.defense", "denominator", taker, "player.defense");
  addStaticPctGroup(groups, "passive.dealer.attack.down", "denominator", dealer, "passive.attack.down");
  addStaticPctGroup(groups, "passive.dealer.lethality.down", "denominator", dealer, "passive.lethality.down");
  addStaticPctGroup(groups, "passive.taker.health.up", "denominator", taker, "passive.health.up");
  addStaticPctGroup(groups, "passive.taker.defense.up", "denominator", taker, "passive.defense.up");
}

function addStaticRawGroup(
  groups: Record<string, DamageAggregationGroupTrace>,
  id: string,
  placement: GroupPlacement,
  entry: StaticProfileEntry,
  bucket: StaticDamageBucket
): void {
  const term = entry.buckets[bucket];
  groups[id] = {
    id,
    mode: "raw",
    placement,
    inputBuckets: [bucket],
    factor: term?.factor ?? 0,
    contributors: term?.contributors ?? []
  };
}

function addStaticPctGroup(
  groups: Record<string, DamageAggregationGroupTrace>,
  id: string,
  placement: GroupPlacement,
  entry: StaticProfileEntry,
  bucket: StaticDamageBucket
): void {
  const term = entry.buckets[bucket];
  groups[id] = {
    id,
    mode: "sum_pct",
    placement,
    inputBuckets: [bucket],
    totalPct: term?.totalPct ?? 0,
    factor: term?.factor ?? 1,
    contributors: term?.contributors ?? []
  };
}

function toTraceBuckets(
  factors: Float64Array,
  contributors: DamageBucketTrace["contributors"][],
  staticEntries: StaticProfileEntry[]
): Record<string, DamageBucketTrace> {
  const traced = Object.fromEntries(
    DYNAMIC_BUCKETS.map((definition, index) => {
      const bucket = definition.name;
      const factor = factors[index];
      const bucketContributors = contributors[index] ?? [];
      return definition.update === "assign_factor"
        ? [bucket, { raw: factor, factor, contributors: [...bucketContributors] }]
        : [bucket, { totalPct: pctFromFactor(factor), factor, contributors: [...bucketContributors] }];
    })
  ) as Record<string, DamageBucketTrace>;
  for (const entry of staticEntries) {
    for (const [bucket, term] of Object.entries(entry.buckets) as Array<[StaticDamageBucket, StaticProfileEntry["buckets"][StaticDamageBucket]]>) {
      if (!term) continue;
      traced[bucket] = term.raw !== undefined
        ? { raw: term.raw, factor: term.factor, contributors: [...term.contributors] }
        : { totalPct: term.totalPct ?? 0, factor: term.factor, contributors: [...term.contributors] };
    }
  }
  return traced;
}

function effectId(effect: ActiveEffect): string {
  return effect.source.effectId ?? effect.intent.id;
}

function appliedEffectSummary(effect: ActiveEffect, valuePct: number): AppliedEffect {
  return {
    effectId: effectId(effect),
    sourceSide: effect.ownerSide,
    bucket: effect.intent.type,
    valuePct
  };
}

function counterDeltas(
  attack: Pick<AttackIntent | DamageJob, "dealerSide" | "dealerUnit" | "takerSide" | "takerUnit">,
  cause: "normal_attack" | "extra_skill_attack"
): NonNullable<AttackOutcome["counterDeltas"]> {
  return [
    { side: attack.dealerSide, unit: attack.dealerUnit, counter: "attacks", by: 1, cause },
    { side: attack.takerSide, unit: attack.takerUnit, counter: "received_attacks", by: 1, cause }
  ];
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
