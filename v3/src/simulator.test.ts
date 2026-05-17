import assert from "node:assert/strict";
import { test } from "node:test";

import { loadSimulatorConfig } from "./config.js";
import { createSeededRng, chancePasses } from "./effects.js";
import { resolveFighter } from "./resolve.js";
import { simulateBattle } from "./simulator.js";
import type { ResolvedSkill, SimulatorConfig, SkillFile } from "./types.js";

test("simulateBattle returns structured result for a no-hero battle", () => {
  const config = loadSimulatorConfig();
  const result = simulateBattle(
    {
      maxRounds: 3,
      trace: true,
      attacker: {
        name: "A",
        troops: { infantry_t6: 8000 },
        stats: { inf: { attack: 10, defense: 10, lethality: 2, health: 2 } },
        heroes: {}
      },
      defender: {
        name: "D",
        troops: { infantry_t6: 500 },
        stats: { inf: { attack: 10, defense: 10, lethality: 2, health: 2 } },
        heroes: {}
      }
    },
    config
  );

  assert.match(result.winner, /attacker|defender|draw/);
  assert.ok(result.rounds >= 1);
  assert.ok(result.attacks.some((attack) => attack.kind === "normal"));
  assert.ok(result.trace?.resolved.attacker.troops.infantry);
  assert.deepEqual(result.resolved.attacker.heroes, []);
  assert.ok(result.skillReport.attacker.some((entry) => entry.sourceKind === "troop_skill"));
});

test("simulateBattle calculates all same-round damage from the round-start troop snapshot", () => {
  const config = loadSimulatorConfig();
  const result = simulateBattle(
    {
      maxRounds: 1,
      trace: true,
      attacker: {
        name: "A",
        troops: { infantry_t1: 1 },
        stats: { inf: { attack: 100000, lethality: 100000 } },
        heroes: {}
      },
      defender: {
        name: "D",
        troops: { infantry_t1: 1 },
        stats: { inf: { attack: 100000, lethality: 100000 } },
        heroes: {}
      }
    },
    config
  );

  const normalAttacks = result.attacks.filter((attack) => attack.kind === "normal");
  assert.equal(normalAttacks.length, 2);
  assert.deepEqual(
    normalAttacks.map((attack) => attack.kills),
    [1, 1]
  );
  assert.equal(result.remaining.attacker.infantry, 0);
  assert.equal(result.remaining.defender.infantry, 0);
  assert.equal(result.trace?.rounds[0]?.roundStartTroops.attacker.infantry, 1);
  assert.equal(result.trace?.rounds[0]?.roundStartTroops.defender.infantry, 1);
  assert.equal(normalAttacks[1]?.trace?.roundStartTroops.defender.infantry, 1);
});

test("simulateBattle reports resolved heroes, troop skills, activations, controls, and extra skill jobs", () => {
  const config = loadSimulatorConfig();
  const result = simulateBattle(
    {
      maxRounds: 2,
      attacker: {
        name: "A",
        troops: { marksman_t8_fc5: 900, infantry_t8_fc5: 100 },
        stats: {
          mark: { attack: 100, defense: 100, lethality: 100, health: 100 },
          inf: { attack: 100, defense: 100, lethality: 100, health: 100 }
        },
        heroes: { Alonso: { skill_1: 5, skill_2: 5, skill_3: 5 } }
      },
      defender: {
        name: "D",
        troops: { infantry_t8_fc5: 1000 },
        stats: { inf: { attack: 100, defense: 100, lethality: 100, health: 100 } },
        heroes: { Flint: { skill_1: 5, skill_2: 5, skill_3: 5 } }
      }
    },
    config
  );

  assert.ok(result.resolved.attacker.heroes.some((hero) => hero.name === "Alonso"));
  assert.ok(result.resolved.attacker.troopSkillIds.length > 0);
  assert.ok(result.skillReport.attacker.some((entry) => entry.effectActivations > 0));
  assert.ok(Object.keys(result.extraSkillAttackJobsByEffect).length > 0);
  assert.ok(result.attackControlCounts.dodge >= 0);
  assert.ok(result.attackControlCounts.no_attack >= 0);
});

test("display-name hero aliases resolve to v3 hero definitions", () => {
  const config = loadSimulatorConfig();
  const fighter = resolveFighter(
    {
      troops: { infantry_t1: 1 },
      heroes: {
        "Ling Xue": { skill_1: 1 },
        "Lumak Bokan": { skill_1: 1 },
        "Wu Ming": { skill_1: 1 }
      }
    },
    "attacker",
    config
  );

  assert.deepEqual(
    fighter.heroes.map((hero) => hero.name),
    ["Ling", "Lumak", "Wu Ming"]
  );
  assert.equal(fighter.heroes.some((hero) => hero.missing), false);
  assert.equal(fighter.diagnostics.some((line) => line.includes("Missing hero definition")), false);
});

test("attack-duration effects are consumed even when a normal attack is cancelled", () => {
  const result = simulateBattle(
    {
      maxRounds: 1,
      attacker: {
        troops: { infantry_t1: 10 },
        heroes: { Canceller: { skill_1: 1 } }
      },
      defender: {
        troops: { infantry_t1: 10 },
        heroes: {}
      }
    },
    minimalConfig({
      Canceller: {
        name: "Canceller",
        skills: {
          CancelAndDebuff: {
            trigger: { type: "attack", units: { by: "infantry" } },
            effects: {
              cancel: {
                type: "no_attack",
                value: 100,
                units: { applies_to: "trigger", applies_vs: "target" },
                duration: { type: "attack", value: 1 }
              },
              debuff: {
                type: "attack_up",
                value: 100,
                units: { applies_to: "trigger", applies_vs: "target" },
                duration: { type: "attack", value: 1 }
              }
            }
          }
        }
      }
    })
  );

  const cancelled = result.attacks.find((attack) => attack.cancelReason === "no_attack");
  assert.notEqual(cancelled, undefined);
  const cancelledAttack = cancelled!;
  assert.equal(cancelledAttack.consumedEffectIds.length, 2);
  assert.ok(cancelledAttack.consumedEffectIds.some((id) => id.includes(":cancel:")));
  assert.ok(cancelledAttack.consumedEffectIds.some((id) => id.includes(":debuff:")));
});

test("extra skill attacks with array applies_vs target those defender unit types", () => {
  const result = simulateBattle(
    {
      maxRounds: 1,
      trace: true,
      attacker: {
        troops: { marksman_t1: 100 },
        heroes: { Router: { skill_1: 1 } }
      },
      defender: {
        troops: { lancer_t1: 100, marksman_t1: 100 },
        heroes: {}
      }
    },
    minimalConfig({
      Router: {
        name: "Router",
        skills: {
          SplitHit: {
            trigger: { type: "attack", units: { by: ["marksman"] } },
            effects: {
              hitLancer: {
                type: "extra_skill_attack",
                value: 100,
                units: { applies_to: "trigger", applies_vs: ["lancer"] },
                duration: { type: "attack", value: 1 }
              },
              hitMarksman: {
                type: "extra_skill_attack",
                value: 100,
                units: { applies_to: "trigger", applies_vs: ["marksman"] },
                duration: { type: "attack", value: 1 }
              }
            }
          }
        }
      }
    })
  );

  const skillJobs = result.trace?.rounds[0]?.jobs.filter((job) => job.kind === "skill") ?? [];
  assert.deepEqual(
    skillJobs.map((job) => [job.sourceEffectId, job.defenderUnit]),
    [
      ["hitLancer", "lancer"],
      ["hitMarksman", "marksman"]
    ]
  );
});

test("engagement_type-gated triggers require matching battle mechanics", () => {
  const config = minimalConfig({
    Gated: {
      name: "Gated",
      skills: {
        RallyOnly: {
          trigger: { type: "battle_start", engagement_type: "rally" },
          effects: { rally: { type: "stat_bonus", stat: "attack", value: 10 } }
        },
        GarrisonOnly: {
          trigger: { type: "battle_start", engagement_type: "garrison" },
          effects: { garrison: { type: "stat_bonus", stat: "defense", value: 10 } }
        }
      }
    }
  });
  const input = {
    maxRounds: 0,
    attacker: {
      troops: { infantry_t1: 10 },
      heroes: { Gated: { skill_1: 1, skill_2: 1 } }
    },
    defender: {
      troops: { infantry_t1: 10 },
      heroes: {}
    }
  };

  const defaultResult = simulateBattle(input, config);
  const rallyResult = simulateBattle({ ...input, mechanics: { engagement_type: "rally" } }, config);
  const garrisonResult = simulateBattle({ ...input, mechanics: { engagement_type: "garrison" } }, config);

  assert.equal(skillActivations(defaultResult, "RallyOnly"), 0);
  assert.equal(skillActivations(defaultResult, "GarrisonOnly"), 0);
  assert.equal(skillActivations(rallyResult, "RallyOnly"), 1);
  assert.equal(skillActivations(rallyResult, "GarrisonOnly"), 0);
  assert.equal(skillActivations(garrisonResult, "RallyOnly"), 0);
  assert.equal(skillActivations(garrisonResult, "GarrisonOnly"), 1);
});

test("seeded probability rolls are deterministic and compare percentage thresholds", () => {
  const skill: ResolvedSkill = {
    id: "Chance",
    name: "Chance",
    sourceKind: "hero_skill",
    side: "attacker",
    heroName: "ChanceHero",
    level: 1,
    trigger: { type: "battle_start", probability: [50] },
    effects: []
  };
  const first = createSeededRng("same-seed");
  const second = createSeededRng("same-seed");
  const different = createSeededRng("different-seed");

  assert.deepEqual(
    [chancePasses(skill, first), chancePasses(skill, first), chancePasses(skill, first)],
    [chancePasses(skill, second), chancePasses(skill, second), chancePasses(skill, second)]
  );
  assert.deepEqual([createSeededRng("numeric")(), createSeededRng("numeric")()], [createSeededRng("numeric")(), createSeededRng("numeric")()]);
  assert.ok(different() >= 0 && different() < 1);
  assert.equal(chancePasses({ ...skill, trigger: { type: "battle_start", probability: [0] } }, createSeededRng("x")), false);
  assert.equal(chancePasses({ ...skill, trigger: { type: "battle_start", probability: [1] } }, () => 0.009), true);
  assert.equal(chancePasses({ ...skill, trigger: { type: "battle_start", probability: [1] } }, () => 0.01), false);
  assert.equal(chancePasses({ ...skill, trigger: { type: "battle_start", probability: [0.5] } }, () => 0.004), true);
  assert.equal(chancePasses({ ...skill, trigger: { type: "battle_start", probability: [0.5] } }, () => 0.005), false);
  assert.equal(chancePasses({ ...skill, trigger: { type: "battle_start", probability: [100] } }, createSeededRng("x")), true);
});

function skillActivations(result: ReturnType<typeof simulateBattle>, skillId: string): number {
  return result.skillReport.attacker.find((entry) => entry.skillId === skillId)?.skillActivations ?? 0;
}

function minimalConfig(heroDefinitions: Record<string, SkillFile> = {}): SimulatorConfig {
  return {
    troopStats: {
      infantry_t1: { id: "infantry_t1", type: "infantry", tier: 1, stats: { attack: 100, defense: 100, lethality: 100, health: 100 } },
      lancer_t1: { id: "lancer_t1", type: "lancer", tier: 1, stats: { attack: 100, defense: 100, lethality: 100, health: 100 } },
      marksman_t1: { id: "marksman_t1", type: "marksman", tier: 1, stats: { attack: 100, defense: 100, lethality: 100, health: 100 } }
    },
    heroGenerationStats: {},
    heroDefinitions,
    troopSkills: { name: "troop skills", skills: {} },
    diagnostics: { legacyFields: [], effectTypes: {}, unsupportedEffects: [] }
  };
}
