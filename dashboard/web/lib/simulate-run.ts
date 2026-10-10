import type { TroopCategory } from "@/lib/heroes-catalogue";
import type {
  OptimizeRankBy,
  OptimizeRatioResult,
  OptimizeSearchMode,
  OptimizeSide,
} from "@/lib/optimize-ratio";
import type {
  SurfaceSweepPayload,
  SurfaceSweepResult,
} from "@/lib/simulator/surface";
import type {
  TournamentRequestPayload,
  TournamentResult,
} from "@/lib/tournament";

export type { OptimizeRatioResult } from "@/lib/optimize-ratio";

export interface SimulateHeroPayload {
  name: string | null;
  skills: [number, number, number, number];
}

export interface SimulateJoinerPayload {
  name: string;
  skill_1: number;
}

export interface SimulateTroopRowPayload {
  id: string;
  unit: TroopCategory;
  tier: string;
  count: number;
}

export interface SimulateSidePayload {
  troops: Record<TroopCategory, number>;
  troop_types: Record<TroopCategory, string>;
  /** Exact imported troop lines; category totals/types remain the editable summary. */
  troop_composition?: Record<string, number>;
  troop_rows?: SimulateTroopRowPayload[];
  heroes: Record<TroopCategory, SimulateHeroPayload>;
  joiners: SimulateJoinerPayload[];
  stat_profile_name?: string | null;
  stat_modifiers?: SimulateStatModifiersPayload;
  pet_modifiers?: SimulatePetModifiersPayload;
  gareth?: number;
  stats: {
    inf: [number, number, number, number];
    lanc: [number, number, number, number];
    mark: [number, number, number, number];
  };
}

export interface SimulateStatModifiersPayload {
  attack: number;
  defense: number;
  lethality: number;
  health: number;
  enemy_attack: number;
  enemy_defense: number;
}

export interface SimulatePetModifiersPayload {
  attack: number;
  defense: number;
  lethality: number;
  health: number;
  enemy_defense: number;
  enemy_lethality: number;
  enemy_health: number;
}

export interface SimulateRequestPayload {
  attacker: SimulateSidePayload;
  defender: SimulateSidePayload;
  replicates: number;
  rally_mode: boolean;
  trace_seed?: number;
  source_report?: SimulationReportSource;
}

export interface SimulationReportSource {
  reference: string;
  report: unknown;
  raw_report_base64: string;
  warnings: string[];
}

export interface ReportImportFighter {
  name?: string;
  heroes?: Record<string, Record<string, number>>;
  troops?: Record<string, number>;
  stats?: Partial<Record<
    "infantry" | "lancer" | "marksman",
    Partial<Record<"attack" | "defense" | "lethality" | "health", number>>
  >>;
  joiner_heroes?: Array<{ name: string; levels: Record<string, number> }> | Record<string, never>;
}

export interface ReportImportRequest {
  report_import: { attacker: ReportImportFighter; defender: ReportImportFighter };
  replicates: number;
  rally_mode: boolean;
  source_report: SimulationReportSource;
}

export const DEFAULT_REPORT_REPLICATES = 1000;

function isNumberRecord(value: unknown): value is Record<string, number> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "number" && Number.isFinite(entry));
}

function isReportImportFighter(value: unknown): value is ReportImportFighter {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fighter = value as Partial<ReportImportFighter>;
  if (fighter.name !== undefined && typeof fighter.name !== "string") return false;
  if (!isNumberRecord(fighter.troops) || !Object.values(fighter.troops).some((count) => count >= 1)) return false;
  if (!Object.values(fighter.troops).every((count) => Number.isSafeInteger(count) && count >= 0)) return false;
  if (fighter.heroes !== undefined && (
    !fighter.heroes || typeof fighter.heroes !== "object" || Array.isArray(fighter.heroes) ||
    !Object.values(fighter.heroes).every(isNumberRecord)
  )) return false;
  if (fighter.stats !== undefined) {
    if (!fighter.stats || typeof fighter.stats !== "object" || Array.isArray(fighter.stats) ||
      !Object.entries(fighter.stats).every(([category, stats]) =>
        ["infantry", "lancer", "marksman"].includes(category) && isNumberRecord(stats) &&
        Object.keys(stats).every((stat) => ["attack", "defense", "lethality", "health"].includes(stat)),
      )) return false;
  }
  if (fighter.joiner_heroes !== undefined) {
    if (Array.isArray(fighter.joiner_heroes)) {
      if (!fighter.joiner_heroes.every((hero) => hero && typeof hero === "object" &&
        typeof hero.name === "string" && isNumberRecord(hero.levels))) return false;
    } else if (!fighter.joiner_heroes || typeof fighter.joiner_heroes !== "object" ||
      Object.keys(fighter.joiner_heroes).length !== 0) {
      return false;
    }
  }
  return true;
}

export function isReportImportRequest(value: unknown): value is ReportImportRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Partial<ReportImportRequest>;
  const imported = request.report_import;
  const source = request.source_report;
  return !!imported && typeof imported === "object" && !Array.isArray(imported) &&
    isReportImportFighter(imported.attacker) && isReportImportFighter(imported.defender) &&
    typeof request.replicates === "number" && Number.isInteger(request.replicates) &&
    request.replicates >= 1 && request.replicates <= 5000 &&
    typeof request.rally_mode === "boolean" &&
    !!source && typeof source === "object" && !Array.isArray(source) &&
    typeof source.reference === "string" && source.reference.trim().length > 0 &&
    source.report !== undefined && typeof source.raw_report_base64 === "string" &&
    Array.isArray(source.warnings) && source.warnings.every((warning) => typeof warning === "string");
}

export interface SimulateSkillSummary {
  name: string;
  avg_activations: number;
  avg_kills: number;
}

export interface SimulateOutcomeRun {
  outcome: number;
  seed: string | number;
  winner?: "attacker" | "defender" | "draw";
  survivors?: {
    attacker: number;
    defender: number;
  };
}

export type SimulateTraceUnit = "inf" | "lanc" | "mark";

export interface SimulateTraceEffect {
  id: string;
  hero: string;
  skill_name: string;
  effect_name: string;
  effect_type: string;
  benefit_on: string;
  extra_attack: boolean;
  used: boolean;
  uses_count: number;
  trigger_count: number;
  value: number;
  for_units: SimulateTraceUnit[];
  vs_units: SimulateTraceUnit[];
}

export interface SimulateTraceSideRound {
  troops: Record<SimulateTraceUnit, number>;
  kills: Record<SimulateTraceUnit, Record<SimulateTraceUnit, number>>;
  effects: SimulateTraceEffect[];
}

export interface SimulateTraceRound {
  round: number;
  attacker: SimulateTraceSideRound;
  defender: SimulateTraceSideRound;
}

export interface SimulateTrace {
  seed: string | number;
  outcome: number;
  winner?: "attacker" | "defender" | "draw";
  survivors?: {
    attacker: number;
    defender: number;
  };
  rounds: SimulateTraceRound[];
  skill_kills: Record<"attacker" | "defender", Record<string, Record<string, { triggers: number; kills: number }>>>;
  effect_usage: Record<"attacker" | "defender", Record<string, Record<string, number>>>;
  total_kills: Record<
    "attacker" | "defender",
    Record<SimulateTraceUnit, Record<SimulateTraceUnit, number>>
  >;
}

export interface SimulateApiResult {
  replicates: number;
  summary: {
    mean: number;
    std: number;
    best: {
      value: number;
      winner: "attacker" | "defender" | "draw";
      survivors?: { attacker: number; defender: number };
    };
    worst: {
      value: number;
      winner: "attacker" | "defender" | "draw";
      survivors?: { attacker: number; defender: number };
    };
    attacker_win_rate: number;
    draw_rate?: number;
    mean_survivors?: {
      attacker: number;
      defender: number;
    };
    avg_rounds?: number;
    avg_skill_activations: number;
    avg_skill_kills: number;
    avg_attacker_activations: number;
    avg_defender_activations: number;
    avg_attacker_kills: number;
    avg_defender_kills: number;
  };
  outcomes: number[];
  outcome_runs?: SimulateOutcomeRun[];
  trace?: SimulateTrace;
  per_side_skills: {
    attacker: SimulateSkillSummary[];
    defender: SimulateSkillSummary[];
  };
}

export interface BearSimRequestPayload {
  player: SimulateSidePayload;
  replicates: number;
  trace_seed?: number;
}

export interface BearScoreRun {
  score: number;
  seed: string | number;
}

export interface BearSimResult {
  replicates: number;
  summary: {
    mean: number;
    std: number;
    best: { value: number };
    worst: { value: number };
    avg_skill_activations: number;
    avg_skill_damage: number;
  };
  scores: number[];
  score_runs?: BearScoreRun[];
  trace?: SimulateTrace;
  skills: SimulateSkillSummary[];
}

export interface BearOptimizeRatioPoint {
  infantry_count: number;
  lancer_count: number;
  marksman_count: number;
  infantry_pct: number;
  lancer_pct: number;
  marksman_pct: number;
  avg_score: number;
  score_std?: number;
  rank?: number;
  is_best?: boolean;
  search_phase?: "coarse" | "local" | "finalist" | "grid";
  phase_replicates?: number;
}

export interface BearOptimizeRatioResult {
  total_troops: number;
  search_mode?: OptimizeSearchMode;
  grid_step: number;
  compositions_tested: number;
  projected_battles: number;
  replicates_per_ratio: number;
  infantry_min_pct: number;
  infantry_max_pct: number;
  phase_counts?: Partial<
    Record<"phase1" | "phase2" | "finalists" | "grid", number>
  >;
  best: BearOptimizeRatioPoint;
  top_results: BearOptimizeRatioPoint[];
  points: BearOptimizeRatioPoint[];
}

export interface BearOptimizeRatioRequestPayload extends BearSimRequestPayload {
  grid_step: number;
  search_replicates: number;
  infantry_min_pct: number;
  infantry_max_pct: number;
  top_n: number;
  search_mode?: OptimizeSearchMode;
}

export interface OptimizeRatioRequestPayload
  extends Omit<SimulateRequestPayload, "replicates"> {
  replicates?: number;
  grid_step: number;
  search_replicates: number;
  adaptive_phase1_replicates?: number;
  adaptive_phase2_replicates?: number;
  adaptive_final_replicates?: number;
  infantry_min_pct: number;
  infantry_max_pct: number;
  top_n: number;
  search_mode?: OptimizeSearchMode;
  optimize_side?: OptimizeSide;
  rank_by?: OptimizeRankBy;
}

export type SavedSimulationKind =
  | "simulate"
  | "optimize_ratio"
  | "bear_simulate"
  | "bear_optimize_ratio"
  | "ratio_explorer"
  | "tournament";

export interface SimulationSaveMeta {
  saved_run_id: string;
  saved_at: string;
  saved_kind: SavedSimulationKind;
  share_url: string;
}

export type SimulateApiResponse = SimulateApiResult & SimulationSaveMeta;
export type OptimizeRatioApiResponse = OptimizeRatioResult & SimulationSaveMeta;
export type BearSimApiResponse = BearSimResult & SimulationSaveMeta;
export type BearOptimizeRatioApiResponse = BearOptimizeRatioResult & SimulationSaveMeta;
export type SurfaceSweepApiResponse = SurfaceSweepResult & SimulationSaveMeta;

export type SavedSimulationRequest =
  | SimulateRequestPayload
  | ReportImportRequest
  | OptimizeRatioRequestPayload
  | BearSimRequestPayload
  | BearOptimizeRatioRequestPayload
  | SurfaceSweepPayload
  | TournamentRequestPayload;

export type SavedSimulationResult =
  | SimulateApiResult
  | OptimizeRatioResult
  | BearSimResult
  | BearOptimizeRatioResult
  | SurfaceSweepResult
  | TournamentResult;

interface SavedSimulationRunIdentity {
  version: 1;
  id: string;
  created_at: string;
  kept?: boolean;
}

export type PendingReportSimulationRunDocument = SavedSimulationRunIdentity & {
  kind: "simulate";
  request: ReportImportRequest;
  result: null;
};

export type SavedSimulationRunDocument = SavedSimulationRunIdentity & (
  | { kind: SavedSimulationKind; request: SavedSimulationRequest; result: SavedSimulationResult }
  | { kind: "simulate"; request: ReportImportRequest; result: null }
);

export type SavedSimulationRunResponse = SavedSimulationRunDocument & { share_url: string };

export function isPendingReportSimulation(value: unknown): value is PendingReportSimulationRunDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const doc = value as Partial<PendingReportSimulationRunDocument>;
  return doc.version === 1 && typeof doc.id === "string" && typeof doc.created_at === "string" &&
    doc.kind === "simulate" && doc.result === null && isReportImportRequest(doc.request);
}

export interface SavedSimulationRunListItem {
  id: string;
  kind: SavedSimulationKind;
  created_at: string;
  kept: boolean;
  share_url: string;
  title: string;
}

const CATEGORIES: TroopCategory[] = ["infantry", "lancer", "marksman"];
export const PVP_SAVED_RUN_KINDS = ["simulate", "optimize_ratio", "ratio_explorer"] as const satisfies readonly SavedSimulationKind[];
export const BEAR_SAVED_RUN_KINDS = ["bear_simulate", "bear_optimize_ratio"] as const satisfies readonly SavedSimulationKind[];
export const TOURNAMENT_SAVED_RUN_KINDS = ["tournament"] as const satisfies readonly SavedSimulationKind[];
export const ALL_SAVED_RUN_KINDS = [...PVP_SAVED_RUN_KINDS, ...BEAR_SAVED_RUN_KINDS, ...TOURNAMENT_SAVED_RUN_KINDS] as const satisfies readonly SavedSimulationKind[];

export function isSavedSimulationKind(value: unknown): value is SavedSimulationKind {
  return typeof value === "string" && (ALL_SAVED_RUN_KINDS as readonly string[]).includes(value);
}

export function isBearSavedSimulationKind(kind: SavedSimulationKind): boolean {
  return kind === "bear_simulate" || kind === "bear_optimize_ratio";
}

export function isPvpSavedSimulationKind(kind: SavedSimulationKind): boolean {
  return kind === "simulate" || kind === "optimize_ratio" || kind === "ratio_explorer";
}

export function isRatioExplorerSavedSimulationKind(kind: SavedSimulationKind): boolean {
  return kind === "ratio_explorer";
}

export function isTournamentSavedSimulationKind(kind: SavedSimulationKind): boolean {
  return kind === "tournament";
}

export function buildSimulationShareUrl(id: string, kind: SavedSimulationKind = "simulate"): string {
  const path = isBearSavedSimulationKind(kind)
    ? "/bear"
    : isTournamentSavedSimulationKind(kind)
      ? "/tournament"
      : "/simulate";
  return `${path}?run=${encodeURIComponent(id)}`;
}

function heroName(name: string | null | undefined): string {
  if (!name) return "None";
  return name === "WuMing" ? "Wu Ming" : name;
}

function sideHeroes(side: SimulateSidePayload): string {
  return CATEGORIES.map((cat) => heroName(side.heroes?.[cat]?.name)).join("/");
}

function sideRatio(side: SimulateSidePayload): string {
  const counts = CATEGORIES.map((cat) => Math.max(0, side.troops?.[cat] ?? 0));
  const total = counts.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return "0-0-0";
  let remaining = 100;
  return counts
    .map((count, index) => {
      if (index === counts.length - 1) return remaining;
      const pct = Math.round((count / total) * 100);
      remaining -= pct;
      return pct;
    })
    .join("-");
}

export function buildSimulationRunTitle(
  request: SavedSimulationRequest,
  kind: SavedSimulationKind = "simulate",
): string {
  if (isReportImportRequest(request)) {
    const { attacker, defender } = request.report_import;
    const fighterLabel = (fighter: ReportImportFighter, fallback: string) =>
      fighter.name?.trim() || Object.keys(fighter.heroes ?? {}).map(heroName).join("/") || fallback;
    return `${fighterLabel(attacker, "Attacker")} vs ${fighterLabel(defender, "Defender")}`;
  }
  if (isTournamentSavedSimulationKind(kind) && "groups" in request) {
    const labels = request.groups
      .map((group) => group.label.trim())
      .filter(Boolean);
    const groupLabel = labels.length > 0
      ? labels.slice(0, 2).join(" + ")
      : `${request.groups.length} ${request.groups.length === 1 ? "batch" : "batches"}`;
    return `Tournament: ${groupLabel} (${request.rounds} rounds)`;
  }
  if (isBearSavedSimulationKind(kind) && "player" in request) {
    return `Bear: ${sideHeroes(request.player)} (${sideRatio(request.player)})`;
  }
  if (isRatioExplorerSavedSimulationKind(kind) && "pointsPerEdge" in request) {
    return `Ratio Explorer: ${sideHeroes(request.attacker)} vs ${sideHeroes(request.defender)} (${request.pointsPerEdge}-point)`;
  }
  const pvpRequest = request as SimulateRequestPayload | OptimizeRatioRequestPayload;
  return `${sideHeroes(pvpRequest.attacker)} (${sideRatio(
    pvpRequest.attacker,
  )}) vs ${sideHeroes(pvpRequest.defender)} (${sideRatio(pvpRequest.defender)})`;
}
