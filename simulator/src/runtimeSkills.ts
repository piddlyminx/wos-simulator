import type {
  ActiveEffectGroup,
  AttackIntent,
  BattleRandomness,
  ResolvedFighter,
  ResolvedSkill,
  SideId
} from "./types";
import { unitsFromMask } from "./types";
import { activateEffect, compiledTriggerForSkill, oppositeSide, resolvedEffectScopeKey } from "./effects";
import { damageBucketIndex, damageJobShapeSlot, damageShapeSlotsForEffect, DAMAGE_JOB_SHAPE_SLOTS } from "./effectIndex";
import { bucketDefinition } from "./damageBuckets";

/**
 * Battle-preparation product: every skill bucketed by trigger phase, the prepared
 * effect-group graph for runtime damage modifiers (see the EffectIndex design notes),
 * and run-invariant metadata. Built once per battle — or once per CompiledBattle and
 * shared across all of its runs.
 */
export interface RuntimeSkills {
  all: ResolvedSkill[];
  battleStart: ResolvedSkill[];
  roundStart: ResolvedSkill[];
  roundStartGlobal: ResolvedSkill[];
  roundStartPerUnit: ResolvedSkill[];
  attackDeclared: ResolvedSkill[];
  attackDeclaredByJobShape: Array<ResolvedSkill[] | undefined>;
  effectGroups: ActiveEffectGroup[];
  damageGroupsByJobShape: ActiveEffectGroup[][];
  randomness: BattleRandomness;
}

export function hasChanceTrigger(skill: ResolvedSkill): boolean {
  const probabilityPct = compiledTriggerForSkill(skill).probabilityPct;
  return probabilityPct > 0 && probabilityPct < 100;
}

export function buildRuntimeSkills(fighters: ResolvedFighter[]): RuntimeSkills {
  const all = fighters.flatMap((fighter) => [...(fighter.heroSkills ?? []), ...fighter.troopSkills]);
  for (const skill of all) compiledTriggerForSkill(skill);
  const effectGroups: ActiveEffectGroup[] = [];
  const damageGroupsByJobShape: ActiveEffectGroup[][] = Array.from({ length: DAMAGE_JOB_SHAPE_SLOTS }, () => []);
  // One scope-key table per (side, config definition); duplicate main/joiner copies of the
  // same config effect share it, so their activations land in the same groups.
  const groupTablesByDefinition: Record<SideId, Map<object, Array<ActiveEffectGroup | undefined>>> = {
    attacker: new Map(),
    defender: new Map()
  };
  for (const skill of all) {
    for (const intent of skill.effects) {
      const definition = bucketDefinition(intent.type);
      if (definition?.phase === "static") {
        if (intent.same_effect_stacking === "max") {
          throw new Error(`Static passive effect ${intent.id} cannot use max stacking; passive effects are additive`);
        }
        continue;
      }
      const isDynamicModifier = definition?.valueType === "pct";
      if (!isDynamicModifier) continue;
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
        const slots = damageShapeSlotsForEffect(candidate, definition.path);
        if (slots.length === 0) continue;
        if (candidate.sameEffectStacking === "max") assertDisjointResolvedGroupSlots(intent.id, slots, slotsForDefinition);
        const group: ActiveEffectGroup = {
          ordinal: effectGroups.length,
          bucketIndex: damageBucketIndex(definition.path),
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
  const battleStart = all.filter((skill) => skill.trigger.type === "battle_start");
  const roundStart = all.filter((skill) => skill.trigger.type === "turn");
  const attackDeclared = all.filter((skill) => skill.trigger.type === "attack");
  const attackDeclaredByJobShape: Array<ResolvedSkill[] | undefined> = Array.from({ length: DAMAGE_JOB_SHAPE_SLOTS });
  for (const skill of attackDeclared) {
    const trigger = compiledTriggerForSkill(skill);
    for (const dealerUnit of unitsFromMask(trigger.source.units)) {
      for (const takerUnit of unitsFromMask(trigger.target.units)) {
        const slot = damageJobShapeSlot("normal", trigger.source.side, dealerUnit, trigger.target.side, takerUnit);
        const matching = attackDeclaredByJobShape[slot];
        if (matching) matching.push(skill);
        else attackDeclaredByJobShape[slot] = [skill];
      }
    }
  }
  return {
    all,
    battleStart,
    roundStart,
    roundStartGlobal: roundStart.filter((skill) => !hasPerUnitRoundTrigger(skill)),
    roundStartPerUnit: roundStart.filter((skill) => hasPerUnitRoundTrigger(skill)),
    attackDeclared,
    attackDeclaredByJobShape,
    effectGroups,
    damageGroupsByJobShape,
    randomness: classifyRandomness(all)
  };
}

function hasPerUnitRoundTrigger(skill: ResolvedSkill): boolean {
  return skill.trigger.type === "turn" && skill.trigger.source !== undefined;
}

function classifyRandomness(skills: ResolvedSkill[]): BattleRandomness {
  const chanceSkillIds: Record<SideId, string[]> = { attacker: [], defender: [] };
  for (const skill of skills) {
    if (hasChanceTrigger(skill)) chanceSkillIds[skill.side].push(skill.id);
  }
  return {
    deterministic: chanceSkillIds.attacker.length === 0 && chanceSkillIds.defender.length === 0,
    chanceSkillIds
  };
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
