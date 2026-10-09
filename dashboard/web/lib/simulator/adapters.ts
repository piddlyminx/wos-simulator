import type { BattleInput, FighterInput, PassiveEffects, StatBlock, UnitType } from "@simulator/types";
import type { SimulateRequestPayload, SimulateSidePayload } from "@/lib/simulate-run";

const CATEGORIES = ["infantry", "lancer", "marksman"] as const;

export function toBattleInput(request: SimulateRequestPayload, seed: string | number): BattleInput {
  return {
    attacker: toFighterInput(request.attacker, request.defender),
    defender: toFighterInput(request.defender, request.attacker),
    seed,
    maxRounds: 1500,
    ...(request.rally_mode ? { engagement_type: "rally" } : {}),
  };
}

function toFighterInput(side: SimulateSidePayload, opponent: SimulateSidePayload): FighterInput {
  return {
    troops: toTroopComposition(side),
    stats: toStats(side),
    passive: toPassiveEffects(side, opponent),
    heroes: toHeroes(side),
    joiner_heroes: toJoinerHeroes(side),
  };
}

export function toTroopComposition(side: Pick<SimulateSidePayload, "troops" | "troop_types" | "troop_composition">): Record<string, number> {
  if (!side.troop_composition) {
    return Object.fromEntries(CATEGORIES.map(category => [side.troop_types[category], Math.max(0, Math.floor(side.troops[category] ?? 0))]));
  }
  const imported = Object.entries(side.troop_composition);
  return Object.fromEntries(CATEGORIES.flatMap((category): [string, number][] => {
    const count = Math.max(0, Math.floor(side.troops[category] ?? 0));
    const selected = side.troop_types[category];
    const lines = imported.filter(([key, value]) => value >= 0 && key.startsWith(`${category}_`));
    if (!lines.length || lines[0][0] !== selected) return [[selected, count]];
    const counts = scaleTroopCounts(lines.map(([, value]) => value), count);
    return lines.map(([key], index) => [key, counts[index]]);
  }));
}

export function scaleTroopCounts(counts: readonly number[], total: number): number[] {
  const current = counts.reduce((sum, count) => sum + count, 0);
  if (current === 0) return counts.map((_, index) => index === 0 ? total : 0);
  const factor = total / current;
  const scaled = counts.map(count => Math.floor(count * factor));
  const remainder = total - scaled.reduce((sum, count) => sum + count, 0);
  if (remainder > 0) {
    const fractions = counts.map((count, index) => count * factor - scaled[index]);
    const order = counts.map((_, index) => index).sort((a, b) => fractions[b] - fractions[a] || a - b);
    for (let index = 0; index < remainder; index++) scaled[order[index]]++;
  }
  return scaled;
}

function toHeroes(side: SimulateSidePayload): FighterInput["heroes"] {
  const out: NonNullable<FighterInput["heroes"]> = {};
  for (const cat of CATEGORIES) {
    const slot = side.heroes[cat];
    if (!slot?.name) continue;
    out[slot.name] = skillMap(slot.skills);
  }
  return out;
}

function toJoinerHeroes(side: SimulateSidePayload): FighterInput["joiner_heroes"] {
  const out: Extract<NonNullable<FighterInput["joiner_heroes"]>, unknown[]> = [];
  for (const joiner of side.joiners ?? []) {
    if (!joiner.name) continue;
    out.push({
      name: joiner.name,
      levels: { skill_1: Math.max(0, Math.floor(joiner.skill_1 ?? 0)) }
    });
  }
  return out;
}

function skillMap(skills: readonly number[]): Record<string, number> {
  const out: Record<string, number> = {};
  skills.forEach((value, index) => {
    const level = Math.max(0, Math.floor(value || 0));
    if (level > 0) out[`skill_${index + 1}`] = level;
  });
  return out;
}

function toStats(side: SimulateSidePayload): Record<UnitType, Partial<StatBlock>> {
  return {
    infantry: tupleToStats(side.stats.inf),
    lancer: tupleToStats(side.stats.lanc),
    marksman: tupleToStats(side.stats.mark),
  };
}

function tupleToStats(tuple: [number, number, number, number]): StatBlock {
  return {
    attack: tuple[0],
    defense: tuple[1],
    lethality: tuple[2],
    health: tuple[3],
  };
}

function toPassiveEffects(side: SimulateSidePayload, opponent: SimulateSidePayload): PassiveEffects | undefined {
  const own = side.stat_modifiers ?? { attack: 0, defense: 0, lethality: 0, health: 0, enemy_attack: 0, enemy_defense: 0 };
  const opp = opponent.stat_modifiers ?? { attack: 0, defense: 0, lethality: 0, health: 0, enemy_attack: 0, enemy_defense: 0 };
  const ownPet = side.pet_modifiers ?? { attack: 0, defense: 0, lethality: 0, health: 0, enemy_defense: 0, enemy_lethality: 0, enemy_health: 0 };
  const oppPet = opponent.pet_modifiers ?? { attack: 0, defense: 0, lethality: 0, health: 0, enemy_defense: 0, enemy_lethality: 0, enemy_health: 0 };
  const passive: PassiveEffects = {};

  addPassiveStat(passive, "attack", "up", own.attack);
  addPassiveStat(passive, "defense", "up", own.defense);
  addPassiveStat(passive, "lethality", "up", own.lethality);
  addPassiveStat(passive, "health", "up", own.health);
  addPassiveStat(passive, "attack", "up", ownPet.attack);
  addPassiveStat(passive, "defense", "up", ownPet.defense);
  addPassiveStat(passive, "lethality", "up", ownPet.lethality);
  addPassiveStat(passive, "health", "up", ownPet.health);
  addPassiveStat(passive, "attack", "down", Math.abs(Math.min(0, opp.enemy_attack ?? 0)));
  addPassiveStat(passive, "defense", "down", Math.abs(Math.min(0, opp.enemy_defense ?? 0)));
  addPassiveStat(passive, "defense", "down", Math.abs(Math.min(0, oppPet.enemy_defense ?? 0)));
  addPassiveStat(passive, "lethality", "down", Math.abs(Math.min(0, oppPet.enemy_lethality ?? 0)));
  addPassiveStat(passive, "lethality", "down", opponent.gareth);
  addPassiveStat(passive, "health", "down", Math.abs(Math.min(0, oppPet.enemy_health ?? 0)));

  return Object.keys(passive).length > 0 ? passive : undefined;
}

function addPassiveStat(passive: PassiveEffects, stat: keyof StatBlock, direction: "up" | "down", rawValue: unknown): void {
  const value = Number(rawValue ?? 0);
  if (!Number.isFinite(value) || value <= 0) return;
  passive[stat] = { ...passive[stat], [direction]: (passive[stat]?.[direction] ?? 0) + value };
}
