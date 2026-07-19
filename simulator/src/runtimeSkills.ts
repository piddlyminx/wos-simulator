import type {
  ActiveEffectGroup,
  AttackIntent,
  BattleRandomness,
  ResolvedEffectIntentDefinition,
  ResolvedFighter,
  ResolvedSkill,
  SideId
} from "./types";
import { unitsFromMask } from "./types";
import { activateEffect, compiledTriggerForSkill, oppositeSide, resolvedEffectScopeKey } from "./effects";
import { damageBucketIndex, damageJobShapeSlot, damageShapeSlotsForEffect, DAMAGE_JOB_SHAPE_SLOTS } from "./effectIndex";
import { dynamicBucketDefinition } from "./damageBuckets";

/**
 * Battle-preparation product: every skill bucketed by trigger phase, the prepared
 * effect-group graph for runtime damage modifiers (see the EffectIndex design notes),
 * and run-invariant metadata. Built once per battle — or once per CompiledBattle and
 * shared across all of its runs.
 */
export interface RuntimeSkills {
  // Chance-free static-passive skills activated once at prepare time, before any runtime exists.
  preBattle: ResolvedSkill[];
  battleStart: ResolvedSkill[];
  roundStartGlobal: ResolvedSkill[];
  roundStartPerUnit: ResolvedSkill[];
  attackDeclaredByJobShape: Array<PreparedAttackSkill[] | undefined>;
  effectGroups: ActiveEffectGroup[];
  damageGroupsByJobShape: ActiveEffectGroup[][];
  randomness: BattleRandomness;
}

export interface DeferredEffectPlan {
  skill: ResolvedSkill;
  intent: ResolvedEffectIntentDefinition;
}

export interface PreparedAttackSkill {
  skill: ResolvedSkill;
  immediateEffects: ResolvedEffectIntentDefinition[];
  deferredEffects?: DeferredEffectPlan[];
}

export function buildRuntimeSkills(fighters: ResolvedFighter[]): RuntimeSkills {
  const all = fighters.flatMap((fighter) => [...(fighter.heroSkills ?? []), ...fighter.troopSkills]);
  const preBattle: ResolvedSkill[] = [];
  const battleStart: ResolvedSkill[] = [];
  const roundStartGlobal: ResolvedSkill[] = [];
  const roundStartPerUnit: ResolvedSkill[] = [];
  const attackDeclaredByJobShape: Array<PreparedAttackSkill[] | undefined> = Array.from({ length: DAMAGE_JOB_SHAPE_SLOTS });
  const chanceSkillIds: Record<SideId, string[]> = { attacker: [], defender: [] };
  const effectGroups: ActiveEffectGroup[] = [];
  const damageGroupsByJobShape: ActiveEffectGroup[][] = Array.from({ length: DAMAGE_JOB_SHAPE_SLOTS }, () => []);
  // One scope-key table per (side, config definition); duplicate main/joiner copies of the
  // same config effect share it, so their activations land in the same groups.
  const groupTablesByDefinition: Record<SideId, Map<object, Array<ActiveEffectGroup | undefined>>> = {
    attacker: new Map(),
    defender: new Map()
  };

  for (const skill of all) {
    if (skill.trigger.type === "pre_battle") {
      preBattle.push(skill);
      continue;
    }

    const trigger = compiledTriggerForSkill(skill);
    if (trigger.probabilityPct > 0 && trigger.probabilityPct < 100) chanceSkillIds[skill.side].push(skill.id);

    if (skill.trigger.type === "battle_start") {
      battleStart.push(skill);
    } else if (skill.trigger.type === "turn") {
      (hasPerUnitRoundTrigger(skill) ? roundStartPerUnit : roundStartGlobal).push(skill);
    } else if (skill.trigger.type === "attack") {
      const immediateEffects = skill.effects.filter((intent) => intent.value_formula === undefined);
      const deferredIntents = skill.effects.filter((intent) => intent.value_formula !== undefined);
      const prepared: PreparedAttackSkill = {
        skill,
        immediateEffects,
        ...(deferredIntents.length > 0
          ? { deferredEffects: deferredIntents.map((intent) => ({ skill, intent })) }
          : {})
      };
      for (const dealerUnit of unitsFromMask(trigger.source.units)) {
        for (const takerUnit of unitsFromMask(trigger.target.units)) {
          const slot = damageJobShapeSlot("normal", trigger.source.side, dealerUnit, trigger.target.side, takerUnit);
          const matching = attackDeclaredByJobShape[slot];
          if (matching) matching.push(prepared);
          else attackDeclaredByJobShape[slot] = [prepared];
        }
      }
    }

    for (const intent of skill.effects) {
      const definition = dynamicBucketDefinition(intent.type);
      if (definition?.effectBucket !== true) continue;
      const existingTable = groupTablesByDefinition[skill.side].get(intent.sourceDefinition);
      if (existingTable) {
        intent.effectGroupsByScopeKey = existingTable;
        continue;
      }
      const groupsByScopeKey: Array<ActiveEffectGroup | undefined> = [];
      const groupsForDefinition: ActiveEffectGroup[] = [];
      const slotsForDefinition: Uint8Array[] = [];
      for (const attackIntent of potentialActivationIntents(skill)) {
        const candidate = activateEffect(skill, intent, 1, attackIntent);
        const scopeKey = resolvedEffectScopeKey(candidate.appliesTo, candidate.appliesVs);
        if (groupsByScopeKey[scopeKey]) continue;
        const slots = damageShapeSlotsForEffect(candidate, definition.name);
        if (slots.length === 0) continue;
        if (candidate.sameEffectStacking === "max") assertDisjointResolvedGroupSlots(intent.id, slots, slotsForDefinition);
        const group: ActiveEffectGroup = {
          ordinal: effectGroups.length,
          bucketIndex: damageBucketIndex(definition.name),
          sameEffectStacking: candidate.sameEffectStacking
        };
        groupsByScopeKey[scopeKey] = group;
        groupsForDefinition.push(group);
        slotsForDefinition.push(slots);
        effectGroups.push(group);
        for (const slot of slots) damageGroupsByJobShape[slot].push(group);
      }
      if (groupsForDefinition.length === 0) throw new Error(`Runtime effect ${intent.id} has no resolvable effect group`);
      groupTablesByDefinition[skill.side].set(intent.sourceDefinition, groupsByScopeKey);
      intent.effectGroupsByScopeKey = groupsByScopeKey;
    }
  }
  return {
    preBattle,
    battleStart,
    roundStartGlobal,
    roundStartPerUnit,
    attackDeclaredByJobShape,
    effectGroups,
    damageGroupsByJobShape,
    randomness: {
      deterministic: chanceSkillIds.attacker.length === 0 && chanceSkillIds.defender.length === 0,
      chanceSkillIds
    }
  };
}

function hasPerUnitRoundTrigger(skill: ResolvedSkill): boolean {
  return skill.trigger.type === "turn" && skill.trigger.source !== undefined;
}

function assertDisjointResolvedGroupSlots(effectId: string, slots: Uint8Array, existingGroups: Iterable<Uint8Array>): void {
  for (const existing of existingGroups) {
    for (const slot of slots) {
      if (existing.includes(slot)) {
        throw new Error(`Resolved scopes for max-stacking effect ${effectId} overlap at damage job slot ${slot}`);
      }
    }
  }
}

// Enumerate the attack-intent shapes this skill's trigger can ever activate with, so
// preparation can pre-create an effect group for every reachable resolved scope. The
// activations built from these intents are throwaway scope probes, never indexed.
function potentialActivationIntents(skill: ResolvedSkill): Array<AttackIntent | undefined> {
  if (skill.trigger.type === "battle_start" || (skill.trigger.type === "turn" && skill.trigger.source === undefined)) return [undefined];
  const trigger = compiledTriggerForSkill(skill);
  const dealerSide = trigger.source.side;
  let takerSide = trigger.target.side;
  if (skill.trigger.type === "turn" && takerSide === dealerSide) takerSide = oppositeSide(dealerSide);
  if (takerSide === dealerSide) return [];
  const dealerUnits = unitsFromMask(trigger.source.units);
  const takerUnits = unitsFromMask(trigger.target.units);
  const intents: AttackIntent[] = [];
  for (const dealerUnit of dealerUnits) {
    for (const takerUnit of takerUnits) {
      intents.push({
        round: 1,
        source: "normal",
        dealerSide,
        dealerUnit,
        takerSide,
        takerUnit,
        orderIndex: 0,
        previousAttackCount: 0,
        projectedAttackCount: 1,
        previousReceivedAttackCount: 0,
        projectedReceivedAttackCount: 1
      });
    }
  }
  return intents;
}
