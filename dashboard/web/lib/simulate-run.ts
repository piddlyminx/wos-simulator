import type { TroopCategory } from "@/lib/heroes-catalogue";
import type {
  OptimizeRatioResult,
  OptimizeSearchMode,
  OptimizeSide,
} from "@/lib/optimize-ratio";

export type { OptimizeRatioResult } from "@/lib/optimize-ratio";

export interface SimulateHeroPayload {
  name: string | null;
  skills: [number, number, number, number];
}

export interface SimulateJoinerPayload {
  name: string;
  skill_1: number;
}

export interface SimulateSidePayload {
  troops: Record<TroopCategory, number>;
  troop_types: Record<TroopCategory, string>;
  heroes: Record<TroopCategory, SimulateHeroPayload>;
  joiners: SimulateJoinerPayload[];
  stat_profile_name?: string | null;
  stat_modifiers?: SimulateStatModifiersPayload;
  pet_modifiers?: SimulatePetModifiersPayload;
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
}

export interface SimulateSkillSummary {
  name: string;
  avg_activations: number;
  avg_kills: number;
}

export interface SimulateApiResult {
  replicates: number;
  summary: {
    mean: number;
    std: number;
    best: { value: number; winner: "attacker" | "defender" | "draw" };
    worst: { value: number; winner: "attacker" | "defender" | "draw" };
    attacker_win_rate: number;
    avg_skill_activations: number;
    avg_skill_kills: number;
    avg_attacker_activations: number;
    avg_defender_activations: number;
    avg_attacker_kills: number;
    avg_defender_kills: number;
  };
  outcomes: number[];
  per_side_skills: {
    attacker: SimulateSkillSummary[];
    defender: SimulateSkillSummary[];
  };
}

export interface OptimizeRatioRequestPayload extends SimulateRequestPayload {
  grid_step: number;
  search_replicates: number;
  infantry_min_pct: number;
  infantry_max_pct: number;
  top_n: number;
  search_mode?: OptimizeSearchMode;
  optimize_side?: OptimizeSide;
}

export type SavedSimulationKind = "simulate" | "optimize_ratio";

export interface SimulationSaveMeta {
  saved_run_id: string;
  saved_at: string;
  saved_kind: SavedSimulationKind;
  share_url: string;
}

export type SimulateApiResponse = SimulateApiResult & SimulationSaveMeta;
export type OptimizeRatioApiResponse = OptimizeRatioResult & SimulationSaveMeta;

export type SavedSimulationRequest =
  | SimulateRequestPayload
  | OptimizeRatioRequestPayload;

export type SavedSimulationResult = SimulateApiResult | OptimizeRatioResult;

export interface SavedSimulationRunDocument {
  version: 1;
  id: string;
  kind: SavedSimulationKind;
  created_at: string;
  request: SavedSimulationRequest;
  result: SavedSimulationResult;
}

export interface SavedSimulationRunResponse extends SavedSimulationRunDocument {
  share_url: string;
}

export interface SavedSimulationRunListItem {
  id: string;
  kind: SavedSimulationKind;
  created_at: string;
  share_url: string;
  title: string;
}

const CATEGORIES: TroopCategory[] = ["infantry", "lancer", "marksman"];

export function buildSimulationShareUrl(id: string): string {
  return `/simulate?run=${encodeURIComponent(id)}`;
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
): string {
  return `${sideHeroes(request.attacker)} (${sideRatio(
    request.attacker,
  )}) vs ${sideHeroes(request.defender)} (${sideRatio(request.defender)})`;
}
