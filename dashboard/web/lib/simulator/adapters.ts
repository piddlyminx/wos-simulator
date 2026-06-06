import type { BattleInput, FighterInput, PassiveEffects, StatBlock, UnitType } from "@simulator/types";
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
    stats: toStats(side),
    passive: toPassiveEffects(side, opponent),
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
  const passive: PassiveEffects = {};

  addPassiveStat(passive, "attack", "up", own.attack);
  addPassiveStat(passive, "defense", "up", own.defense);
  addPassiveStat(passive, "lethality", "up", own.lethality);
  addPassiveStat(passive, "health", "up", own.health);
  addPassiveStat(passive, "attack", "down", Math.abs(Math.min(0, opp.enemy_attack ?? 0)));
  addPassiveStat(passive, "defense", "down", Math.abs(Math.min(0, opp.enemy_defense ?? 0)));

  return Object.keys(passive).length > 0 ? passive : undefined;
}

function addPassiveStat(passive: PassiveEffects, stat: keyof StatBlock, direction: "up" | "down", rawValue: unknown): void {
  const value = Number(rawValue ?? 0);
  if (!Number.isFinite(value) || value <= 0) return;
  passive[stat] = { ...passive[stat], [direction]: value };
}
