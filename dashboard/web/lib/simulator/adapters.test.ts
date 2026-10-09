import assert from "node:assert/strict";
import { test } from "node:test";

import type { SimulateRequestPayload, SimulateSidePayload } from "@/lib/simulate-run";
import { toBattleInput } from "./adapters";

const request: SimulateRequestPayload = {
  replicates: 3,
  rally_mode: true,
  attacker: {
    troops: { infantry: 100, lancer: 50, marksman: 25 },
    troop_types: { infantry: "infantry_t6", lancer: "lancer_t6", marksman: "marksman_t6" },
    heroes: {
      infantry: { name: "Greg", skills: [5, 4, 3, 2] },
      lancer: { name: null, skills: [0, 0, 0, 0] },
      marksman: { name: "Mia", skills: [1, 2, 3, 4] },
    },
    joiners: [{ name: "Jessie", skill_1: 5 }],
    stats: { inf: [100, 101, 102, 103], lanc: [110, 111, 112, 113], mark: [120, 121, 122, 123] },
    stat_modifiers: { attack: 10, defense: 0, lethality: 5, health: 0, enemy_attack: -20, enemy_defense: -10 },
    pet_modifiers: { attack: 3, defense: 4, lethality: 6, health: 7, enemy_defense: -8, enemy_lethality: -9, enemy_health: -10 },
  },
  defender: {
    troops: { infantry: 90, lancer: 80, marksman: 70 },
    troop_types: { infantry: "infantry_t6", lancer: "lancer_t6", marksman: "marksman_t6" },
    heroes: {
      infantry: { name: null, skills: [0, 0, 0, 0] },
      lancer: { name: null, skills: [0, 0, 0, 0] },
      marksman: { name: null, skills: [0, 0, 0, 0] },
    },
    joiners: [],
    stats: { inf: [100, 100, 100, 100], lanc: [100, 100, 100, 100], mark: [100, 100, 100, 100] },
    stat_modifiers: { attack: 0, defense: 0, lethality: 0, health: 0, enemy_attack: 0, enemy_defense: 0 },
    pet_modifiers: { attack: 1, defense: 0, lethality: 0, health: 0, enemy_defense: -2, enemy_lethality: -3, enemy_health: -4 },
  },
};

test("toBattleInput maps dashboard payload to simulator BattleInput", () => {
  const input = toBattleInput(request, "seed-a");
  assert.equal(input.seed, "seed-a");
  assert.equal(input.engagement_type, "rally");
  assert.deepEqual(input.attacker.troops, { infantry_t6: 100, lancer_t6: 50, marksman_t6: 25 });
  const heroes = input.attacker.heroes as Record<string, Record<string, number>>;
  assert.deepEqual(heroes.Greg, { skill_1: 5, skill_2: 4, skill_3: 3, skill_4: 2 });
  assert.deepEqual(heroes.Mia, { skill_1: 1, skill_2: 2, skill_3: 3, skill_4: 4 });
  assert.deepEqual(input.attacker.joiner_heroes, [{ name: "Jessie", levels: { skill_1: 5 } }]);
  assert.ok(Math.abs((input.attacker.stats?.infantry?.attack ?? 0) - 100) < 1e-9);
  assert.ok(Math.abs((input.attacker.stats?.infantry?.defense ?? 0) - 101) < 1e-9);
  assert.ok(Math.abs((input.attacker.stats?.infantry?.lethality ?? 0) - 102) < 1e-9);
  assert.ok(Math.abs((input.attacker.stats?.infantry?.health ?? 0) - 103) < 1e-9);
  assert.deepEqual(input.attacker.passive, {
    attack: { up: 13 },
    defense: { up: 4, down: 2 },
    lethality: { up: 11, down: 3 },
    health: { up: 7, down: 4 },
  });
  assert.ok(Math.abs((input.defender.stats?.infantry?.attack ?? 0) - 100) < 1e-9);
  assert.ok(Math.abs((input.defender.stats?.infantry?.defense ?? 0) - 100) < 1e-9);
  assert.deepEqual(input.defender.passive, {
    attack: { up: 1, down: 20 },
    defense: { down: 18 },
    lethality: { down: 9 },
    health: { down: 10 },
  });
});

test("toBattleInput preserves duplicate rally joiner heroes", () => {
  const input = toBattleInput(
    {
      ...request,
      attacker: {
        ...request.attacker,
        joiners: [
          { name: "Jasser", skill_1: 5 },
          { name: "Jasser", skill_1: 5 }
        ]
      }
    },
    "seed-duplicates"
  );

  assert.deepEqual(input.attacker.joiner_heroes, [
    { name: "Jasser", levels: { skill_1: 5 } },
    { name: "Jasser", levels: { skill_1: 5 } }
  ]);
});

test("Gareth adds to the opponent's pet lethality debuff on either side", () => {
  const base = blankRequest();
  const input = toBattleInput({
    ...base,
    attacker: {
      ...base.attacker,
      gareth: 2.75,
      pet_modifiers: { ...base.attacker.pet_modifiers!, enemy_lethality: -4 },
    },
    defender: {
      ...base.defender,
      gareth: 5,
      pet_modifiers: { ...base.defender.pet_modifiers!, enemy_lethality: -1.25 },
    },
  }, "gareth-debuffs");

  assert.deepEqual(input.attacker.passive, { lethality: { down: 6.25 } });
  assert.deepEqual(input.defender.passive, { lethality: { down: 6.75 } });
  assert.deepEqual(input.attacker.stats, input.defender.stats);
  assert.equal(toBattleInput(base, "no-gareth").attacker.passive, undefined);
  assert.equal(toBattleInput(base, "no-gareth").defender.passive, undefined);
});


function blankRequest(): SimulateRequestPayload {
  const side = (): SimulateSidePayload => ({
    troops: { infantry: 100, lancer: 0, marksman: 0 },
    troop_types: { infantry: "infantry_t6", lancer: "lancer_t6", marksman: "marksman_t6" },
    heroes: {
      infantry: { name: null, skills: [0, 0, 0, 0] },
      lancer: { name: null, skills: [0, 0, 0, 0] },
      marksman: { name: null, skills: [0, 0, 0, 0] },
    },
    joiners: [],
    stats: { inf: [100, 100, 100, 100], lanc: [100, 100, 100, 100], mark: [100, 100, 100, 100] },
    stat_modifiers: { attack: 0, defense: 0, lethality: 0, health: 0, enemy_attack: 0, enemy_defense: 0 },
    pet_modifiers: { attack: 0, defense: 0, lethality: 0, health: 0, enemy_defense: 0, enemy_lethality: 0, enemy_health: 0 },
  });
  return {
    attacker: side(),
    defender: side(),
    replicates: 1,
    rally_mode: false,
  };
}
