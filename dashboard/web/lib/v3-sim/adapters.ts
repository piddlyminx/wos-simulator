import type { BattleInput, FighterInput, StatBlock, UnitType } from "@v3/types";
import type { SimulateRequestPayload, SimulateSidePayload } from "@/lib/simulate-run";

const CATEGORIES = ["infantry", "lancer", "marksman"] as const;
const STAT_KEYS = ["attack", "defense", "lethality", "health"] as const;

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
  return Object.fromEntries(skills.map((value, index) => [`skill_${index + 1}`, Math.max(0, Math.floor(value || 0))]).filter(([, value]) => value > 0));
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
    attack: (own.attack ?? 0) + (opp.enemy_attack ?? 0),
    defense: (own.defense ?? 0) + (opp.enemy_defense ?? 0),
    lethality: own.lethality ?? 0,
    health: own.health ?? 0,
  };
  return Object.fromEntries(STAT_KEYS.map((key, index) => [key, tuple[index] * (1 + modifiers[key] / 100)])) as StatBlock;
}
