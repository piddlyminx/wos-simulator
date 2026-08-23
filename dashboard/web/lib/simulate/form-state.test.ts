import assert from "node:assert/strict";
import { test } from "node:test";

import { loadSimulatorConfig } from "@simulator/config-default";
import { STATIC_BUCKET_INDEX } from "@simulator/damageBuckets";
import { prepareBattle } from "@simulator/prepare";
import { buildStaticDamageBucketFactors } from "@simulator/staticDamageProfile";
import { toBattleInput } from "@/lib/simulator/adapters";
import {
  applyStatBonusGroups,
  defaultSide,
  sideFromPayload,
  toApiPayload,
  type SideState,
} from "./form-state";

test("catalogue troop selections survive request and saved-run conversion", () => {
  const attacker = defaultSide();
  const defender = defaultSide();
  attacker.tiers.infantry = "t6_fc10";

  const payload = toApiPayload(attacker, defender, 1, false);

  assert.equal(payload.attacker.troop_types.infantry, "infantry_t6_fc10");
  assert.equal(payload.attacker.troop_types.lancer, "lancer_t11_fc10");
  assert.equal(sideFromPayload(payload.attacker).tiers.infantry, "t6_fc10");
});

const sideStateFieldContract = {
  troops: {
    mutate: (side) => ({
      ...side,
      troops: { ...side.troops, infantry: 123_456 },
    }),
    assertMapped: (payload) => assert.equal(payload.troops.infantry, 123_456),
  },
  tiers: {
    mutate: (side) => ({
      ...side,
      tiers: { ...side.tiers, infantry: "t6_fc10" },
    }),
    assertMapped: (payload) =>
      assert.equal(payload.troop_types.infantry, "infantry_t6_fc10"),
  },
  heroes: {
    mutate: (side) => ({
      ...side,
      heroes: {
        ...side.heroes,
        lancer: { name: "Mia", skills: [1, 2, 3, 4] },
      },
    }),
    assertMapped: (payload) =>
      assert.deepEqual(payload.heroes.lancer, {
        name: "Mia",
        skills: [1, 2, 3, 4],
      }),
  },
  joiners: {
    mutate: (side) => ({
      ...side,
      joiners: [{ name: "Jessie" }, ...side.joiners.slice(1)],
    }),
    assertMapped: (payload) =>
      assert.deepEqual(payload.joiners, [{ name: "Jessie", skill_1: 5 }]),
  },
  stats: {
    mutate: (side) => ({
      ...side,
      stats: {
        ...side.stats,
        infantry: { ...side.stats.infantry, attack: 2175.1 },
      },
    }),
    assertMapped: (payload) => assert.equal(payload.stats.inf[0], 2175.1),
  },
  statModifiers: {
    mutate: (side) => ({
      ...side,
      statModifiers: { ...side.statModifiers, attack: 10, enemy_attack: 20 },
    }),
    assertMapped: (payload) => {
      assert.equal(payload.stat_modifiers?.attack, 10);
      assert.equal(payload.stat_modifiers?.enemy_attack, -20);
    },
  },
  petModifiers: {
    mutate: (side) => ({
      ...side,
      petModifiers: { ...side.petModifiers, health: 7, enemy_health: 5 },
    }),
    assertMapped: (payload) => {
      assert.equal(payload.pet_modifiers?.health, 7);
      assert.equal(payload.pet_modifiers?.enemy_health, -5);
    },
  },
} satisfies Record<
  keyof SideState,
  {
    mutate: (side: SideState) => SideState;
    assertMapped: (
      payload: ReturnType<typeof toApiPayload>["attacker"],
    ) => void;
  }
>;

test("every editable dashboard side field is mapped into the request payload", () => {
  for (const contract of Object.values(sideStateFieldContract)) {
    const attacker = contract.mutate(defaultSide());
    const payload = toApiPayload(attacker, defaultSide(), 1, true);
    contract.assertMapped(payload.attacker);
  }
});

test("two 15% attack widgets survive dashboard mapping as a 30% simulator factor", () => {
  const attacker = defaultSide();
  const defender = defaultSide();
  attacker.troops = { infantry: 490_000, lancer: 20_000, marksman: 490_000 };
  attacker.tiers = {
    infantry: "t11_fc1",
    lancer: "t11_fc1",
    marksman: "t11_fc1",
  };
  attacker.heroes = {
    infantry: { name: "Gatot", skills: [5, 5, 5, 5] },
    lancer: { name: "Mia", skills: [5, 5, 5, 5] },
    marksman: { name: "Hendrik", skills: [1, 1, 1, 5] },
  };
  attacker.stats.infantry.attack = 2175.1;

  const payload = toApiPayload(attacker, defender, 1, true);
  assert.equal(payload.attacker.stats.inf[0], 2175.1);
  assert.deepEqual(payload.attacker.troops, attacker.troops);
  assert.deepEqual(payload.attacker.heroes.lancer, {
    name: "Mia",
    skills: [5, 5, 5, 5],
  });
  assert.deepEqual(payload.attacker.heroes.marksman, {
    name: "Hendrik",
    skills: [1, 1, 1, 5],
  });

  const input = toBattleInput(payload, "dashboard-widget-mapping");
  assert.equal(input.attacker.stats?.infantry?.attack, 2175.1);
  assert.deepEqual(input.attacker.troops, {
    infantry_t11_fc1: 490_000,
    lancer_t11_fc1: 20_000,
    marksman_t11_fc1: 490_000,
  });
  const mappedHeroes = input.attacker.heroes as Record<
    string,
    Record<string, number>
  >;
  assert.equal(mappedHeroes.Mia.skill_4, 5);
  assert.equal(mappedHeroes.Hendrik.skill_4, 5);

  const config = loadSimulatorConfig();
  const compiled = prepareBattle(input, config);
  assert.equal(compiled.fighters.attacker.statBonuses.infantry.attack, 2175.1);
  const attackWidgets = compiled.preBattleEffects.filter(
    (effect) =>
      effect.ownerSide === "attacker" &&
      effect.intent.type === "passive.attack.up" &&
      effect.source.kind === "hero_skill",
  );
  assert.deepEqual(
    attackWidgets.map((effect) => effect.initialValue),
    [15, 15],
  );

  const staticFactors = buildStaticDamageBucketFactors(
    compiled.fighters,
    compiled.preBattleEffects,
  );
  const attackFactor =
    staticFactors.attacker.infantry[
      STATIC_BUCKET_INDEX["passive.attack.up"]
    ];
  assert.ok(Math.abs(attackFactor - 1.3) < 1e-12);
  assert.ok(Math.abs(applyStatBonusGroups(2175.1, 30, 0) - 2857.63) < 1e-9);
});
