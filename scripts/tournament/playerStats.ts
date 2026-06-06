import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { normalizeStatBlock, normalizeUnitType, type StatBlockInput } from "../../simulator/src/normalize";
import { UNIT_TYPES, type StatBlock, type UnitType } from "../../simulator/src/types";

export type PlayerStats = Record<UnitType, StatBlock>;

export function loadPlayerStatsProfile(profileName: string, filePath = resolveDefaultPlayerStatsPath()): PlayerStats {
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  if (!isRecord(raw)) throw new Error(`Player stats file must contain an object: ${filePath}`);
  const profile = raw[profileName];
  if (!profile) throw new Error(`Unknown player stats profile ${profileName} in ${filePath}`);
  return normalizePlayerStatsProfile(profile);
}

export function normalizePlayerStatsProfile(profile: unknown): PlayerStats {
  if (!isRecord(profile)) throw new Error("Player stats profile must be an object");
  const stats: Partial<PlayerStats> = {};

  for (const [unitName, rawBlock] of Object.entries(profile)) {
    const unit = normalizeUnitType(unitName);
    stats[unit] = normalizeStatBlock(rawBlock as StatBlockInput);
  }

  for (const unit of UNIT_TYPES) {
    if (!stats[unit]) throw new Error(`Player stats profile is missing ${unit}`);
  }

  return stats as PlayerStats;
}

function resolveDefaultPlayerStatsPath(): string {
  const candidates = [
    join(process.cwd(), "shared", "fighters_data", "fighters_stats.json"),
    join(process.cwd(), "..", "shared", "fighters_data", "fighters_stats.json"),
    join(process.cwd(), "..", "..", "shared", "fighters_data", "fighters_stats.json")
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`Could not find shared/fighters_data/fighters_stats.json from ${process.cwd()}`);
  return found;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
