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
  effectiveStatBonusGroups,
  getTroopRows,
  mergeSideFromOcr,
  sideFromPayload,
  toApiPayload,
  withTroopRows,
  withTroopTotals,
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


test("Gareth and pet debuffs remain side-specific in stat previews", () => {
  const attacker = defaultSide();
  const defender = defaultSide();

  attacker.gareth = 2.75;
  attacker.petModifiers.enemy_lethality = 4;
  defender.gareth = 5;

  assert.deepEqual(effectiveStatBonusGroups(attacker, defender, "attacker", "lethality", false), { up: 0, down: 5 });
  assert.deepEqual(effectiveStatBonusGroups(defender, attacker, "defender", "lethality", false), { up: 0, down: 6.75 });
  assert.deepEqual(effectiveStatBonusGroups(defender, attacker, "defender", "attack", false), { up: 0, down: 0 });
});

test("report imports remove the opposing Gareth and pet debuffs before reapplying them", () => {
  const attackerModifiers = defaultSide();
  const defenderModifiers = defaultSide();
  attackerModifiers.gareth = 1.25;
  defenderModifiers.gareth = 2.75;
  defenderModifiers.petModifiers.enemy_lethality = 5;
  const heroes = { infantry: null, lancer: null, marksman: null };
  const levels = { infantry: 0, lancer: 0, marksman: 0 };
  const ocr = {
    troops: { infantry: 1000, lancer: 0, marksman: 0 },
    stats: { infantry: { attack: 100, lethality: 900 }, lancer: {}, marksman: {} },
  };
  const attacker = mergeSideFromOcr(defaultSide(), ocr, heroes, false, "attacker", levels, attackerModifiers, defenderModifiers);
  const defender = mergeSideFromOcr(defaultSide(), ocr, heroes, false, "defender", levels, defenderModifiers, attackerModifiers);

  assert.equal(attacker.gareth, 1.25);
  assert.equal(defender.gareth, 2.75);
  assert.equal(attacker.stats.infantry.lethality, 977.5);
  assert.equal(defender.stats.infantry.lethality, 912.5);
  assert.equal(attacker.stats.infantry.attack, 100);
  const input = toBattleInput(toApiPayload(attacker, defender, 1, false), "uploaded-gareth");
  assert.equal(input.attacker.passive?.lethality?.down, 7.75);
  assert.equal(input.defender.passive?.lethality?.down, 1.25);
  assert.ok(Math.abs(applyStatBonusGroups(attacker.stats.infantry.lethality, 0, 7.75) - 900) < 1e-9);
  assert.ok(Math.abs(applyStatBonusGroups(defender.stats.infantry.lethality, 0, 1.25) - 900) < 1e-9);
  assert.equal(mergeSideFromOcr(attacker, ocr, heroes, false, "attacker", levels, defaultSide(), defaultSide()).gareth, 0);
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

test("duplicate troop rows remain independently editable after saving and reloading", () => {
  const attacker = withTroopRows(defaultSide(), [
    { id: "base", unit: "infantry", tier: "t6", count: 200 },
    { id: "duplicate", unit: "infantry", tier: "t6", count: 50 },
    { id: "fc", unit: "infantry", tier: "t6_fc5", count: 100 },
    { id: "lancer", unit: "lancer", tier: "t6", count: 10 },
  ]);
  const saved = JSON.parse(JSON.stringify(toApiPayload(attacker, defaultSide(), 1, false)));
  const loaded = sideFromPayload(saved.attacker);
  const removed = withTroopRows(loaded, getTroopRows(loaded).filter(row => row.id !== "base"));
  const moved = withTroopRows(removed, getTroopRows(removed).map(row =>
    row.id === "duplicate" ? { ...row, unit: "lancer" } : row));
  const input = toBattleInput(toApiPayload(moved, defaultSide(), 1, false), "row-regression");
  assert.deepEqual(input.attacker.troops, { infantry_t6_fc5: 100, lancer_t6: 60, marksman_t11_fc10: 0 });
  const compiled = prepareBattle(input, loadSimulatorConfig());
  assert.equal(compiled.fighters.attacker.initialTroops.infantry, 100);
  assert.equal(compiled.fighters.attacker.initialTroops.lancer, 60);
});

test("category total changes preserve mixed tiers with exact integer counts", () => {
  const state = withTroopRows(defaultSide(), [
    { id: "one", unit: "infantry", tier: "t6", count: 2 },
    { id: "two", unit: "infantry", tier: "t6_fc5", count: 1 },
    { id: "three", unit: "infantry", tier: "t6_fc10", count: 1 },
  ]);
  const scaled = withTroopTotals(state, { infantry: 3, lancer: 0, marksman: 0 });
  const input = toBattleInput(toApiPayload(scaled, defaultSide(), 1, false), "scale-regression");
  assert.deepEqual(input.attacker.troops, {
    infantry_t6: 1, infantry_t6_fc5: 1, infantry_t6_fc10: 1, lancer_t11_fc10: 0, marksman_t11_fc10: 0,
  });
  const empty = withTroopRows(scaled, []);
  const reloaded = sideFromPayload(toApiPayload(empty, defaultSide(), 1, false).attacker);
  assert.deepEqual(getTroopRows(reloaded), []);
});

test("empty primary troops preserve populated extra tiers through reload and execution", () => {
  const state = withTroopRows(defaultSide(), [
    { id: "infantry", unit: "infantry", tier: "t6", count: 0 },
    { id: "lancer", unit: "lancer", tier: "t6", count: 0 },
    { id: "marksman", unit: "marksman", tier: "t6", count: 0 },
    { id: "extra", unit: "infantry", tier: "t6_fc5", count: 100 },
  ]);
  const payload = toApiPayload(state, defaultSide(), 1, false);
  const reloaded = sideFromPayload(JSON.parse(JSON.stringify(payload.attacker)));
  const input = toBattleInput(toApiPayload(reloaded, defaultSide(), 1, false), "empty-primary");
  assert.equal(input.attacker.troops.infantry_t6, 0);
  assert.equal(input.attacker.troops.infantry_t6_fc5, 100);
});
