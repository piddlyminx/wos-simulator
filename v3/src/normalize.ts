import type { StatBlock, UnitType } from "./types";

export type StatBlockInput = Record<string, unknown> | readonly unknown[];

export function normalizeUnitType(value: string): UnitType {
  const normalized = value.toLowerCase().replace(/[\s_-]/g, "");
  if (["inf", "infantry"].includes(normalized)) return "infantry";
  if (["lanc", "lancer", "lancers"].includes(normalized)) return "lancer";
  if (["mark", "marksman", "marksmen", "marks"].includes(normalized)) return "marksman";
  throw new Error(`Unsupported unit type: ${value}`);
}

export function normalizeStatBlock(input: StatBlockInput | undefined): StatBlock {
  return {
    attack: numberField(input, "attack", "Attack", 0),
    defense: numberField(input, "defense", "Defense", 1),
    lethality: numberField(input, "lethality", "Lethality", 2),
    health: numberField(input, "health", "Health", 3)
  };
}

export function zeroStats(): StatBlock {
  return { attack: 0, defense: 0, lethality: 0, health: 0 };
}

export function addStats(a: StatBlock, b: Partial<StatBlock>): StatBlock {
  return {
    attack: a.attack + (b.attack ?? 0),
    defense: a.defense + (b.defense ?? 0),
    lethality: a.lethality + (b.lethality ?? 0),
    health: a.health + (b.health ?? 0)
  };
}

export function numberField(input: StatBlockInput | undefined, ...keys: Array<string | number>): number {
  if (!input) return 0;
  for (const key of keys) {
    const value = Array.isArray(input) ? (typeof key === "number" ? input[key] : undefined) : valueForObjectKey(input as Record<string, unknown>, key);
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

function valueForObjectKey(input: Record<string, unknown>, key: string | number): unknown {
  return typeof key === "string" ? input[key] : undefined;
}

export function valueAtLevel(value: unknown, level: number): number | string[] {
  if (Array.isArray(value)) {
    const index = Math.max(0, Math.min(value.length - 1, level - 1));
    const selected = value[index];
    if (typeof selected === "number") return selected;
    if (Array.isArray(selected)) return selected.map(String);
    return Number(selected) || 0;
  }
  if (typeof value === "number") return value;
  if (Array.isArray(value)) return value.map(String);
  return Number(value) || 0;
}
