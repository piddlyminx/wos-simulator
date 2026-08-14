import assert from "node:assert/strict";
import { test } from "node:test";

import { activateEffect } from "./effects";
import type { EffectDuration, ResolvedEffectIntentDefinition, ResolvedSkill } from "./types";

const skill: ResolvedSkill = {
  id: "SyntheticExtra",
  name: "Synthetic Extra",
  sourceKind: "hero_skill",
  side: "attacker",
  heroName: "Synthetic",
  level: 1,
  trigger: { type: "battle_start" },
  effects: []
};

function extraAttackIntent(duration?: EffectDuration): ResolvedEffectIntentDefinition {
  const sourceDefinition = {
    type: "extra_skill_attack",
    value: 100,
    units: { applies_to: "self.marksman", applies_vs: "enemy.any" },
    trigger_damage_jobs: [{ source: "use.source", target: "use.target" }],
    ...(duration === undefined ? {} : { duration })
  } satisfies ResolvedEffectIntentDefinition["sourceDefinition"];

  return { id: "SyntheticExtra/1", ...sourceDefinition, sourceDefinition };
}

test("extra skill attacks default to one turn and one attack", () => {
  const effect = activateEffect(skill, extraAttackIntent(), 3);

  assert.deepEqual(effect.duration, {
    turns: { count: 1 },
    attacks: { count: 1 }
  });
});

test("explicit extra skill attack duration replaces the default", () => {
  const twoAttackEffect = activateEffect(skill, extraAttackIntent({ attacks: { count: 2 } }), 3);
  const permanentEffect = activateEffect(skill, extraAttackIntent({}), 3);

  assert.deepEqual(twoAttackEffect.duration, { attacks: { count: 2 } });
  assert.deepEqual(permanentEffect.duration, {});
});
