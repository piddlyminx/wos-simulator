import type { BattleInput, FighterInput, StatBlock, UnitType } from "@v3/types";
import type { SimulateRequestPayload, SimulateSidePayload } from "@/lib/simulate-run";

const CATEGORIES = ["infantry", "lancer", "marksman"] as const;

export function toBattleInput(request: SimulateRequestPayload, seed: string | number): BattleInput {
  return {
    attacker: toFighterInput(request.attacker, request.defender),
    defender: toFighterInput(request.defender, request.attacker),
    seed,
    maxRounds: 1500,
    mechanics: request.rally_mode ? { engagement_type: "rally" } : undefined,
  };
}

function toFighterInput(side: SimulateSidePayload, opponent: SimulateSidePayload): FighterInput {
  return {
    troops: Object.fromEntries(CATEGORIES.map((cat) => [side.troop_types[cat], Math.max(0, Math.floor(side.troops[cat] ?? 0))])),
    stats: toStats(side, opponent),
    heroes: toHeroes(side),
    joiner_heroes: toJoinerHeroes(side),
  };
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
  const out: NonNullable<FighterInput["joiner_heroes"]> = {};
  for (const joiner of side.joiners ?? []) {
    if (!joiner.name) continue;
    out[joiner.name] = { skill_1: Math.max(0, Math.floor(joiner.skill_1 ?? 0)) };
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

function toStats(side: SimulateSidePayload, opponent: SimulateSidePayload): Record<UnitType, Partial<StatBlock>> {
  return {
    infantry: tupleToStats(side.stats.inf, side, opponent),
    lancer: tupleToStats(side.stats.lanc, side, opponent),
    marksman: tupleToStats(side.stats.mark, side, opponent),
  };
}

function tupleToStats(tuple: [number, number, number, number], side: SimulateSidePayload, opponent: SimulateSidePayload): StatBlock {
  const own = side.stat_modifiers ?? { attack: 0, defense: 0, lethality: 0, health: 0, enemy_attack: 0, enemy_defense: 0 };
  const opp = opponent.stat_modifiers ?? { attack: 0, defense: 0, lethality: 0, health: 0, enemy_attack: 0, enemy_defense: 0 };
  const modifiers = {
    attack: { up: own.attack ?? 0, down: Math.abs(Math.min(0, opp.enemy_attack ?? 0)) },
    defense: { up: own.defense ?? 0, down: Math.abs(Math.min(0, opp.enemy_defense ?? 0)) },
    lethality: { up: own.lethality ?? 0, down: 0 },
    health: { up: own.health ?? 0, down: 0 },
  };
  return {
    attack: applyStatBonusGroups(tuple[0], modifiers.attack.up, modifiers.attack.down),
    defense: applyStatBonusGroups(tuple[1], modifiers.defense.up, modifiers.defense.down),
    lethality: applyStatBonusGroups(tuple[2], modifiers.lethality.up, modifiers.lethality.down),
    health: applyStatBonusGroups(tuple[3], modifiers.health.up, modifiers.health.down),
  };
}

function applyStatBonusGroups(baseValue: number, upPercent: number, downPercent: number): number {
  return ((100 + baseValue) * (1 + upPercent / 100)) / (1 + downPercent / 100) - 100;
}
