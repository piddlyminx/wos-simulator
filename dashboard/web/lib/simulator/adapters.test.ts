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

const sideFieldContract = {
  troops: {
    metadataOnly: false,
    mutate: (side) => ({ ...side, troops: { ...side.troops, infantry: side.troops.infantry + 17 } }),
    assertMapped: (before, after) => assert.notDeepEqual(after.attacker.troops, before.attacker.troops),
  },
  troop_types: {
    metadataOnly: false,
    mutate: (side) => ({ ...side, troop_types: { ...side.troop_types, infantry: "infantry_t7" } }),
    assertMapped: (before, after) => assert.notDeepEqual(after.attacker.troops, before.attacker.troops),
  },
  heroes: {
    metadataOnly: false,
    mutate: (side) => ({
      ...side,
      heroes: { ...side.heroes, lancer: { name: "Mia", skills: [1, 0, 0, 0] } },
    }),
    assertMapped: (before, after) => assert.notDeepEqual(after.attacker.heroes, before.attacker.heroes),
  },
  joiners: {
    metadataOnly: false,
    mutate: (side) => ({ ...side, joiners: [{ name: "Jasser", skill_1: 4 }] }),
    assertMapped: (before, after) => assert.notDeepEqual(after.attacker.joiner_heroes, before.attacker.joiner_heroes),
  },
  stat_profile_name: {
    metadataOnly: true,
    mutate: (side) => ({ ...side, stat_profile_name: "Stored profile" }),
  },
  stat_modifiers: {
    metadataOnly: false,
    mutate: (side) => ({ ...side, stat_modifiers: { ...side.stat_modifiers!, attack: 7 } }),
    assertMapped: (before, after) => assert.notDeepEqual(after.attacker.passive, before.attacker.passive),
  },
  pet_modifiers: {
    metadataOnly: false,
    mutate: (side) => ({ ...side, pet_modifiers: { ...side.pet_modifiers!, health: 7 } }),
    assertMapped: (before, after) => assert.notDeepEqual(after.attacker.passive, before.attacker.passive),
  },
  gareth: {
    metadataOnly: false,
    mutate: (side) => ({ ...side, gareth: 2.75 }),
    assertMapped: (before, after) => {
      assert.deepEqual(after.attacker, before.attacker);
      assert.deepEqual(after.defender.passive, { lethality: { down: 2.75 } });
    },
  },
  stats: {
    metadataOnly: false,
    mutate: (side) => ({ ...side, stats: { ...side.stats, inf: [111, 100, 100, 100] } }),
    assertMapped: (before, after) => assert.notDeepEqual(after.attacker.stats, before.attacker.stats),
  },
} satisfies Record<
  keyof SimulateSidePayload,
  | {
      metadataOnly: false;
      mutate: (side: SimulateSidePayload) => SimulateSidePayload;
      assertMapped: (before: ReturnType<typeof toBattleInput>, after: ReturnType<typeof toBattleInput>) => void;
    }
  | {
      metadataOnly: true;
      mutate: (side: SimulateSidePayload) => SimulateSidePayload;
    }
>;

test("every submitted simulation side field is mapped or explicitly metadata-only", () => {
  const base = blankRequest();
  const before = toBattleInput(base, "field-contract");

  for (const [field, contract] of Object.entries(sideFieldContract) as Array<[keyof SimulateSidePayload, (typeof sideFieldContract)[keyof SimulateSidePayload]]>) {
    const after = toBattleInput(
      {
        ...base,
        attacker: contract.mutate(base.attacker),
      },
      "field-contract"
    );

    if (contract.metadataOnly) {
      assert.deepEqual(after, before, `${field} should be metadata-only`);
    } else {
      contract.assertMapped(before, after);
    }
  }
});

const requestFieldContract = {
  attacker: {
    handledBy: "battle-input",
    mutate: (payload) => ({ ...payload, attacker: { ...payload.attacker, troops: { ...payload.attacker.troops, infantry: payload.attacker.troops.infantry + 11 } } }),
    assertMapped: (before, after) => assert.notDeepEqual(after.attacker.troops, before.attacker.troops),
  },
  defender: {
    handledBy: "battle-input",
    mutate: (payload) => ({ ...payload, defender: { ...payload.defender, troops: { ...payload.defender.troops, infantry: payload.defender.troops.infantry + 11 } } }),
    assertMapped: (before, after) => assert.notDeepEqual(after.defender.troops, before.defender.troops),
  },
  replicates: {
    handledBy: "runner",
    mutate: (payload) => ({ ...payload, replicates: payload.replicates + 1 }),
  },
  rally_mode: {
    handledBy: "battle-input",
    mutate: (payload) => ({ ...payload, rally_mode: !payload.rally_mode }),
    assertMapped: (before, after) => assert.notEqual(after.engagement_type, before.engagement_type),
  },
  trace_seed: {
    handledBy: "metadata",
    mutate: (payload) => ({ ...payload, trace_seed: 123 }),
  },
} satisfies Record<
  keyof SimulateRequestPayload,
  | {
      handledBy: "battle-input";
      mutate: (payload: SimulateRequestPayload) => SimulateRequestPayload;
      assertMapped: (before: ReturnType<typeof toBattleInput>, after: ReturnType<typeof toBattleInput>) => void;
    }
  | {
      handledBy: "runner" | "metadata";
      mutate: (payload: SimulateRequestPayload) => SimulateRequestPayload;
    }
>;

test("every submitted simulation request field is mapped or explicitly handled outside BattleInput", () => {
  const base = blankRequest();
  const before = toBattleInput(base, "request-field-contract");

  for (const [field, contract] of Object.entries(requestFieldContract) as Array<[keyof SimulateRequestPayload, (typeof requestFieldContract)[keyof SimulateRequestPayload]]>) {
    const after = toBattleInput(contract.mutate(base), "request-field-contract");
    if (contract.handledBy === "battle-input") {
      contract.assertMapped(before, after);
    } else {
      assert.deepEqual(after, before, `${field} is handled by ${contract.handledBy}, not BattleInput`);
    }
  }
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
