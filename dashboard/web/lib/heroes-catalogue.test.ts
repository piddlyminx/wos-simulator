import assert from "node:assert/strict";
import { test } from "node:test";

import {
  HEROES,
  TROOP_TIERS,
  TROOP_TYPES,
  isTroopTypeForCategory,
  sortHeroesByGenerationAndTroop,
  troopTypeForSelection,
} from "./heroes-catalogue";

test("troop tier options keep uncommon lower-tier FC variants out of the select", () => {
  assert.ok(TROOP_TIERS.includes("t10_fc9"));
  assert.ok(TROOP_TIERS.includes("t10_fc10"));
  assert.ok(TROOP_TIERS.includes("t11_fc9"));
  assert.ok(TROOP_TIERS.includes("t11_fc10"));
  assert.equal(TROOP_TIERS.includes("t6_fc10"), false);
  assert.equal(TROOP_TIERS.at(-1), "t11_fc10");
});

test("troop type validation uses the simulator catalogue and row category", () => {
  assert.ok(TROOP_TYPES.includes("infantry_t6_fc10"));
  assert.equal(isTroopTypeForCategory("infantry_t6_fc10", "infantry"), true);
  assert.equal(isTroopTypeForCategory("infantry_t6_fc10", "lancer"), false);
  assert.equal(
    troopTypeForSelection("infantry", "t6_fc10"),
    "infantry_t6_fc10",
  );
  assert.equal(isTroopTypeForCategory("not_a_troop", "infantry"), false);
});

test("hero catalogue includes configured metadata and skills", () => {
  const gregory = HEROES.find((hero) => hero.name === "Gregory");
  assert.deepEqual(
    {
      generation: gregory?.generation,
      troopType: gregory?.troopType,
      skills: gregory?.skills.map((skill) => [skill.id, skill.name]),
    },
    {
      generation: "Gen 10",
      troopType: "infantry",
      skills: [
        ["1", "LegionOfTheSun"],
        ["2", "ChargedAssault"],
        ["3", "Unbroken"],
        ["4", "DayOfTheGuard"],
      ],
    },
  );
});

test("hero overview order is descending generation then troop type", () => {
  const sorted = sortHeroesByGenerationAndTroop(HEROES);
  assert.deepEqual(
    sorted
      .slice(0, 6)
      .map((hero) => [hero.name, hero.generation, hero.troopType]),
    [
      ["Gregory", "Gen 10", "infantry"],
      ["Freya", "Gen 10", "lancer"],
      ["Blanchette", "Gen 10", "marksman"],
      ["Magnus", "Gen 9", "infantry"],
      ["Fred", "Gen 9", "lancer"],
      ["Xura", "Gen 9", "marksman"],
    ],
  );
  assert.deepEqual(
    sorted
      .filter((hero) => hero.generation === "SR")
      .map((hero) => [hero.name, hero.troopType]),
    [
      ["Sergey", "infantry"],
      ["Jessie", "lancer"],
      ["Ling", "lancer"],
      ["Lumak", "lancer"],
      ["Patrick", "lancer"],
      ["Bahiti", "marksman"],
      ["Jasser", "marksman"],
      ["Seo-yoon", "marksman"],
    ],
  );
});
