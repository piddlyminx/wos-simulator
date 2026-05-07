import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

import { withDirectoryLock } from "@/lib/file-lock";
import type { TroopCategory } from "@/lib/heroes-catalogue";
import { resolveRuntimeStoreDir } from "@/lib/simulator-root";

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
const MAX_PRESETS = 200;
const MAX_NAME_LENGTH = 80;

export function resolveStatPresetsFile(): string {
  return process.env.STAT_PRESETS_FILE
    ? path.resolve(process.env.STAT_PRESETS_FILE)
    : path.join(resolveRuntimeStoreDir(), "player-stat-presets.json");
}

export const STAT_PRESETS_FILE = resolveStatPresetsFile();

function statPresetFileCandidates(): string[] {
  const candidates = [STAT_PRESETS_FILE];
  if (!process.env.STAT_PRESETS_FILE) {
    candidates.push(
      path.join(resolveRuntimeStoreDir(), "..", "player-stat-presets.json"),
      path.resolve(process.cwd(), "../../tmp/player-stat-presets.json"),
      "/tmp/player-stat-presets.json",
    );
  }
  return [...new Set(candidates.map((p) => path.resolve(p)))];
}

function nowIso(): string {
  return new Date().toISOString();
}

function cleanName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_NAME_LENGTH);
}

function normalizeStats(value: unknown): StatPresetValues {
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

function normalizePreset(value: unknown): PlayerStatPreset {
  if (!value || typeof value !== "object") {
    throw new Error("Preset entry is malformed");
  }
  const input = value as Partial<PlayerStatPreset>;
  const id = typeof input.id === "string" && ID_RE.test(input.id)
    ? input.id
    : randomUUID();
  const name = cleanName(input.name) || "Untitled preset";
  const createdAt =
    typeof input.created_at === "string" ? input.created_at : nowIso();
  const updatedAt =
    typeof input.updated_at === "string" ? input.updated_at : createdAt;
  return {
    id,
    name,
    created_at: createdAt,
    updated_at: updatedAt,
    stats: normalizeStats(input.stats),
  };
}

async function ensureStoreDir(): Promise<void> {
  await fs.mkdir(path.dirname(STAT_PRESETS_FILE), { recursive: true });
}

async function withPresetStoreLock<T>(action: () => Promise<T>): Promise<T> {
  await ensureStoreDir();
  return withDirectoryLock(path.dirname(STAT_PRESETS_FILE), action);
}

async function readAll(): Promise<PlayerStatPreset[]> {
  for (const filePath of statPresetFileCandidates()) {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error("Preset store must be an array");
      }
      return parsed.map(normalizePreset).sort((a, b) =>
        b.updated_at.localeCompare(a.updated_at),
      );
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr?.code === "ENOENT") {
        continue;
      }
      throw err;
    }
  }
  return [];
}

async function writeAll(presets: PlayerStatPreset[]): Promise<void> {
  await ensureStoreDir();
  const sorted = [...presets].sort((a, b) =>
    b.updated_at.localeCompare(a.updated_at),
  );
  const tmp = `${STAT_PRESETS_FILE}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
  await fs.rename(tmp, STAT_PRESETS_FILE);
}

export async function listPlayerStatPresets(): Promise<PlayerStatPreset[]> {
  return withPresetStoreLock(readAll);
}

export async function savePlayerStatPreset(input: {
  name: unknown;
  stats: unknown;
}): Promise<PlayerStatPreset> {
  return withPresetStoreLock(async () => {
    const presets = await readAll();
    if (presets.length >= MAX_PRESETS) {
      throw new Error(`Preset limit reached (${MAX_PRESETS})`);
    }
    const timestamp = nowIso();
    const preset: PlayerStatPreset = {
      id: randomUUID(),
      name: cleanName(input.name) || `Preset ${presets.length + 1}`,
      created_at: timestamp,
      updated_at: timestamp,
      stats: normalizeStats(input.stats),
    };
    await writeAll([preset, ...presets]);
    return preset;
  });
}

export async function updatePlayerStatPreset(
  id: string,
  input: { name?: unknown; stats: unknown },
): Promise<PlayerStatPreset> {
  if (!ID_RE.test(id)) {
    throw new Error("Invalid preset id");
  }
  return withPresetStoreLock(async () => {
    const presets = await readAll();
    const index = presets.findIndex((p) => p.id === id);
    if (index < 0) {
      throw new Error(`No stat preset found for ${id}`);
    }
    const current = presets[index];
    const updated: PlayerStatPreset = {
      ...current,
      name: cleanName(input.name) || current.name,
      updated_at: nowIso(),
      stats: normalizeStats(input.stats),
    };
    presets[index] = updated;
    await writeAll(presets);
    return updated;
  });
}
