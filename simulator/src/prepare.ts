import type {
  ActiveEffect,
  BattleInput,
  BattleResult,
  FighterInput,
  ResolvedFighter,
  SideId,
  SimulatorConfig
} from "./types";
import { ALL_UNIT_MASK } from "./types";
import { constantActiveEffectValuePct, activateEffect, oppositeSide } from "./effects";
import type { StaticDamageProfile } from "./damage";
import { buildStaticDamageProfile } from "./staticDamageProfile";
import { buildRuntimeSkills, type RuntimeSkills } from "./runtimeSkills";
import { resolveFighter } from "./fighterResolution";

/**
 * A resolved battle ready to run many times with different seeds. Fighters, skills, the effect-group
 * graph, and the static damage profile are built once and reused; each run fires battle_start with
 * its own seed and builds a fresh Runtime. (Benchmarked 2026-07-17: a cloned battle-start template
 * was no faster than re-firing setup per run, so the simpler always-runtime path is used.)
 * A CompiledBattle is immutable: live effect lists, troop counts, and all other run state live on
 * each run's Runtime. (Sole post-prepare write: the idempotent per-intent activation cache in
 * effects.ts, populated on first activation.)
 */
export interface CompiledBattle {
  input: BattleInput;
  config: SimulatorConfig;
  fighters: Record<SideId, ResolvedFighter>;
  // Pre-battle skill activations plus input passives: the inputs to the static damage
  // profile, kept so each run's recorder can describe the profile's contributors.
  preBattleEffects: ActiveEffect[];
  staticProfile: StaticDamageProfile;
  runtimeSkills: RuntimeSkills;
  // Run-invariant result payload shared by reference across every run of this compiled battle.
  resolved: BattleResult["resolved"];
}

export function prepareBattle(input: BattleInput, config: SimulatorConfig): CompiledBattle {
  const attacker = resolveFighter(input.attacker, "attacker", config, input.engagement_type);
  const defender = resolveFighter(input.defender, "defender", config, input.engagement_type);
  const fighters: Record<SideId, ResolvedFighter> = { attacker, defender };
  const runtimeSkills = buildRuntimeSkills([attacker, defender]);
  const resolved = buildResolved(attacker, defender);
  const preBattleEffects = activatePreBattleEffects(runtimeSkills, input);
  const staticProfile = buildStaticDamageProfile(fighters, preBattleEffects);
  return { input, config, fighters, preBattleEffects, staticProfile, runtimeSkills, resolved };
}

// The pre_battle phase: activate every chance-free static-passive skill effect plus the
// input passives. Needs no runtime, RNG, or effect index — these effects only ever feed
// the static damage profile and the recorders' description of it.
export function activatePreBattleEffects(runtimeSkills: RuntimeSkills, input: BattleInput): ActiveEffect[] {
  const effects: ActiveEffect[] = [];
  for (const skill of runtimeSkills.preBattle) {
    for (const intent of skill.effects) effects.push(activateEffect(skill, intent, 0));
  }
  effects.push(...createInputPassiveEffects(input.attacker.passive, "attacker"));
  effects.push(...createInputPassiveEffects(input.defender.passive, "defender"));
  return effects;
}

function createInputPassiveEffects(passive: FighterInput["passive"], side: SideId): ActiveEffect[] {
  const effects: ActiveEffect[] = [];
  if (!passive) return effects;
  for (const stat of ["attack", "defense", "lethality", "health"] as const) {
    for (const direction of ["up", "down"] as const) {
      const valuePct = Number(passive[stat]?.[direction] ?? 0);
      if (!Number.isFinite(valuePct) || valuePct <= 0) continue;
      const bucket = `passive.${stat}.${direction}`;
      const effect: ActiveEffect = {
        source: {
          kind: "input_stat",
          side,
          effectId: `input:${bucket}`
        },
        intent: {
          id: `input:${bucket}`,
          type: bucket,
          value: valuePct
        },
        ownerSide: side,
        kind: "modifier",
        bucketIndex: -1,
        initialValuePct: valuePct,
        getCurrentValuePct: constantActiveEffectValuePct,
        appliesTo: { side, units: ALL_UNIT_MASK },
        appliesVs: { side: oppositeSide(side), units: ALL_UNIT_MASK },
        createdRound: 0,
        startRound: 0,
        duration: {},
        remainingAttackDelay: 0,
        uses: 0,
        sameEffectStacking: "add"
      };
      effects.push(effect);
    }
  }
  return effects;
}

export function buildResolved(attacker: ResolvedFighter, defender: ResolvedFighter): BattleResult["resolved"] {
  return {
    attacker: {
      troops: { ...attacker.initialTroops },
      heroes: attacker.heroes,
      troopSkillIds: attacker.troopSkills.map((skill) => skill.id),
      diagnostics: attacker.diagnostics
    },
    defender: {
      troops: { ...defender.initialTroops },
      heroes: defender.heroes,
      troopSkillIds: defender.troopSkills.map((skill) => skill.id),
      diagnostics: defender.diagnostics
    }
  };
}
