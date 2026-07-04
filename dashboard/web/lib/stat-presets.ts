import type { TroopCategory } from "@/lib/heroes-catalogue";

export const STAT_PRESET_CATEGORIES: TroopCategory[] = [
  "infantry",
  "lancer",
  "marksman",
];
export const STAT_PRESET_NAMES = [
  "attack",
  "defense",
  "lethality",
  "health",
] as const;

export type StatPresetName = (typeof STAT_PRESET_NAMES)[number];
export type StatPresetValues = Record<
  TroopCategory,
  Record<StatPresetName, number>
>;

export interface PlayerStatPreset {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  stats: StatPresetValues;
}

const ID_RE = /^[A-Za-z0-9_-]{8,128}$/;
export const MAX_STAT_PRESETS = 200;
export const MAX_STAT_PRESET_NAME_LENGTH = 80;
export const STAT_PRESETS_STORAGE_KEY = "wos-simulator.player-stat-presets.v1";

function nowIso(): string {
  return new Date().toISOString();
}

export function cleanStatPresetName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_STAT_PRESET_NAME_LENGTH);
}

export function normalizeStatPresetStats(value: unknown): StatPresetValues {
  if (!value || typeof value !== "object") {
    throw new Error("Preset stats are required");
  }
  const input = value as Partial<
    Record<TroopCategory, Partial<Record<StatPresetName, unknown>>>
  >;
  const out = {} as StatPresetValues;
  for (const cat of STAT_PRESET_CATEGORIES) {
    const row = input[cat];
    if (!row || typeof row !== "object") {
      throw new Error(`Preset stats are missing ${cat}`);
    }
    out[cat] = {} as Record<StatPresetName, number>;
    for (const stat of STAT_PRESET_NAMES) {
      const n = Number(row[stat]);
      if (!Number.isFinite(n)) {
        throw new Error(`Preset stat ${cat}.${stat} must be numeric`);
      }
      out[cat][stat] = Math.round(n * 100) / 100;
    }
  }
  return out;
}

export function normalizePlayerStatPreset(value: unknown): PlayerStatPreset {
  if (!value || typeof value !== "object") {
    throw new Error("Preset entry is malformed");
  }
  const input = value as Partial<PlayerStatPreset>;
  if (typeof input.id !== "string" || !ID_RE.test(input.id)) {
    throw new Error("Preset entry has an invalid id");
  }
  const id = input.id;
  const name = cleanStatPresetName(input.name) || "Untitled preset";
  const createdAt =
    typeof input.created_at === "string" ? input.created_at : nowIso();
  const updatedAt =
    typeof input.updated_at === "string" ? input.updated_at : createdAt;
  return {
    id,
    name,
    created_at: createdAt,
    updated_at: updatedAt,
    stats: normalizeStatPresetStats(input.stats),
  };
}

export function sortPlayerStatPresets(
  presets: PlayerStatPreset[],
): PlayerStatPreset[] {
  return [...presets].sort((a, b) =>
    b.updated_at.localeCompare(a.updated_at),
  );
}

export function newStatPresetId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `preset-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

export function loadLocalStatPresets(): PlayerStatPreset[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(STAT_PRESETS_STORAGE_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Preset store must be an array");
  }
  return sortPlayerStatPresets(parsed.map(normalizePlayerStatPreset));
}

export function saveLocalStatPresets(presets: PlayerStatPreset[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    STAT_PRESETS_STORAGE_KEY,
    JSON.stringify(sortPlayerStatPresets(presets)),
  );
}
