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
  roundStart: PreparedRoundSkill[];
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
  probabilityPct: number;
  everyAttack?: number;
  firstAttack?: number;
}

export interface PreparedRoundSkill {
  skill: ResolvedSkill;
  probabilityPct: number;
  everyTurn?: number;
  firstTurn?: number;
}

export function buildRuntimeSkills(fighters: ResolvedFighter[]): RuntimeSkills {
  const all = fighters.flatMap((fighter) => [...(fighter.heroSkills ?? []), ...fighter.troopSkills]);
  const preBattle: ResolvedSkill[] = [];
  const battleStart: ResolvedSkill[] = [];
  const roundStart: PreparedRoundSkill[] = [];
  const attackDeclaredByJobShape: Array<PreparedAttackSkill[] | undefined> = Array.from({ length: DAMAGE_JOB_SHAPE_SLOTS });
  const chanceSkillIds: Record<SideId, string[]> = { attacker: [], defender: [] };
  const effectGroups: ActiveEffectGroup[] = [];
  const damageGroupsByJobShape: ActiveEffectGroup[][] = Array.from({ length: DAMAGE_JOB_SHAPE_SLOTS }, () => []);
  const groupMetadata = new Map<ActiveEffectGroup, { ownerSide: SideId; effectId: string; requiresEffectId?: string }>();
  // One scope-key table per (side, config definition); duplicate main/joiner copies of the
  // same config effect share it, so their activations land in the same groups.
  const groupTablesByDefinition: Record<SideId, Map<object, Array<ActiveEffectGroup | undefined>>> = {
    attacker: new Map(),
    defender: new Map()
  };
  const useContextIntentsBySkill = new Map<ResolvedSkill, AttackIntent[]>();

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
      roundStart.push({
        skill,
        probabilityPct: trigger.probabilityPct,
        ...(skill.trigger.every === undefined
          ? {}
          : {
              everyTurn: skill.trigger.every,
              firstTurn: skill.trigger.first ?? skill.trigger.every
            })
      });
    } else if (skill.trigger.type === "attack") {
      const immediateEffects: ResolvedEffectIntentDefinition[] = [];
      const deferredIntents = skill.effects.filter((intent) => intent.value_formula !== undefined);
      for (const intent of skill.effects) {
        if (intent.value_formula !== undefined) continue;
        immediateEffects.push(intent);
      }
      const prepared: PreparedAttackSkill = {
        skill,
        immediateEffects,
        probabilityPct: trigger.probabilityPct,
        ...(skill.trigger.every === undefined
          ? {}
          : {
              everyAttack: skill.trigger.every,
              firstAttack: skill.trigger.first ?? skill.trigger.every
            }),
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

    for (const intent of walkEffects(skill.effects)) {
      const definition = intent.type === undefined ? undefined : dynamicBucketDefinition(intent.type);
      if (definition?.effectBucket !== true) continue;
      const existingTable = groupTablesByDefinition[skill.side].get(intent.sourceDefinition);
      if (existingTable) {
        intent.effectGroupsByScopeKey = existingTable;
        continue;
      }
      const groupsByScopeKey: Array<ActiveEffectGroup | undefined> = [];
      const groupsForDefinition: ActiveEffectGroup[] = [];
      const slotsForDefinition: Uint8Array[] = [];
      for (const attackIntent of potentialActivationIntents(skill, intent, useContextIntentsBySkill)) {
        const effect = activateEffect(skill, intent, 1, attackIntent);
        const scopeKey = resolvedEffectScopeKey(effect.appliesTo, effect.appliesVs);
        if (groupsByScopeKey[scopeKey]) continue;
        const slots = damageShapeSlotsForEffect(effect, definition.name);
        if (slots.length === 0) continue;
        if (effect.sameEffectStacking === "max") assertDisjointResolvedGroupSlots(intent.id, slots, slotsForDefinition);
        const group: ActiveEffectGroup = {
          ordinal: effectGroups.length,
          bucketIndex: damageBucketIndex(definition.name),
          sameEffectStacking: effect.sameEffectStacking
        };
        groupMetadata.set(group, {
          ownerSide: skill.side,
          effectId: intent.id,
          ...(intent.requires_effect === undefined ? {} : { requiresEffectId: intent.requires_effect })
        });
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
  linkRequiredEffectGroups(effectGroups, damageGroupsByJobShape, groupMetadata);
  return {
    preBattle,
    battleStart,
    roundStart,
    attackDeclaredByJobShape,
    effectGroups,
    damageGroupsByJobShape,
    randomness: {
      deterministic: chanceSkillIds.attacker.length === 0 && chanceSkillIds.defender.length === 0,
      chanceSkillIds
    }
  };
}

function linkRequiredEffectGroups(
  effectGroups: ActiveEffectGroup[],
  damageGroupsByJobShape: ActiveEffectGroup[][],
  metadata: Map<ActiveEffectGroup, { ownerSide: SideId; effectId: string; requiresEffectId?: string }>
): void {
  for (const group of effectGroups) {
    const dependent = metadata.get(group);
    if (!dependent?.requiresEffectId) continue;
    const byJobShape: Array<number[] | undefined> = [];
    let linked = false;
    for (let slot = 0; slot < damageGroupsByJobShape.length; slot += 1) {
      const jobGroups = damageGroupsByJobShape[slot];
      if (!jobGroups.includes(group)) continue;
      const requiredOrdinals = jobGroups
        .filter((candidate) => {
          const required = metadata.get(candidate);
          return required?.ownerSide === dependent.ownerSide && required.effectId === dependent.requiresEffectId;
        })
        .map((candidate) => candidate.ordinal);
      if (requiredOrdinals.length === 0) continue;
      byJobShape[slot] = requiredOrdinals;
      linked = true;
    }
    if (!linked) {
      throw new Error(`Effect ${dependent.effectId} requires effect ${dependent.requiresEffectId}, but no applicable runtime effect group was prepared`);
    }
    group.requiredGroupOrdinalsByJobShape = byJobShape;
  }
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
function potentialActivationIntents(
  skill: ResolvedSkill,
  effect: ResolvedEffectIntentDefinition,
  useContextIntentsBySkill: Map<ResolvedSkill, AttackIntent[]>
): Array<AttackIntent | undefined> {
  const units = effect.units ?? {};
  const selectors = [units.applies_to, units.applies_vs];
  const needsUseContext = selectors.some((selector) =>
    selector === "trigger.source" || selector === "trigger" || selector === "trigger.target" || selector === "target" ||
    selector === "parent.use.source" || selector === "parent.use.target"
  );
  if (!needsUseContext) return NO_USE_CONTEXT_INTENTS;
  const cached = useContextIntentsBySkill.get(skill);
  if (cached) return cached;
  if (skill.trigger.type === "battle_start" || skill.trigger.type === "turn") {
    const intents = allOwnerAttackIntents(skill.side);
    useContextIntentsBySkill.set(skill, intents);
    return intents;
  }
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
  useContextIntentsBySkill.set(skill, intents);
  return intents;
}

const NO_USE_CONTEXT_INTENTS: Array<undefined> = [undefined];

function allOwnerAttackIntents(ownerSide: SideId): AttackIntent[] {
  const other = oppositeSide(ownerSide);
  const intents: AttackIntent[] = [];
  for (const [dealerSide, takerSide] of [[ownerSide, other], [other, ownerSide]] as const) {
    for (const dealerUnit of unitsFromMask(7)) {
      for (const takerUnit of unitsFromMask(7)) {
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
  }
  return intents;
}

function* walkEffects(effects: ResolvedEffectIntentDefinition[]): Iterable<ResolvedEffectIntentDefinition> {
  for (const effect of effects) {
    yield effect;
    if (effect.triggerEffects) yield* walkEffects(effect.triggerEffects);
  }
}
