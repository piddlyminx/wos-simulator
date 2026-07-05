import type {
  AppliedEffect,
  AttackIntent,
  AttackOutcome,
  BattleTrace,
  DamageJob,
  SideId,
  SkillReportEntry,
  SimulationMode
} from "./types";
import type { DamageResult } from "./damage";

/**
 * Observes a battle and accumulates whatever the chosen mode needs to report. The battle loop
 * does all simulation-affecting work itself (kills, counters, effect usage charging); the recorder
 * only records, so swapping recorders never changes the outcome. This keeps a single, linear
 * loop with no `if (mode === ...)` branches scattered through it.
 *
 * - fast     -> NULL_RECORDER: records nothing; zero per-attack allocation.
 * - standard -> RecordingRecorder: per-attack AttackOutcome[] (no equation traces).
 * - trace    -> RecordingRecorder + capturesTrace: outcomes with traces + per-round trace.
 */
export interface BattleRecorder {
  /** When true the loop asks calculateDamageJob to capture (expensive) per-bucket trace detail. */
  readonly capturesTrace: boolean;
  recordCancelled(intent: AttackIntent, effectId: string, reason: "dodge" | "no_attack", appliedEffects: AppliedEffect[]): void;
  recordDamageJob(job: DamageJob, result: DamageResult, extraAppliedEffects?: AppliedEffect[]): void;
  recordRound(round: number, roundStartTroops: DamageJob["roundStartTroops"], intents: AttackIntent[], jobs: DamageJob[]): void;
  readonly attacks: AttackOutcome[];
  readonly trace: BattleTrace | undefined;
}

const NO_ATTACKS: AttackOutcome[] = [];
const NO_APPLIED_EFFECTS: AppliedEffect[] = [];

export const NULL_RECORDER: BattleRecorder = {
  capturesTrace: false,
  recordCancelled() {},
  recordDamageJob() {},
  recordRound() {},
  attacks: NO_ATTACKS,
  trace: undefined
};

export function createRecorder(
  mode: SimulationMode,
  skillReports: Record<SideId, Map<string, SkillReportEntry>>,
  makeResolved: () => BattleTrace["resolved"]
): BattleRecorder {
  if (mode === "fast") return NULL_RECORDER;
  return new RecordingRecorder(skillReports, mode === "trace" ? { resolved: makeResolved(), rounds: [] } : undefined);
}

class RecordingRecorder implements BattleRecorder {
  readonly attacks: AttackOutcome[] = [];
  readonly trace: BattleTrace | undefined;
  readonly capturesTrace: boolean;

  constructor(
    private readonly skillReports: Record<SideId, Map<string, SkillReportEntry>>,
    trace: BattleTrace | undefined
  ) {
    this.trace = trace;
    this.capturesTrace = trace !== undefined;
  }

  recordCancelled(intent: AttackIntent, effectId: string, reason: "dodge" | "no_attack", appliedEffects: AppliedEffect[]): void {
    this.attacks.push({
      jobId: `${intent.id}:cancelled`,
      kind: "normal",
      attackerSide: intent.attackerSide,
      attackerUnit: intent.attackerUnit,
      defenderSide: intent.defenderSide,
      defenderUnit: intent.defenderUnit,
      kills: 0,
      counterDeltas: [
        { side: intent.attackerSide, unit: intent.attackerUnit, counter: "attacks", by: 1, cause: "normal_attack" },
        { side: intent.defenderSide, unit: intent.defenderUnit, counter: "received_attacks", by: 1, cause: "normal_attack" }
      ],
      appliedEffects,
      cancelledBy: effectId,
      cancelReason: reason
    });
  }

  recordDamageJob(job: DamageJob, result: DamageResult, extraAppliedEffects?: AppliedEffect[]): void {
    if (job.kind === "skill" && job.sourceSkillReportKey && result.kills > 0) {
      const report = this.skillReports[job.attackerSide].get(job.sourceSkillReportKey);
      if (report) report.skillKills += result.kills;
    }
    const cause = job.kind === "skill" ? "extra_skill_attack" : "normal_attack";
    this.attacks.push({
      jobId: job.id,
      kind: job.kind,
      sourceEffectId: job.sourceEffectId,
      sourceSkillReportKey: job.sourceSkillReportKey,
      attackerSide: job.attackerSide,
      attackerUnit: job.attackerUnit,
      defenderSide: job.defenderSide,
      defenderUnit: job.defenderUnit,
      kills: result.kills,
      counterDeltas: [
        { side: job.attackerSide, unit: job.attackerUnit, counter: "attacks", by: 1, cause },
        { side: job.defenderSide, unit: job.defenderUnit, counter: "received_attacks", by: 1, cause }
      ],
      appliedEffects: mergeAppliedEffects(result.appliedEffects, extraAppliedEffects),
      trace: result.trace
    });
  }

  recordRound(round: number, roundStartTroops: DamageJob["roundStartTroops"], intents: AttackIntent[], jobs: DamageJob[]): void {
    this.trace?.rounds.push({ round, roundStartTroops, intents, jobs });
  }
}

function mergeAppliedEffects(applied: AppliedEffect[] | undefined, extra: AppliedEffect[] | undefined): AppliedEffect[] {
  if (!applied?.length) return extra?.length ? extra : NO_APPLIED_EFFECTS;
  if (!extra?.length) return applied;
  return [...applied, ...extra];
}
