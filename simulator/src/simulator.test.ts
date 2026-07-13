import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { loadSimulatorConfig } from "./config";
import { createSeededRng, chancePasses } from "./effects";
import { applyHeroGenerationStats, resolveFighter } from "./resolve";
import { prepareBattle, runPrepared, simulateBearBattle, signedRemainingScore } from "./simulator";
import type { BattleInput, EffectIntentDefinition, FighterInput, ResolvedSkill, SimulationOptions, SimulatorConfig, SkillFile, UnitType } from "./types";

function runOnce(input: BattleInput, config: SimulatorConfig, options: SimulationOptions = {}) {
  return runPrepared(prepareBattle(input, config), undefined, options);
}

test("runPrepared reuses the compiled input seed when no override is supplied", () => {
  const config = loadSimulatorConfig();
  const stats = {
    inf: { attack: 200, defense: 200, lethality: 150, health: 150 },
    lanc: { attack: 200, defense: 200, lethality: 150, health: 150 },
    mark: { attack: 200, defense: 200, lethality: 150, health: 150 }
  };
  const input: BattleInput = {
    seed: "runprepared-seed-regression",
    attacker: { troops: { infantry_t6: 5000, lancer_t6: 3000, marksman_t6: 4000 }, stats, heroes: { Mia: { skill_1: 5, skill_2: 5, skill_3: 5 } } },
    defender: { troops: { infantry_t6: 5000, lancer_t6: 3000, marksman_t6: 4000 }, stats, heroes: { Greg: { skill_1: 5, skill_2: 5 } } }
  };
  const compiled = prepareBattle(input, config);
  const direct = runPrepared(compiled, input.seed);
  // Only meaningful if chance triggers make the round loop seed-sensitive.
  assert.equal(direct.randomness.deterministic, false, "expected a stochastic battle");
  // runPrepared with no seed override must reproduce an explicit compiled-input seed,
  // not silently fall back to the default seed.
  const prepared = runPrepared(compiled);
  assert.equal(prepared.winner, direct.winner);
  assert.equal(prepared.rounds, direct.rounds);
  assert.deepEqual(prepared.remaining, direct.remaining);
});

test("runPrepared returns structured result for a no-hero battle", () => {
  const config = loadSimulatorConfig();
  const result = runOnce(
    {
      maxRounds: 3,
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
    config,
    { mode: "trace" }
  );

  assert.match(result.winner, /attacker|defender|draw/);
  assert.ok(result.rounds >= 1);
  assert.ok(result.attacks.some((attack) => attack.kind === "normal"));
  assert.ok(result.trace?.resolved.attacker.troops.infantry);
  assert.deepEqual(result.resolved.attacker.heroes, []);
  assert.ok(result.skillReport.attacker.some((entry) => entry.sourceKind === "troop_skill"));
});

test("standard battle outcomes include round and applied effects without full traces", () => {
  const result = runOnce(
    {
      maxRounds: 1,
      attacker: {
        troops: { infantry_t1: 1000 },
        heroes: { Booster: { skill_1: 1 } }
      },
      defender: {
        troops: { infantry_t1: 1000 },
        heroes: {}
      }
    },
    minimalConfig({
      Booster: {
        name: "Booster",
        troop_type: "infantry",
        skills: {
          BattleBoost: {
            trigger: { type: "battle_start" },
            effects: {
              boost: {
                type: "active.hero.attack.up",
                value: 25,
                units: { applies_to: "self.infantry", applies_vs: "any" }
              }
            }
          }
        }
      }
    })
  );

  const attack = result.attacks.find((entry) => entry.attackerSide === "attacker" && entry.attackerUnit === "infantry");
  assert.equal(attack?.round, 1);
  assert.equal(attack?.appliedEffects.some((effect) => effect.effectId === "boost"), true);
  assert.equal(attack?.trace, undefined);
});

test("fast, standard, and trace recorders expose their complete output contracts", () => {
  const input: BattleInput = {
    maxRounds: 1,
    seed: "recorder-contract",
    attacker: {
      troops: { infantry_t1: 1000 },
      heroes: { RecorderHero: { skill_1: 1 } }
    },
    defender: {
      troops: { infantry_t1: 1000 },
      heroes: {}
    }
  };
  const config = minimalConfig({
    RecorderHero: {
      name: "RecorderHero",
      troop_type: "infantry",
      skills: {
        RecordedBoost: {
          trigger: { type: "battle_start" },
          effects: {
            boost: {
              type: "active.hero.attack.up",
              value: 25,
              units: { applies_to: "self.infantry", applies_vs: "any" }
            }
          }
        }
      }
    }
  });

  const fast = runOnce(input, config, { mode: "fast" });
  const standard = runOnce(input, config, { mode: "standard" });
  const trace = runOnce(input, config, { mode: "trace" });

  assert.deepEqual(semanticBattleSummary(fast), semanticBattleSummary(standard));
  assert.deepEqual(semanticBattleSummary(trace), semanticBattleSummary(standard));
  assert.deepEqual(fast.attacks, []);
  assert.deepEqual(fast.skillReport, { attacker: [], defender: [] });
  assert.equal(fast.trace, undefined);

  assert.ok(standard.attacks.length > 0);
  assert.equal(standard.attacks.every((attack) => attack.trace === undefined), true);
  assert.equal(standard.attacks.some((attack) => attack.appliedEffects.some((effect) => effect.effectId === "boost")), true);
  assert.equal(standard.trace, undefined);

  const traceAttacksWithoutEquations = trace.attacks.map(({ trace: _equation, ...attack }) => attack);
  const standardAttacksWithoutEquations = standard.attacks.map(({ trace: _equation, ...attack }) => attack);
  assert.deepEqual(traceAttacksWithoutEquations, standardAttacksWithoutEquations);
  assert.deepEqual(trace.skillReport, standard.skillReport);
  assert.ok(trace.trace);
  assert.deepEqual(trace.trace.resolved, trace.resolved);
  assert.equal(trace.trace.rounds.length, trace.rounds);
  assert.equal(trace.trace.rounds[0]?.jobs.length, trace.attacks.length);
  assert.equal(trace.attacks.every((attack) => attack.trace?.atomicBuckets !== undefined), true);
  assert.equal(trace.attacks.every((attack) => attack.trace?.aggregationGroups !== undefined), true);
});

test("simulateBearBattle runs exactly 10 rounds and leaves the bear army unchanged", () => {
  const player: FighterInput = {
    name: "Player",
    troops: { infantry_t1: 100 },
    stats: {
      infantry: {
        attack: 100000,
        defense: 100,
        lethality: 100000,
        health: 100
      }
    },
    heroes: {}
  };

  const result = simulateBearBattle(player, minimalConfig(), "bear-fixed");

  assert.equal(result.rounds, 10);
  assert.equal(result.remaining.defender.infantry, 5000);
  assert.equal(result.remaining.defender.lancer, 0);
  assert.equal(result.remaining.defender.marksman, 0);
  assert.ok(result.score > 5000);
});

test("simulateBearBattle always resolves the player army as a rally attacker", () => {
  const config = sameEffectStackingConfig("RallyHero", "add", "active.hero.lethality.up");
  config.heroDefinitions.RallyHero.skills.Overlap.requirements = [
    { level: 1, type: "engagement_type", value: "rally" }
  ];
  const player: FighterInput = {
    name: "Player",
    troops: { infantry_t1: 100 },
    stats: {
      infantry: {
        attack: 100,
        defense: 100,
        lethality: 100,
        health: 100
      }
    },
    heroes: { RallyHero: { skill_1: 1 } }
  };

  const result = simulateBearBattle(player, config, "bear-rally");

  assert.ok(result.skillReport.attacker.some((row) => row.skillName === "Overlap"));
});

test("simulateBearBattle scores uncapped per-attack damage", () => {
  const config = minimalConfig({
    Main: {
      name: "Main",
      skills: {
        MainBuff: {
          trigger: { type: "battle_start" },
          effects: { buff: { type: "active.hero.lethality.up", value: 100 } }
        }
      }
    },
    DefensiveJoiner: {
      name: "DefensiveJoiner",
      skills: {
        DefensiveBuff: {
          trigger: { type: "battle_start" },
          effects: { buff: { type: "active.hero.defense.up", value: 100 } }
        }
      }
    },
    DamageJoiner: {
      name: "DamageJoiner",
      skills: {
        DamageBuff: {
          trigger: { type: "battle_start" },
          effects: { buff: { type: "active.hero.lethality.up", value: 100 } }
        }
      }
    }
  });
  const player: FighterInput = {
    name: "Player",
    troops: { infantry_t1: 10000 },
    stats: {
      infantry: {
        attack: 1000,
        defense: 100,
        lethality: 1000,
        health: 100
      }
    },
    heroes: { Main: { skill_1: 1 } }
  };

  const defensive = simulateBearBattle(
    { ...player, joiner_heroes: { DefensiveJoiner: { skill_1: 1 } } },
    config,
    "bear-uncapped-defensive",
    { mode: "trace" }
  );
  const damage = simulateBearBattle(
    { ...player, joiner_heroes: { DamageJoiner: { skill_1: 1 } } },
    config,
    "bear-uncapped-damage",
    { mode: "trace" }
  );

  assert.ok(defensive.attacks.some((attack) => attack.kills > 5000));
  assert.ok(damage.score > defensive.score);
});

test("runPrepared calculates all same-round damage from the round-start troop snapshot", () => {
  const config = loadSimulatorConfig();
  const result = runOnce(
    {
      maxRounds: 1,
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
    config,
    { mode: "trace" }
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

test("runPrepared skips later attacks against same-round exhausted targets only", () => {
  const result = runOnce(
    {
      maxRounds: 1,
      attacker: {
        troops: { infantry_t1: 100, lancer_t1: 100 },
        stats: {
          infantry: { attack: 100000, lethality: 100000 },
          lancer: { attack: 100000, lethality: 100000 }
        },
        heroes: {}
      },
      defender: {
        troops: { infantry_t1: 1 },
        stats: { infantry: { attack: 100000, lethality: 100000 } },
        heroes: {}
      }
    },
    minimalConfig(),
    { mode: "trace" }
  );

  const normalAttacks = result.attacks.filter((attack) => attack.kind === "normal");

  assert.deepEqual(
    normalAttacks.map((attack) => attack.jobId),
    ["r1:attacker:infantry:0:normal", "r1:defender:infantry:0:normal"]
  );
  assert.equal(normalAttacks[0]?.kills, 1);
  assert.equal(normalAttacks[1]?.kills, 100);
  assert.equal(result.trace?.rounds[0]?.jobs.some((job) => job.id === "r1:attacker:lancer:1:normal"), false);
  assert.equal(result.remaining.attacker.infantry, 0);
  assert.equal(result.remaining.defender.infantry, 0);
});

test("extra skill attacks against same-round exhausted targets are skipped entirely", () => {
  const result = runOnce(
    {
      maxRounds: 1,
      attacker: {
        troops: { marksman_t1: 100 },
        stats: { marksman: { attack: 100000, lethality: 100000 } },
        heroes: { FollowUp: { skill_1: 1 } }
      },
      defender: {
        troops: { lancer_t1: 1 },
        heroes: {}
      }
    },
    minimalConfig({
      FollowUp: {
        name: "FollowUp",
        skills: {
          FollowUpShot: {
            trigger: { type: "attack", probability: 100, source: "marksman" },
            effects: {
              hitAgain: {
                type: "extra_skill_attack",
                value: 100,
                units: { applies_to: "trigger.source", applies_vs: "any" },
                trigger_damage_jobs: [{ source: "use.source", target: "use.target" }],
                duration: { attacks: { count: 1 } }
              }
            }
          }
        }
      }
    }),
    { mode: "trace" }
  );

  const normalAttack = result.attacks.find((attack) => attack.kind === "normal" && attack.attackerSide === "attacker");

  assert.equal(result.attacks.some((attack) => attack.kind === "skill"), false);
  assert.equal(result.trace?.rounds[0]?.jobs.some((job) => job.kind === "skill"), false);
  assert.deepEqual(result.extraSkillAttackJobsByEffect, {});
  assert.equal(normalAttack?.appliedEffects.some((effect) => effect.kind === "extra_attack"), false);
  assert.equal(result.remaining.defender.lancer, 0);
});

test("runPrepared carries fractional casualties between rounds and ceils final survivors", () => {
  const config = loadSimulatorConfig();
  const fixturePath = fileURLToPath(new URL("../testcases/emulator_verified/simple_001_nc.json", import.meta.url));
  const testcases = JSON.parse(readFileSync(fixturePath, "utf8")) as Array<BattleInput & { test_id: string }>;
  const input = testcases.find((testcase) => testcase.test_id === "simple_001");
  assert.notEqual(input, undefined);

  const result = runOnce(input!, config, { mode: "trace" });

  assert.equal(totalRemaining(result.remaining.attacker) - totalRemaining(result.remaining.defender), -186);
  assert.equal(result.remaining.defender.lancer, 186);
  assert.equal(result.trace?.rounds[1]?.roundStartTroops.defender.lancer.toFixed(6), "198.003308");
});

test("runPrepared defaults to a 1500 round cap when no explicit maxRounds is provided", () => {
  const result = runOnce(
    {
      attacker: { troops: {}, heroes: {} },
      defender: { troops: {}, heroes: {} }
    },
    minimalConfig()
  );

  assert.equal(result.winner, "draw");
  assert.equal(result.rounds, 1500);
});

test("round-start trigger source self.any rolls once then creates one target-locked effect per live unit type", () => {
  const result = runOnce(
    {
      maxRounds: 1,
      attacker: {
        troops: { infantry_t1: 100, lancer_t1: 100 },
        heroes: { PerUnit: { skill_1: 1 } }
      },
      defender: {
        troops: { lancer_t1: 100 },
        heroes: {}
      }
    },
    minimalConfig({
      PerUnit: {
        name: "PerUnit",
        skills: {
          RoundFanout: {
            trigger: { type: "turn", source: "self.any" },
            effects: {
              buff: {
                type: "active.hero.lethality.up",
                value: 100,
                units: { applies_to: "trigger", applies_vs: "target" },
                duration: { turns: { count: 1 } }
              }
            }
          }
        }
      }
    })
  );

  const report = result.skillReport.attacker.find((entry) => entry.skillId === "RoundFanout");
  assert.equal(report?.triggersSeen, 1);
  assert.equal(report?.skillActivations, 1);
  assert.equal(report?.effectActivations, 2);
});

test("attack trigger source and target selectors match relative to the skill owner", () => {
  const result = runOnce(
    {
      maxRounds: 1,
      attacker: {
        troops: { infantry_t1: 100, lancer_t1: 100 },
        heroes: {}
      },
      defender: {
        troops: { infantry_t1: 100 },
        heroes: { Shield: { skill_1: 1 } }
      }
    },
    minimalConfig({
      Shield: {
        name: "Shield",
        skills: {
          EnemyHitsInfantry: {
            trigger: { type: "attack", source: "enemy.any", target: "self.infantry" },
            effects: {
              guard: {
                type: "active.hero.defense.up",
                value: 100,
                units: { applies_to: "target", applies_vs: "target" },
                duration: { attacks: { count: 1 } }
              }
            }
          }
        }
      }
    })
  );

  const report = result.skillReport.defender.find((entry) => entry.skillId === "EnemyHitsInfantry");
  assert.equal(report?.triggersSeen, 2);
  assert.equal(report?.skillActivations, 2);
  assert.equal(report?.effectActivations, 2);
});

test("attack-duration effects with a round cap expire at the end of their active turn even when unused", () => {
  const result = runOnce(
    {
      maxRounds: 4,
      attacker: {
        troops: { lancer_t1: 1000000 },
        heroes: { DreamLancer: { skill_1: 1, skill_2: 1 } }
      },
      defender: {
        troops: { infantry_t1: 1000000, marksman_t1: 1000000 },
        heroes: {}
      }
    },
    minimalConfig({
      DreamLancer: {
        name: "DreamLancer",
        troop_type: "lancer",
        skills: {
          EvenTurnAmbusher: {
            trigger: { type: "turn", every: 2 },
            effects: {
              order: {
                type: "attack_order",
                value: ["marksman", "infantry", "lancer"],
                units: { applies_to: "lancer", applies_vs: "marksman" },
                duration: { turns: { count: 1 } }
              }
            }
          },
          NightmareTrace: {
            trigger: { type: "turn", every: 2, source: "lancer" },
            effects: {
              mark: {
                type: "active.hero.defense.down",
                value: 100,
                units: { applies_to: "target", applies_vs: "lancer" },
                duration: { turns: { count: 1, delay: 1 }, attacks: { count: 1 } }
              }
            }
          }
        }
      }
    }),
    { mode: "trace" }
  );

  const lancerAttacks = result.attacks.filter((attack) => attack.attackerSide === "attacker" && attack.attackerUnit === "lancer");
  assert.equal(lancerAttacks.find((attack) => attack.jobId.startsWith("r2:"))?.defenderUnit, "marksman");
  assert.equal(lancerAttacks.find((attack) => attack.jobId.startsWith("r3:"))?.defenderUnit, "infantry");
  const round4LancerAttack = lancerAttacks.find((attack) => attack.jobId.startsWith("r4:"));
  assert.equal(round4LancerAttack?.defenderUnit, "marksman");
  assert.equal(round4LancerAttack?.appliedEffects.some((effect) => effect.effectId === "mark"), false);
});

test("attack-duration effects with a round cap expire after one applicable attack", () => {
  const result = runOnce(
    {
      maxRounds: 2,
      attacker: {
        troops: { infantry_t1: 1000000 },
        heroes: { OneHit: { skill_1: 1 } }
      },
      defender: {
        troops: { infantry_t1: 1000000 },
        heroes: {}
      }
    },
    minimalConfig({
      OneHit: {
        name: "OneHit",
        troop_type: "infantry",
        skills: {
          OneAttackWindow: {
            trigger: { type: "battle_start" },
            effects: {
              boost: {
                type: "active.hero.attack.up",
                value: 100,
                units: { applies_to: "self.infantry", applies_vs: "any" },
                duration: { turns: { count: 3 }, attacks: { count: 1 } }
              }
            }
          }
        }
      }
    }),
    { mode: "trace" }
  );

  const roundOneAttack = result.attacks.find((attack) => attack.jobId.startsWith("r1:attacker:infantry") && attack.kind === "normal");
  const roundTwoAttack = result.attacks.find((attack) => attack.jobId.startsWith("r2:attacker:infantry") && attack.kind === "normal");
  assert.equal(roundOneAttack?.appliedEffects.some((effect) => effect.effectId === "boost"), true);
  assert.equal(roundTwoAttack?.appliedEffects.some((effect) => effect.effectId === "boost"), false);
});

test("attack-duration effects with a round delay are not charged before the delay is over", () => {
  const result = runOnce(
    {
      maxRounds: 2,
      attacker: {
        troops: { infantry_t1: 1000000 },
        heroes: { DelayedOneHit: { skill_1: 1 } }
      },
      defender: {
        troops: { infantry_t1: 1000000 },
        heroes: {}
      }
    },
    minimalConfig({
      DelayedOneHit: {
        name: "DelayedOneHit",
        troop_type: "infantry",
        skills: {
          DelayedAttackBudget: {
            trigger: { type: "turn" },
            effects: {
              delayedBoost: {
                type: "active.hero.attack.up",
                value: 100,
                units: { applies_to: "self.infantry", applies_vs: "any" },
                duration: { turns: { delay: 1 }, attacks: { count: 1 } }
              }
            }
          }
        }
      }
    }),
    { mode: "trace" }
  );

  const roundOneAttack = result.attacks.find((attack) => attack.jobId.startsWith("r1:attacker:infantry") && attack.kind === "normal");
  const roundTwoAttack = result.attacks.find((attack) => attack.jobId.startsWith("r2:attacker:infantry") && attack.kind === "normal");
  assert.equal(roundOneAttack?.appliedEffects.some((effect) => effect.effectId === "delayedBoost"), false);
  assert.equal(roundTwoAttack?.appliedEffects.some((effect) => effect.effectId === "delayedBoost"), true);
});

test("cancelled attacks do not charge attack-limited effects before their turn delay elapses", () => {
  const result = runOnce(
    {
      maxRounds: 2,
      attacker: {
        troops: { infantry_t1: 1000000 },
        heroes: { DelayedAfterPause: { skill_1: 1, skill_2: 1 } }
      },
      defender: {
        troops: { infantry_t1: 1000000 },
        heroes: {}
      }
    },
    minimalConfig({
      DelayedAfterPause: {
        name: "DelayedAfterPause",
        troop_type: "infantry",
        skills: {
          PauseFirstRound: {
            trigger: { type: "battle_start" },
            effects: {
              pause: {
                type: "no_attack",
                units: { applies_to: "self.infantry", applies_vs: "any" },
                duration: { turns: { count: 1 } }
              }
            }
          },
          DelayedAttackBudget: {
            trigger: { type: "turn", every: 99, first: 1 },
            effects: {
              delayedBoost: {
                type: "active.hero.attack.up",
                value: 100,
                units: { applies_to: "self.infantry", applies_vs: "any" },
                duration: { turns: { delay: 1 }, attacks: { count: 1 } }
              }
            }
          }
        }
      }
    }),
    { mode: "trace" }
  );

  const roundOne = result.attacks.find((attack) => attack.jobId.startsWith("r1:attacker:infantry"));
  const roundTwo = result.attacks.find((attack) => attack.jobId.startsWith("r2:attacker:infantry") && attack.kind === "normal");
  assert.equal(roundOne?.cancelReason, "no_attack");
  assert.equal(roundTwo?.appliedEffects.some((effect) => effect.effectId === "delayedBoost"), true);
});

test("attack delay skips eligible attacks before the effect can apply", () => {
  const result = runOnce(
    {
      maxRounds: 2,
      attacker: {
        troops: { marksman_t1: 1000000 },
        heroes: { DelayedExtra: { skill_1: 1 } }
      },
      defender: {
        troops: { infantry_t1: 1000000 },
        heroes: {}
      }
    },
    minimalConfig({
      DelayedExtra: {
        name: "DelayedExtra",
        troop_type: "marksman",
        skills: {
          NextAttack: {
            trigger: { type: "battle_start" },
            effects: {
              delayedExtra: {
                type: "extra_skill_attack",
                value: 100,
                units: { applies_to: "self.marksman", applies_vs: "any" },
                duration: { attacks: { count: 1, delay: 1 } },
                trigger_damage_jobs: [{ source: "use.source", target: "use.target" }]
              }
            }
          }
        }
      }
    })
  );

  const skillAttacks = result.attacks.filter((attack) => attack.kind === "skill" && attack.attackerSide === "attacker");
  assert.equal(skillAttacks.length, 1);
  assert.ok(skillAttacks[0].jobId.startsWith("r2:"));
});


test("attack delay skips eligible damage jobs before a modifier can apply", () => {
  const result = runOnce(
    {
      maxRounds: 2,
      attacker: {
        troops: { infantry_t1: 1000000 },
        heroes: { DelayedModifier: { skill_1: 1 } }
      },
      defender: {
        troops: { infantry_t1: 1000000 },
        heroes: {}
      }
    },
    minimalConfig({
      DelayedModifier: {
        name: "DelayedModifier",
        troop_type: "infantry",
        skills: {
          NextAttackBoost: {
            trigger: { type: "battle_start" },
            effects: {
              delayedBoost: {
                type: "active.hero.attack.up",
                value: 100,
                units: { applies_to: "self.infantry", applies_vs: "any" },
                duration: { attacks: { count: 1, delay: 1 } }
              }
            }
          }
        }
      }
    }),
    { mode: "trace" }
  );

  const normalAttacks = result.attacks.filter(
    (attack) => attack.kind === "normal" && attack.attackerSide === "attacker"
  );
  assert.equal(normalAttacks[0].appliedEffects.some((effect) => effect.effectId === "delayedBoost"), false);
  assert.equal(normalAttacks[1].appliedEffects.some((effect) => effect.effectId === "delayedBoost"), true);
});


test("runPrepared reports resolved heroes, troop skills, activations, controls, and extra skill jobs", () => {
  const config = loadSimulatorConfig();
  const result = runOnce(
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

test("display-name hero aliases resolve to simulator hero definitions", () => {
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

test("applyHeroGenerationStats bakes main hero generation stats into authoritative input stats", () => {
  const config = minimalConfig({
    Example: {
      name: "Example",
      hero_generation: "S1",
      skills: {}
    }
  });
  config.heroGenerationStats.S1 = { attack: 50, defense: 40, lethality: 30, health: 20 };
  const input = {
    troops: { infantry_t1: 10 },
    stats: { inf: { attack: 1, defense: 2, lethality: 3, health: 4 } },
    heroes: { Example: { skill_1: 1 } }
  };

  const defaultFighter = resolveFighter(input, "attacker", config);
  const bakedFighter = resolveFighter(applyHeroGenerationStats(input, config), "attacker", config);

  assert.deepEqual(defaultFighter.statBonuses.infantry, { attack: 1, defense: 2, lethality: 3, health: 4 });
  assert.deepEqual(bakedFighter.statBonuses.infantry, { attack: 51, defense: 42, lethality: 33, health: 24 });
});

test("array joiner heroes preserve duplicate skill instances", () => {
  const result = runOnce(
    {
      maxRounds: 1,
      attacker: {
        troops: { infantry_t1: 100 },
        heroes: [],
        joiner_heroes: [
          { name: "Repeat", levels: { skill_1: 1 } },
          { name: "Repeat", levels: { skill_1: 1 } }
        ]
      },
      defender: {
        troops: { infantry_t1: 100 },
        heroes: {}
      }
    },
    minimalConfig({
      Repeat: {
        name: "Repeat",
        skills: {
          Buff: {
            trigger: { type: "battle_start" },
            effects: {
              boost: {
                type: "active.hero.lethality.up",
                value: 10,
                units: { applies_to: "self.infantry", applies_vs: "enemy.infantry" },
                duration: {},
                same_effect_stacking: "add"
              }
            }
          }
        }
      }
    })
  );

  const reports = result.skillReport.attacker.filter((entry) => entry.heroName === "Repeat" && entry.skillId === "Buff");
  assert.equal(reports.length, 2);
  assert.deepEqual(
    reports.map((entry) => entry.effectActivations),
    [1, 1]
  );
});

test("joiner hero generation stats are not applied when main hero stats are enabled", () => {
  const config = minimalConfig({
    Main: {
      name: "Main",
      hero_generation: "S1",
      skills: {}
    },
    Joiner: {
      name: "Joiner",
      hero_generation: "S2",
      skills: {
        JoinerBuff: {
          trigger: { type: "battle_start" },
          effects: {}
        }
      }
    }
  });
  config.heroGenerationStats.S1 = { attack: 10, defense: 20, lethality: 30, health: 40 };
  config.heroGenerationStats.S2 = { attack: 100, defense: 200, lethality: 300, health: 400 };

  const fighter = resolveFighter(
    applyHeroGenerationStats(
      {
        troops: { infantry_t1: 10 },
        stats: { inf: { attack: 1, defense: 2, lethality: 3, health: 4 } },
        heroes: [{ name: "Main", levels: {} }],
        joiner_heroes: [{ name: "Joiner", levels: { skill_1: 1 } }]
      },
      config
    ),
    "attacker",
    config
  );

  assert.deepEqual(fighter.statBonuses.infantry, { attack: 11, defense: 22, lethality: 33, health: 44 });
});

test("cancelled attacks report the winning control as an applied effect", () => {
  const result = runOnce(
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
            trigger: { type: "attack", source: "infantry" },
            effects: {
              cancel: {
                type: "no_attack",
                value: 100,
                units: { applies_to: "trigger", applies_vs: "target" },
                duration: { attacks: { count: 1 } }
              },
              debuff: {
                type: "active.hero.attack.up",
                value: 100,
                units: { applies_to: "trigger", applies_vs: "target" },
                duration: { attacks: { count: 1 } }
              }
            }
          }
        }
      }
    }),
    { mode: "trace" }
  );

  const cancelled = result.attacks.find((attack) => attack.cancelReason === "no_attack");
  assert.notEqual(cancelled, undefined);
  const cancelledAttack = cancelled!;
  assert.equal(cancelledAttack.appliedEffects.length, 1);
  const controlEvent = cancelledAttack.appliedEffects[0];
  assert.equal(controlEvent.kind, "control");
  assert.equal(controlEvent.kind === "control" && controlEvent.reason, "no_attack");
  assert.ok(controlEvent.activeEffectId.includes(":cancel:"));
  assert.deepEqual(cancelledAttack.counterDeltas, [
    { side: "attacker", unit: "infantry", counter: "attacks", by: 1, cause: "normal_attack" },
    { side: "defender", unit: "infantry", counter: "received_attacks", by: 1, cause: "normal_attack" }
  ]);
});

test("no_attack applies_to cancels that unit attacking, not attacks targeting that unit", () => {
  const result = runOnce(
    {
      maxRounds: 1,
      attacker: {
        troops: { infantry_t1: 1000, lancer_t1: 1000 },
        heroes: { StopInfantry: { skill_1: 1 } }
      },
      defender: {
        troops: { infantry_t1: 1000, lancer_t1: 1000 },
        heroes: {}
      }
    },
    minimalConfig({
      StopInfantry: {
        name: "StopInfantry",
        skills: {
          Pause: {
            trigger: { type: "attack", source: "infantry" },
            effects: {
              stop: {
                type: "no_attack",
                units: { applies_to: "trigger", applies_vs: "target" },
                duration: { turns: { count: 1 } }
              }
            }
          }
        }
      }
    })
  );

  assert.deepEqual(
    result.attacks.filter((attack) => attack.cancelReason === "no_attack").map((attack) => attack.jobId),
    ["r1:attacker:infantry:0:cancelled"]
  );
  assert.equal(
    result.attacks.some((attack) => attack.attackerSide === "defender" && attack.defenderSide === "attacker" && attack.defenderUnit === "infantry" && attack.cancelReason === "no_attack"),
    false
  );
});

test("dodge applies_to cancels attacks targeting that unit, not that unit attacking", () => {
  const result = runOnce(
    {
      maxRounds: 1,
      attacker: {
        troops: { infantry_t1: 1000 },
        heroes: {}
      },
      defender: {
        troops: { infantry_t1: 1000, lancer_t1: 1000 },
        heroes: { Dodger: { skill_1: 1 } }
      }
    },
    minimalConfig({
      Dodger: {
        name: "Dodger",
        skills: {
          StepAside: {
            trigger: { type: "attack", source: "enemy.infantry", target: "self.infantry" },
            effects: {
              evade: {
                type: "dodge",
                units: { applies_to: "target", applies_vs: "trigger" },
                duration: { attacks: { count: 1 } }
              }
            }
          }
        }
      }
    })
  );

  assert.deepEqual(
    result.attacks.filter((attack) => attack.cancelReason === "dodge").map((attack) => attack.jobId),
    ["r1:attacker:infantry:0:cancelled"]
  );
  assert.equal(
    result.attacks.some((attack) => attack.attackerSide === "defender" && attack.attackerUnit === "infantry" && attack.cancelReason === "dodge"),
    false
  );
});

test("attack-declared controls from later intents affect earlier same-round attacks", () => {
  const result = runOnce(
    {
      maxRounds: 1,
      attacker: {
        troops: { infantry_t1: 1000 },
        heroes: {}
      },
      defender: {
        troops: { infantry_t1: 1000 },
        heroes: { ReactiveDodge: { skill_1: 1 } }
      }
    },
    minimalConfig({
      ReactiveDodge: {
        name: "ReactiveDodge",
        skills: {
          StepAside: {
            trigger: { type: "attack", source: "infantry" },
            effects: {
              evade: {
                type: "dodge",
                units: { applies_to: "self.infantry", applies_vs: "any" },
                duration: { turns: { count: 1 } }
              }
            }
          }
        }
      }
    })
  );

  assert.deepEqual(
    result.attacks.filter((attack) => attack.cancelReason === "dodge").map((attack) => attack.jobId),
    ["r1:attacker:infantry:0:cancelled"]
  );
});

test("attack-duration effects charged on a cancelled attack unless useEffectsOnNoAttack is disabled", () => {
  // Round 1: the attacker's infantry attack is cancelled while an attack-1-duration buff is
  // active. By default the cancelled attack charges the buff, so round 2 lands without it;
  // with useEffectsOnNoAttack:false the buff survives to boost round 2.
  const input = {
    maxRounds: 2,
    seed: "cancel-charge",
    attacker: {
      troops: { infantry_t1: 1000 },
      heroes: { SelfStunned: { skill_1: 1 } }
    },
    defender: {
      troops: { infantry_t1: 1000 },
      heroes: {}
    }
  };
  const config = minimalConfig({
    SelfStunned: {
      name: "SelfStunned",
      skills: {
        StunAndBuff: {
          trigger: { type: "battle_start" },
          effects: {
            stun: {
              type: "no_attack",
              value: 100,
              units: { applies_to: "self.infantry", applies_vs: "any" },
              duration: { turns: { count: 1, delay: 1 } }
            },
            buff: {
              type: "active.hero.attack.up",
              value: 100,
              units: { applies_to: "self.infantry", applies_vs: "any" },
              duration: { attacks: { count: 1 } }
            }
          }
        }
      }
    }
  });

  const roundTwoKills = (options: SimulationOptions): number => {
    const result = runOnce(input, config, options);
    const attack = result.attacks.find((entry) => entry.kind === "normal" && entry.jobId.startsWith("r2:attacker:infantry"));
    assert.notEqual(attack, undefined);
    return attack!.kills;
  };

  const charged = roundTwoKills({});
  const uncharged = roundTwoKills({ useEffectsOnNoAttack: false });
  assert.ok(uncharged > charged, `expected uncharged buff to boost round 2 (${uncharged} > ${charged})`);
});

test("cancelled normal attacks advance attack counters for later frequency checks", () => {
  const result = runOnce(
    {
      maxRounds: 4,
      attacker: {
        troops: { infantry_t1: 100 },
        heroes: { EveryOtherCancel: { skill_1: 1 } }
      },
      defender: {
        troops: { infantry_t1: 100 },
        heroes: {}
      }
    },
    minimalConfig({
      EveryOtherCancel: {
        name: "EveryOtherCancel",
        skills: {
          Pause: {
            trigger: { type: "attack", every: 2, source: "infantry" },
            effects: {
              cancel: {
                type: "no_attack",
                units: { applies_to: "trigger", applies_vs: "target" },
                duration: { attacks: { count: 1 } }
              }
            }
          }
        }
      }
    })
  );

  assert.deepEqual(
    result.attacks.filter((attack) => attack.cancelReason === "no_attack").map((attack) => attack.jobId),
    ["r2:attacker:infantry:0:cancelled", "r4:attacker:infantry:0:cancelled"]
  );
});

test("attack frequency triggers can start at a different first threshold", () => {
  const result = runOnce(
    {
      maxRounds: 14,
      attacker: {
        troops: { infantry_t1: 10000 },
        heroes: { FirstThenEvery: { skill_1: 1 } }
      },
      defender: {
        troops: { infantry_t1: 10000 },
        heroes: {}
      }
    },
    minimalConfig({
      FirstThenEvery: {
        name: "FirstThenEvery",
        skills: {
          Pause: {
            trigger: { type: "attack", first: 4, every: 5, source: "infantry" },
            effects: {
              cancel: {
                type: "no_attack",
                units: { applies_to: "trigger", applies_vs: "target" },
                duration: { attacks: { count: 1 } }
              }
            }
          }
        }
      }
    })
  );

  assert.deepEqual(
    result.attacks.filter((attack) => attack.cancelReason === "no_attack").map((attack) => attack.jobId),
    ["r4:attacker:infantry:0:cancelled", "r9:attacker:infantry:0:cancelled", "r14:attacker:infantry:0:cancelled"]
  );
});

test("same_effect_stacking max caps overlapping modifier activations while add stacks them", () => {
  const maxResult = runOnce(sameEffectStackingInput("MaxStacker"), sameEffectStackingConfig("MaxStacker", "max", "active.hero.lethality.up"), { mode: "trace" });
  const addResult = runOnce(sameEffectStackingInput("AddStacker"), sameEffectStackingConfig("AddStacker", "add", "active.hero.lethality.up"), { mode: "trace" });

  const maxRoundTwo = maxResult.attacks.find((attack) => attack.jobId.startsWith("r2:attacker:infantry") && attack.kind === "normal");
  const addRoundTwo = addResult.attacks.find((attack) => attack.jobId.startsWith("r2:attacker:infantry") && attack.kind === "normal");

  assert.equal(maxRoundTwo?.trace?.atomicBuckets["active.hero.lethality.up"].totalPct, 100);
  assert.equal(maxRoundTwo?.trace?.atomicBuckets["active.hero.lethality.up"].contributors.length, 1);
  assert.equal(addRoundTwo?.trace?.atomicBuckets["active.hero.lethality.up"].totalPct, 200);
  assert.equal(addRoundTwo?.trace?.atomicBuckets["active.hero.lethality.up"].contributors.length, 2);
});

test("same_effect_stacking max caps duplicate hero instances of the same skill effect", () => {
  const result = runOnce(
    {
      maxRounds: 1,
      attacker: {
        troops: { infantry_t1: 100 },
        heroes: [{ name: "Repeat", levels: { skill_1: 1 } }],
        joiner_heroes: [{ name: "Repeat", levels: { skill_1: 1 } }]
      },
      defender: {
        troops: { infantry_t1: 100 },
        heroes: {}
      }
    },
    sameEffectStackingConfig("Repeat", "max", "active.hero.lethality.up"),
    { mode: "trace" }
  );

  const attack = result.attacks.find((entry) => entry.jobId.startsWith("r1:attacker:infantry") && entry.kind === "normal");
  assert.equal(result.skillReport.attacker.filter((entry) => entry.heroName === "Repeat" && entry.skillId === "Overlap").length, 2);
  assert.equal(attack?.trace?.atomicBuckets["active.hero.lethality.up"].totalPct, 100);
  assert.equal(attack?.trace?.atomicBuckets["active.hero.lethality.up"].contributors.length, 1);
});

test("same_effect_stacking max caps overlapping extra skill attacks while add keeps all activations", () => {
  const maxResult = runOnce(sameEffectStackingInput("MaxExtra"), sameEffectStackingConfig("MaxExtra", "max", "extra_skill_attack"), { mode: "trace" });
  const addResult = runOnce(sameEffectStackingInput("AddExtra"), sameEffectStackingConfig("AddExtra", "add", "extra_skill_attack"), { mode: "trace" });

  const maxRoundTwoSkillJobs = maxResult.trace?.rounds[1]?.jobs.filter((job) => job.kind === "skill") ?? [];
  const addRoundTwoSkillJobs = addResult.trace?.rounds[1]?.jobs.filter((job) => job.kind === "skill") ?? [];

  assert.equal(maxRoundTwoSkillJobs.length, 1);
  assert.equal(addRoundTwoSkillJobs.length, 2);
  assert.deepEqual(maxResult.extraSkillAttackJobsByEffect, { stacking: 2 });
  assert.deepEqual(addResult.extraSkillAttackJobsByEffect, { stacking: 3 });
});

test("same_effect_stacking max consumes overlapping attack-duration extra skill effects as one group", () => {
  const result = runOnce(
    {
      maxRounds: 2,
      attacker: {
        troops: { infantry_t1: 10000 },
        heroes: { MaxExtraAttackDuration: { skill_1: 1 } }
      },
      defender: {
        troops: { infantry_t1: 10000 },
        heroes: {}
      }
    },
    minimalConfig({
      MaxExtraAttackDuration: {
        name: "MaxExtraAttackDuration",
        skills: {
          Overlap: {
            trigger: { type: "turn" },
            effects: {
              hitAgain: {
                type: "extra_skill_attack",
                value: 100,
                same_effect_stacking: "max",
                units: { applies_to: ["infantry"], applies_vs: "any" },
                trigger_damage_jobs: [{ source: "use.source", target: "use.target" }],
                duration: { attacks: { count: 2 } }
              }
            }
          }
        }
      }
    }),
    { mode: "trace" }
  );

  const roundTwoNormalOutcome = result.attacks.find((attack) => attack.kind === "normal" && attack.jobId.startsWith("r2:attacker:infantry"));
  const roundTwoSkillOutcome = result.attacks.find((attack) => attack.kind === "skill" && attack.jobId.startsWith("r2:attacker:infantry"));

  assert.notEqual(roundTwoNormalOutcome, undefined);
  const extraAttackEvents = roundTwoNormalOutcome!.appliedEffects.filter((event) => event.kind === "extra_attack");
  assert.equal(extraAttackEvents.length, 1);
  assert.equal(extraAttackEvents[0].kind === "extra_attack" && extraAttackEvents[0].spawnedJobIds.length, 1);
  assert.notEqual(roundTwoSkillOutcome, undefined);
  assert.equal(roundTwoSkillOutcome!.appliedEffects.some((event) => event.kind === "extra_attack"), false);
});

test("requires_effect is ignored by native simulator effect activation", () => {
  const result = runOnce(
    {
      maxRounds: 0,
      attacker: {
        troops: { infantry_t1: 10 },
        heroes: { LegacyDependency: { skill_1: 1 } }
      },
      defender: {
        troops: { infantry_t1: 10 },
        heroes: {}
      }
    },
    minimalConfig({
      LegacyDependency: {
        name: "LegacyDependency",
        skills: {
          BothEffectsActivate: {
            trigger: { type: "battle_start" },
            effects: {
              base: {
                type: "passive.attack.up",
                value: 10
              },
              legacyDependent: {
                ...({ requires_effect: "missing-effect" } as Record<string, unknown>),
                type: "passive.defense.up",
                value: 10
              }
            }
          }
        }
      }
    })
  );

  const report = result.skillReport.attacker.find((entry) => entry.skillId === "BothEffectsActivate");
  assert.equal(report?.effectActivations, 2);
});

test("fighter passive effects are added to the static profile after battle_start effects", () => {
  const result = runOnce(
    {
      maxRounds: 1,
      attacker: {
        troops: { infantry_t1: 100 },
        stats: { infantry: { attack: 0, lethality: 0, defense: 0, health: 0 } },
        passive: {
          attack: { up: 20, down: 5 }
        },
        heroes: { BattleStart: { skill_1: 1 } }
      },
      defender: {
        troops: { infantry_t1: 100 },
        stats: { infantry: { attack: 0, lethality: 0, defense: 0, health: 0 } },
        heroes: {}
      }
    },
    minimalConfig({
      BattleStart: {
        name: "BattleStart",
        skills: {
          StartsFirst: {
            trigger: { type: "battle_start" },
            effects: {
              skillBuff: {
                type: "passive.attack.up",
                value: 10
              }
            }
          }
        }
      }
    }),
    { mode: "trace" }
  );

  const attack = result.attacks.find((entry) => entry.attackerSide === "attacker" && entry.attackerUnit === "infantry");
  assert.equal(attack?.trace?.atomicBuckets["passive.attack.up"].totalPct, 30);
  assert.equal(attack?.trace?.atomicBuckets["passive.attack.down"].totalPct, 5);
  assert.deepEqual(
    attack?.trace?.atomicBuckets["passive.attack.up"].contributors.map((contributor) => contributor.effectId).sort(),
    ["input:passive.attack.up", "skillBuff"]
  );
});

test("extra skill attacks with array trigger damage targets hit those defender unit types", () => {
  const result = runOnce(
    {
      maxRounds: 1,
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
            trigger: { type: "attack", source: "marksman" },
            effects: {
              hitLancer: {
                type: "extra_skill_attack",
                value: 100,
                units: { applies_to: "trigger.source", applies_vs: "any" },
                trigger_damage_jobs: [{ source: "use.source", target: ["lancer"] }],
                duration: { attacks: { count: 1 } }
              },
              hitMarksman: {
                type: "extra_skill_attack",
                value: 100,
                units: { applies_to: "trigger.source", applies_vs: "any" },
                trigger_damage_jobs: [{ source: "use.source", target: ["marksman"] }],
                duration: { attacks: { count: 1 } }
              }
            }
          }
        }
      }
    }),
    { mode: "trace" }
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

test('extra skill attacks with applies_vs "any" keep current-target compatibility', () => {
  const result = runOnce(
    {
      maxRounds: 1,
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
          SingleHit: {
            trigger: { type: "attack", source: "marksman" },
            effects: {
              hitAny: {
                type: "extra_skill_attack",
                value: 100,
                units: { applies_to: "trigger.source", applies_vs: "any" },
                trigger_damage_jobs: [{ source: "use.source", target: "use.target" }],
                duration: { attacks: { count: 1 } }
              }
            }
          }
        }
      }
    }),
    { mode: "trace" }
  );

  const skillJobs = result.trace?.rounds[0]?.jobs.filter((job) => job.kind === "skill") ?? [];
  assert.deepEqual(
    skillJobs.map((job) => [job.sourceEffectId, job.defenderUnit]),
    [["hitAny", "lancer"]]
  );
});

test("skill report attributes kills only to the skill damage source", () => {
  const result = runOnce(
    {
      maxRounds: 1,
      attacker: {
        troops: { marksman_t1: 100 },
        heroes: { Shooter: { skill_1: 1 } }
      },
      defender: {
        troops: { infantry_t1: 100 },
        heroes: { Guard: { skill_1: 1 } }
      }
    },
    minimalConfig({
      Shooter: {
        name: "Shooter",
        skills: {
          PowerShot: {
            trigger: { type: "attack", source: "marksman" },
            effects: {
              shot: {
                type: "extra_skill_attack",
                value: 100,
                units: { applies_to: "trigger.source", applies_vs: "trigger.target" },
                trigger_damage_jobs: [{ source: "use.source", target: "use.target" }],
                duration: { attacks: { count: 1 } }
              }
            }
          }
        }
      },
      Guard: {
        name: "Guard",
        skills: {
          CrystalShield: {
            trigger: { type: "attack", source: "enemy.any", target: "self.infantry" },
            effects: {
              shield: {
                type: "active.hero.defense.up",
                value: 50,
                units: { applies_to: "trigger.target", applies_vs: "trigger.source" },
                duration: { attacks: { count: 1 } }
              }
            }
          }
        }
      }
    }),
    { mode: "trace" }
  );

  const powerShot = result.skillReport.attacker.find((entry) => entry.skillId === "PowerShot");
  const crystalShield = result.skillReport.defender.find((entry) => entry.skillId === "CrystalShield");
  const skillOutcome = result.attacks.find((entry) => entry.kind === "skill");
  const skillJob = result.trace?.rounds.flatMap((round) => round.jobs).find((entry) => entry.kind === "skill");

  assert.ok((powerShot?.skillKills ?? 0) > 0);
  assert.equal(crystalShield?.skillKills, 0);
  assert.match(skillOutcome?.sourceSkillReportKey ?? "", /PowerShot/);
  assert.equal(skillJob?.sourceSkillReportKey, skillOutcome?.sourceSkillReportKey);
});

test("same-round outcomes are capped to available target troops before tracing skill kills", () => {
  const result = runOnce(
    {
      maxRounds: 1,
      attacker: {
        troops: { marksman_t1: 1000 },
        heroes: { Blaster: { skill_1: 1 } }
      },
      defender: {
        troops: { infantry_t1: 10 },
        heroes: {}
      }
    },
    minimalConfig({
      Blaster: {
        name: "Blaster",
        skills: {
          DoubleBlast: {
            trigger: { type: "attack", source: "marksman" },
            effects: {
              first: {
                type: "extra_skill_attack",
                value: 500,
                units: { applies_to: "trigger.source", applies_vs: "trigger.target" },
                trigger_damage_jobs: [{ source: "use.source", target: "use.target" }],
                duration: { attacks: { count: 1 } }
              },
              second: {
                type: "extra_skill_attack",
                value: 500,
                units: { applies_to: "trigger.source", applies_vs: "trigger.target" },
                trigger_damage_jobs: [{ source: "use.source", target: "use.target" }],
                duration: { attacks: { count: 1 } }
              }
            }
          }
        }
      }
    }),
    { mode: "trace" }
  );

  const defenderLosses = result.attacks
    .filter((attack) => attack.defenderSide === "defender" && attack.defenderUnit === "infantry")
    .reduce((sum, attack) => sum + attack.kills, 0);
  const doubleBlast = result.skillReport.attacker.find((entry) => entry.skillId === "DoubleBlast");

  assert.equal(Number(defenderLosses.toFixed(6)), 10);
  assert.ok((doubleBlast?.skillKills ?? 0) <= 10);
  assert.equal(result.remaining.defender.infantry, 0);
});

test("same-round cap does not leave exhausted units targetable through floating point residue", () => {
  const config = loadSimulatorConfig();
  const fixturePath = fileURLToPath(new URL("../testcases/emulator_verified/sergey_solo_nc.json", import.meta.url));
  const testcases = JSON.parse(readFileSync(fixturePath, "utf8")) as Array<BattleInput & { test_id: string }>;
  const input = testcases.find((testcase) => testcase.test_id === "sergey_solo");
  if (!input) throw new Error("missing sergey_solo fixture");

  const result = runOnce(input, config);

  assert.equal(result.winner, "attacker");
  assert.equal(result.remaining.attacker.marksman, 1349);
  assert.deepEqual(result.remaining.defender, { infantry: 0, lancer: 0, marksman: 0 });
});

test("committed losses clamp exhausted floating point residue before next-round target selection", () => {
  const result = runOnce(
    {
      maxRounds: 2,
      attacker: {
        troops: { infantry_t1: 10, lancer_t1: 100 },
        heroes: {}
      },
      defender: {
        troops: { infantry_t1: 1000, lancer_t1: 1000, marksman_t1: 1000 },
        stats: {
          infantry: { attack: 1, lethality: 1 },
          lancer: { attack: 1, lethality: 1 },
          marksman: { attack: 1, lethality: 1 }
        },
        heroes: {}
      }
    },
    minimalConfig(),
    { mode: "trace" }
  );
  const roundOneInfantryLosses = result.attacks
    .filter((attack) => attack.jobId.startsWith("r1:") && attack.defenderSide === "attacker" && attack.defenderUnit === "infantry")
    .map((attack) => attack.kills);
  const roundTwo = result.trace?.rounds.find((round) => round.round === 2);
  const defenderTargets = roundTwo?.intents
    .filter((intent) => intent.attackerSide === "defender")
    .map((intent) => intent.defenderUnit);

  assert.ok(roundOneInfantryLosses.every((kills) => !Number.isInteger(kills)));
  assert.equal(roundOneInfantryLosses.reduce((sum, kills) => sum + kills, 0), 10);
  assert.equal(roundTwo?.roundStartTroops.attacker.infantry, 0);
  assert.deepEqual(defenderTargets, ["lancer", "lancer", "lancer"]);
});

test("extra skill trigger damage jobs reject missing runtime selectors", () => {
  assert.throws(
    () =>
      runOnce(
        {
          maxRounds: 1,
          attacker: {
            troops: { marksman_t1: 100 },
            heroes: { Malformed: { skill_1: 1 } }
          },
          defender: {
            troops: { lancer_t1: 100 },
            heroes: {}
          }
        },
        minimalConfig({
          Malformed: {
            name: "Malformed",
            skills: {
              MissingSelector: {
                trigger: { type: "attack", probability: 100, source: "marksman" },
                effects: {
                  hitAgain: {
                    type: "extra_skill_attack",
                    value: 100,
                    units: { applies_to: "trigger.source", applies_vs: "any" },
                    trigger_damage_jobs: [{ source: "use.source" } as never],
                    duration: { attacks: { count: 1 } }
                  }
                }
              }
            }
          }
        }),
        { mode: "trace" }
      ),
    /target selector is required/i
  );
});

test("extra skill attacks reject missing trigger damage jobs at activation", () => {
  assert.throws(
    () =>
      runOnce(
        {
          maxRounds: 1,
          attacker: {
            troops: { marksman_t1: 100 },
            heroes: { Malformed: { skill_1: 1 } }
          },
          defender: {
            troops: { lancer_t1: 100 },
            heroes: {}
          }
        },
        minimalConfig({
          Malformed: {
            name: "Malformed",
            skills: {
              MissingJobs: {
                trigger: { type: "attack", probability: 100, source: "marksman" },
                effects: {
                  hitAgain: {
                    type: "extra_skill_attack",
                    value: 100,
                    units: { applies_to: "trigger.source", applies_vs: "any" },
                    duration: { attacks: { count: 1 } }
                  }
                }
              }
            }
          }
        })
      ),
    /extra_skill_attack.*trigger_damage_jobs/i
  );
});

test("attack-triggered extra skill attacks activate then resolve trigger damage jobs on normal attack use", () => {
  const result = runOnce(
    {
      maxRounds: 1,
      attacker: {
        troops: { marksman_t1: 100 },
        heroes: { FollowUp: { skill_1: 1 } }
      },
      defender: {
        troops: { lancer_t1: 100 },
        heroes: {}
      }
    },
    minimalConfig({
      FollowUp: {
        name: "FollowUp",
        skills: {
          FollowUpShot: {
            trigger: { type: "attack", probability: 100, source: "marksman" },
            effects: {
              hitAgain: {
                type: "extra_skill_attack",
                value: 100,
                units: { applies_to: "trigger.source", applies_vs: "any" },
                trigger_damage_jobs: [{ source: "use.source", target: "use.target" }],
                duration: { attacks: { count: 1 } }
              }
            }
          }
        }
      }
    }),
    { mode: "trace" }
  );

  const jobs = result.trace?.rounds[0]?.jobs ?? [];
  const normalJobs = jobs.filter((job) => job.kind === "normal");
  const skillJobs = jobs.filter((job) => job.kind === "skill");

  assert.equal(normalJobs.length, 2);
  assert.equal(skillJobs.length, 1);
  assert.equal(skillJobs[0]?.attackerSide, normalJobs[0]?.attackerSide);
  assert.equal(skillJobs[0]?.attackerUnit, normalJobs[0]?.attackerUnit);
  assert.equal(skillJobs[0]?.defenderSide, normalJobs[0]?.defenderSide);
  assert.equal(skillJobs[0]?.defenderUnit, normalJobs[0]?.defenderUnit);
});

test("cancelled normal attacks do not consume extra skill attack uses", () => {
  const result = runOnce(
    {
      maxRounds: 2,
      attacker: {
        troops: { marksman_t1: 100 },
        heroes: { FollowUp: { skill_1: 1 } }
      },
      defender: {
        troops: { infantry_t1: 100 },
        heroes: { Canceller: { skill_1: 1 } }
      }
    },
    minimalConfig({
      FollowUp: {
        name: "FollowUp",
        skills: {
          OneUseFollowUp: {
            trigger: { type: "battle_start" },
            effects: {
              hitAgain: {
                type: "extra_skill_attack",
                value: 100,
                units: { applies_to: ["marksman"], applies_vs: "any" },
                trigger_damage_jobs: [{ source: "use.source", target: "use.target" }],
                duration: { attacks: { count: 1 } }
              }
            }
          }
        }
      },
      Canceller: {
        name: "Canceller",
        skills: {
          CancelFirstMarksman: {
            trigger: { type: "battle_start" },
            effects: {
              cancel: {
                type: "no_attack",
                value: 100,
                units: { applies_to: "enemy.marksman", applies_vs: "any" },
                duration: { attacks: { count: 1 } }
              }
            }
          }
        }
      }
    }),
    { mode: "trace" }
  );

  const cancelled = result.attacks.find((attack) => attack.cancelReason === "no_attack");
  assert.notEqual(cancelled, undefined);
  assert.equal(cancelled!.appliedEffects.some((event) => event.kind === "extra_attack"), false);

  const skillJobsByRound = result.trace?.rounds.map((round) => round.jobs.filter((job) => job.kind === "skill").length) ?? [];
  assert.deepEqual(skillJobsByRound, [0, 1]);
  assert.deepEqual(result.extraSkillAttackJobsByEffect, { hitAgain: 1 });
});

test("extra skill attack effects cannot be used by later enemy normal attacks", () => {
  const result = runOnce(
    {
      maxRounds: 1,
      attacker: {
        troops: { marksman_t1: 100 },
        heroes: { FollowUp: { skill_1: 1 } }
      },
      defender: {
        troops: { infantry_t1: 100, lancer_t1: 100 },
        heroes: {}
      }
    },
    minimalConfig({
      FollowUp: {
        name: "FollowUp",
        skills: {
          FollowUpShot: {
            trigger: { type: "attack", probability: 100, source: "marksman" },
            effects: {
              hitAgain: {
                type: "extra_skill_attack",
                value: 100,
                units: { applies_to: "trigger.source", applies_vs: "any" },
                trigger_damage_jobs: [{ source: "use.source", target: "use.target" }],
                duration: { attacks: { count: 2 } }
              }
            }
          }
        }
      }
    }),
    { mode: "trace" }
  );

  const skillJobs = result.trace?.rounds[0]?.jobs.filter((job) => job.kind === "skill") ?? [];
  assert.deepEqual(
    skillJobs.map((job) => `${job.attackerSide}.${job.attackerUnit}->${job.defenderSide}.${job.defenderUnit}`),
    ["attacker.marksman->defender.infantry"]
  );
  assert.deepEqual(result.extraSkillAttackJobsByEffect, { hitAgain: 1 });
});

test("extra skill trigger damage jobs can resolve to multiple living enemy targets without recursive attack triggers", () => {
  const result = runOnce(
    {
      maxRounds: 1,
      attacker: {
        troops: { marksman_t1: 100 },
        heroes: { MultiTarget: { skill_1: 1, skill_2: 1 } }
      },
      defender: {
        troops: { infantry_t1: 100, lancer_t1: 100, marksman_t1: 100 },
        heroes: {}
      }
    },
    minimalConfig({
      MultiTarget: {
        name: "MultiTarget",
        skills: {
          MultiTargetShot: {
            trigger: { type: "attack", probability: 100, source: "marksman" },
            effects: {
              hitLiving: {
                type: "extra_skill_attack",
                value: 100,
                units: { applies_to: "trigger.source", applies_vs: "any" },
                trigger_damage_jobs: [{ source: "use.source", target: "enemy.living" }],
                duration: { attacks: { count: 1 } }
              }
            }
          },
          RecursiveGuard: {
            trigger: { type: "attack", probability: 100, source: "marksman" },
            effects: {
              recursive: {
                type: "extra_skill_attack",
                value: 100,
                units: { applies_to: "trigger.source", applies_vs: "any" },
                trigger_damage_jobs: [{ source: "use.source", target: "use.target" }],
                duration: { attacks: { count: 1 } }
              }
            }
          }
        }
      }
    }),
    { mode: "trace" }
  );

  const skillJobs = result.trace?.rounds[0]?.jobs.filter((job) => job.kind === "skill") ?? [];
  assert.deepEqual(
    skillJobs.map((job) => job.defenderUnit).sort(),
    ["infantry", "infantry", "lancer", "marksman"]
  );
  assert.equal(result.skillReport.attacker.find((entry) => entry.skillId === "MultiTargetShot")?.triggersSeen, 1);
  assert.equal(result.skillReport.attacker.find((entry) => entry.skillId === "RecursiveGuard")?.triggersSeen, 1);
});

test("extra skill attack consumes one use regardless of multiple generated target jobs", () => {
  const result = runOnce(
    {
      maxRounds: 2,
      attacker: {
        troops: { marksman_t1: 100 },
        heroes: { MultiTarget: { skill_1: 1 } }
      },
      defender: {
        troops: { infantry_t1: 100, lancer_t1: 100, marksman_t1: 100 },
        heroes: {}
      }
    },
    minimalConfig({
      MultiTarget: {
        name: "MultiTarget",
        skills: {
          MultiTargetShot: {
            trigger: { type: "battle_start" },
            effects: {
              hitLiving: {
                type: "extra_skill_attack",
                value: 100,
                units: { applies_to: ["marksman"], applies_vs: "any" },
                trigger_damage_jobs: [{ source: "use.source", target: "enemy.living" }],
                duration: { attacks: { count: 2 } }
              }
            }
          }
        }
      }
    }),
    { mode: "trace" }
  );

  const skillJobsByRound = result.trace?.rounds.map((round) => round.jobs.filter((job) => job.kind === "skill").length) ?? [];
  assert.deepEqual(skillJobsByRound, [3, 3]);
  assert.deepEqual(result.extraSkillAttackJobsByEffect, { hitLiving: 6 });
});

test('direct simulator configs reject applies_vs "all" usage gates', () => {
  assert.throws(
    () =>
      runOnce(
        {
          maxRounds: 1,
          attacker: {
            troops: { marksman_t1: 100 },
            heroes: { MultiTarget: { skill_1: 1 } }
          },
          defender: {
            troops: { infantry_t1: 100 },
            heroes: {}
          }
        },
        minimalConfig({
          MultiTarget: {
            name: "MultiTarget",
            skills: {
              MultiTargetShot: {
                trigger: { type: "battle_start" },
                effects: {
                  hitLiving: {
                    type: "extra_skill_attack",
                    value: 100,
                    units: { applies_to: ["marksman"], applies_vs: "all" },
                    trigger_damage_jobs: [{ source: "use.source", target: "enemy.living" }]
                  }
                }
              }
            }
          }
        })
      ),
    /applies_vs.*all/i
  );
});

test("extra skill attack consumes one use when multiple same-round normal attacks match the effect", () => {
  const result = runOnce(
    {
      maxRounds: 1,
      attacker: {
        troops: { infantry_t1: 100, marksman_t1: 100 },
        heroes: { FollowUp: { skill_1: 1 } }
      },
      defender: {
        troops: { infantry_t1: 100 },
        heroes: {}
      }
    },
    minimalConfig({
      FollowUp: {
        name: "FollowUp",
        skills: {
          OneUseFollowUp: {
            trigger: { type: "battle_start" },
            effects: {
              hitAgain: {
                type: "extra_skill_attack",
                value: 100,
                units: { applies_to: ["infantry", "marksman"], applies_vs: "any" },
                trigger_damage_jobs: [{ source: "use.source", target: "use.target" }],
                duration: { attacks: { count: 1 } }
              }
            }
          }
        }
      }
    }),
    { mode: "trace" }
  );

  const skillJobs = result.trace?.rounds[0]?.jobs.filter((job) => job.kind === "skill") ?? [];
  assert.equal(skillJobs.length, 1);
  assert.deepEqual(result.extraSkillAttackJobsByEffect, { hitAgain: 1 });
});

test("extra skill attack applies_vs must match the current normal attack target", () => {
  const result = runOnce(
    {
      maxRounds: 1,
      attacker: {
        troops: { marksman_t1: 100 },
        heroes: { FollowUp: { skill_1: 1 } }
      },
      defender: {
        troops: { infantry_t1: 100, lancer_t1: 100 },
        heroes: {}
      }
    },
    minimalConfig({
      FollowUp: {
        name: "FollowUp",
        skills: {
          LancerOnlyFollowUp: {
            trigger: { type: "attack", probability: 100, source: "marksman" },
            effects: {
              hitLancer: {
                type: "extra_skill_attack",
                value: 100,
                units: { applies_to: "trigger.source", applies_vs: ["lancer"] },
                trigger_damage_jobs: [{ source: "use.source", target: "use.target" }],
                duration: { attacks: { count: 1 } }
              }
            }
          }
        }
      }
    }),
    { mode: "trace" }
  );

  const jobs = result.trace?.rounds[0]?.jobs ?? [];
  assert.deepEqual(
    jobs.map((job) => `${job.kind}:${job.attackerUnit}->${job.defenderUnit}`),
    ["normal:marksman->infantry", "normal:infantry->marksman", "normal:lancer->marksman"]
  );
  assert.deepEqual(result.extraSkillAttackJobsByEffect, {});
});

test("extra skill de-dupe does not suppress unrelated attack-duration effect consumption", () => {
  const result = runOnce(
    {
      maxRounds: 2,
      attacker: {
        troops: { marksman_t1: 100 },
        heroes: { FollowUp: { skill_1: 1, skill_2: 1 } }
      },
      defender: {
        troops: { infantry_t1: 100, lancer_t1: 100 },
        heroes: {}
      }
    },
    minimalConfig({
      FollowUp: {
        name: "FollowUp",
        skills: {
          MultiTargetFollowUp: {
            trigger: { type: "battle_start" },
            effects: {
              hitLiving: {
                type: "extra_skill_attack",
                value: 100,
                units: { applies_to: ["marksman"], applies_vs: "any" },
                trigger_damage_jobs: [{ source: "use.source", target: "enemy.living" }],
                duration: { attacks: { count: 2 } }
              }
            }
          },
          SkillDamageBoost: {
            trigger: { type: "battle_start" },
            effects: {
              boost: {
                type: "type.skill.damage.up",
                value: 100,
                units: { applies_to: ["marksman"], applies_vs: "any" },
                duration: { attacks: { count: 2 } }
              }
            }
          }
        }
      }
    }),
    { mode: "trace" }
  );

  const skillJobsByRound = result.trace?.rounds.map((round) => round.jobs.filter((job) => job.kind === "skill").length) ?? [];
  const skillBoosts = result.attacks
    .filter((attack) => attack.kind === "skill")
    .map((attack) => attack.trace?.atomicBuckets["type.skill.damage.up"].totalPct ?? 0);
  assert.deepEqual(skillJobsByRound, [2, 2]);
  assert.deepEqual(skillBoosts, [100, 100, 0, 0]);
  assert.deepEqual(result.extraSkillAttackJobsByEffect, { hitLiving: 4 });
});

test("attack-triggered source and target selectors resolve to concrete active scopes", () => {
  const result = runOnce(
    {
      maxRounds: 1,
      attacker: {
        troops: { infantry_t1: 100 },
        heroes: { Debuffer: { skill_1: 1 } }
      },
      defender: {
        troops: { lancer_t1: 100, marksman_t1: 100 },
        heroes: {}
      }
    },
    minimalConfig({
      Debuffer: {
        name: "Debuffer",
        skills: {
          TargetedDebuff: {
            trigger: { type: "attack", source: "infantry" },
            effects: {
              down: {
                type: "active.hero.lethality.down",
                value: 50,
                units: { applies_to: "trigger.source", applies_vs: "trigger.target" },
                duration: { turns: { count: 1 } }
              }
            }
          }
        }
      }
    }),
    { mode: "trace" }
  );

  const attackerAttack = result.attacks.find((attack) => attack.attackerSide === "attacker" && attack.attackerUnit === "infantry");
  const defenderLancerAttack = result.attacks.find((attack) => attack.attackerSide === "defender" && attack.attackerUnit === "lancer");
  const defenderMarksmanAttack = result.attacks.find((attack) => attack.attackerSide === "defender" && attack.attackerUnit === "marksman");

  assert.equal(attackerAttack?.trace?.atomicBuckets["active.hero.lethality.down"].totalPct, 50);
  assert.equal(defenderLancerAttack?.trace?.atomicBuckets["active.hero.lethality.down"].totalPct, 0);
  assert.equal(defenderMarksmanAttack?.trace?.atomicBuckets["active.hero.lethality.down"].totalPct, 0);
});

test('attack-triggered target selector with applies_vs "any" gates later opposing attacks', () => {
  const result = runOnce(
    {
      maxRounds: 1,
      attacker: {
        troops: { infantry_t1: 100 },
        heroes: { Debuffer: { skill_1: 1 } }
      },
      defender: {
        troops: { lancer_t1: 100, marksman_t1: 100 },
        heroes: {}
      }
    },
    minimalConfig({
      Debuffer: {
        name: "Debuffer",
        skills: {
          TargetAnyDebuff: {
            trigger: { type: "attack", source: "infantry" },
            effects: {
              down: {
                type: "active.hero.lethality.down",
                value: 50,
                units: { applies_to: "trigger.target", applies_vs: "any" },
                duration: { turns: { count: 1 } }
              }
            }
          }
        }
      }
    }),
    { mode: "trace" }
  );

  const attackerAttack = result.attacks.find((attack) => attack.attackerSide === "attacker" && attack.attackerUnit === "infantry");
  const defenderLancerAttack = result.attacks.find((attack) => attack.attackerSide === "defender" && attack.attackerUnit === "lancer");
  const defenderMarksmanAttack = result.attacks.find((attack) => attack.attackerSide === "defender" && attack.attackerUnit === "marksman");

  assert.equal(attackerAttack?.trace?.atomicBuckets["active.hero.lethality.down"].totalPct, 0);
  assert.equal(defenderLancerAttack?.trace?.atomicBuckets["active.hero.lethality.down"].totalPct, 50);
  assert.equal(defenderMarksmanAttack?.trace?.atomicBuckets["active.hero.lethality.down"].totalPct, 0);
});

test("engagement_type requirements decide whether hero skills resolve", () => {
  const config = minimalConfig({
    Gated: {
      name: "Gated",
      skills: {
        RallyOnly: {
          requirements: [{ level: 1, type: "engagement_type", value: "rally" }],
          trigger: { type: "battle_start" },
          effects: { rally: { type: "passive.attack.up", value: 10 } }
        },
        GarrisonOnly: {
          requirements: [{ level: 1, type: "engagement_type", value: "garrison" }],
          trigger: { type: "battle_start" },
          effects: { garrison: { type: "passive.defense.up", value: 10 } }
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

  const defaultResult = runOnce(input, config);
  const rallyResult = runOnce({ ...input, engagement_type: "rally" }, config);
  const garrisonResult = runOnce({ ...input, engagement_type: "garrison" }, config);

  assert.equal(skillActivations(defaultResult, "RallyOnly"), 0);
  assert.equal(skillActivations(defaultResult, "GarrisonOnly"), 0);
  assert.equal(defaultResult.skillReport.attacker.some((entry) => entry.skillId === "RallyOnly"), false);
  assert.equal(defaultResult.skillReport.attacker.some((entry) => entry.skillId === "GarrisonOnly"), false);
  assert.equal(skillActivations(rallyResult, "RallyOnly"), 1);
  assert.equal(skillActivations(rallyResult, "GarrisonOnly"), 0);
  assert.equal(rallyResult.skillReport.attacker.some((entry) => entry.skillId === "GarrisonOnly"), false);
  assert.equal(skillActivations(garrisonResult, "RallyOnly"), 0);
  assert.equal(skillActivations(garrisonResult, "GarrisonOnly"), 1);
  assert.equal(garrisonResult.skillReport.attacker.some((entry) => entry.skillId === "RallyOnly"), false);
});

test("rally engagement resolves hero widget roles by owning side", () => {
  const config = minimalConfig({
    Gated: {
      name: "Gated",
      skills: {
        RallyOnly: {
          requirements: [{ level: 1, type: "engagement_type", value: "rally" }],
          trigger: { type: "battle_start" },
          effects: { rally: { type: "passive.attack.up", value: 10 } }
        },
        GarrisonOnly: {
          requirements: [{ level: 1, type: "engagement_type", value: "garrison" }],
          trigger: { type: "battle_start" },
          effects: { garrison: { type: "passive.defense.up", value: 10 } }
        }
      }
    }
  });
  const input = {
    maxRounds: 0,
    engagement_type: "rally",
    attacker: {
      troops: { infantry_t1: 10 },
      heroes: { Gated: { skill_1: 1, skill_2: 1 } }
    },
    defender: {
      troops: { infantry_t1: 10 },
      heroes: { Gated: { skill_1: 1, skill_2: 1 } }
    }
  };

  const result = runOnce(input, config);

  const attackerRally = result.skillReport.attacker.find((entry) => entry.skillId === "RallyOnly");
  const defenderGarrison = result.skillReport.defender.find((entry) => entry.skillId === "GarrisonOnly");

  assert.equal(attackerRally?.skillActivations, 1);
  assert.equal(defenderGarrison?.skillActivations, 1);
  assert.equal(Boolean(attackerRally), true);
  assert.equal(result.skillReport.attacker.some((entry) => entry.skillId === "GarrisonOnly"), false);
  assert.equal(result.skillReport.defender.some((entry) => entry.skillId === "RallyOnly"), false);
  assert.equal(Boolean(defenderGarrison), true);
});

test("runPrepared identifies stochastic battles from resolved chance triggers", () => {
  const config = minimalConfig({
    Chance: {
      name: "Chance",
      skills: {
        CoinFlip: {
          trigger: { type: "battle_start", probability: [50] },
          effects: { buff: { type: "passive.attack.up", value: 10 } }
        },
        RallyCoinFlip: {
          requirements: [{ level: 1, type: "engagement_type", value: "rally" }],
          trigger: { type: "battle_start", probability: [50] },
          effects: { rally: { type: "passive.attack.up", value: 10 } }
        }
      }
    }
  });

  const input = {
    maxRounds: 0,
    attacker: {
      troops: { infantry_t1: 10 },
      heroes: { Chance: { skill_1: 1, skill_2: 1 } }
    },
    defender: {
      troops: { infantry_t1: 10 },
      heroes: {}
    }
  };

  const chanceResult = runOnce(input, config);
  const gatedOnlyResult = runOnce(
    {
      ...input,
      attacker: { ...input.attacker, heroes: { Chance: { skill_2: 1 } } }
    },
    config
  );

  assert.equal(chanceResult.randomness.deterministic, false);
  assert.deepEqual(chanceResult.randomness.chanceSkillIds.attacker, ["CoinFlip"]);
  assert.equal(gatedOnlyResult.randomness.deterministic, true);
  assert.deepEqual(gatedOnlyResult.randomness.chanceSkillIds.attacker, []);
});

test("fast simulation matches full semantic output without detailed attacks", () => {
  const cases: Array<{ name: string; input: BattleInput; config: SimulatorConfig }> = [
    {
      name: "no-hero baseline",
      input: {
        maxRounds: 3,
        seed: "fast-baseline",
        attacker: {
          troops: { infantry_t1: 250, lancer_t1: 150 },
          stats: { inf: { attack: 10, defense: 10, lethality: 2, health: 2 } },
          heroes: {}
        },
        defender: {
          troops: { infantry_t1: 300, marksman_t1: 80 },
          stats: { inf: { attack: 8, defense: 12, lethality: 2, health: 3 } },
          heroes: {}
        }
      },
      config: minimalConfig()
    },
    {
      name: "duplicate max-stacked hero instances",
      input: {
        maxRounds: 2,
        seed: "fast-duplicate-max",
        attacker: {
          troops: { infantry_t1: 10000 },
          heroes: [{ name: "Repeat", levels: { skill_1: 1 } }],
          joiner_heroes: [{ name: "Repeat", levels: { skill_1: 1 } }]
        },
        defender: {
          troops: { infantry_t1: 10000 },
          heroes: {}
        }
      },
      config: sameEffectStackingConfig("Repeat", "max", "active.hero.lethality.up")
    },
    {
      name: "controls and extra skill attacks",
      input: {
        maxRounds: 3,
        seed: "fast-controls-extra",
        attacker: {
          troops: { marksman_t1: 400, infantry_t1: 100 },
          heroes: { FollowUp: { skill_1: 1 } }
        },
        defender: {
          troops: { infantry_t1: 450, lancer_t1: 100 },
          heroes: { Canceller: { skill_1: 1 } }
        }
      },
      config: minimalConfig({
        FollowUp: {
          name: "FollowUp",
          skills: {
            FollowUpShot: {
              trigger: { type: "attack", probability: 100, source: "marksman" },
              effects: {
                hitAgain: {
                  type: "extra_skill_attack",
                  value: 100,
                  units: { applies_to: "trigger.source", applies_vs: "any" },
                  trigger_damage_jobs: [{ source: "use.source", target: "use.target" }],
                  duration: { attacks: { count: 2 } }
                }
              }
            }
          }
        },
        Canceller: {
          name: "Canceller",
          skills: {
            PauseFirstHit: {
              trigger: { type: "battle_start" },
              effects: {
                pause: {
                  type: "no_attack",
                  units: { applies_to: "enemy.marksman", applies_vs: "any" },
                  duration: { attacks: { count: 1 } }
                }
              }
            }
          }
        }
      })
    },
    {
      name: "stochastic real hero battle",
      input: {
        maxRounds: 8,
        seed: "fast-real-heroes",
        engagement_type: "rally",
        attacker: {
          troops: { infantry_t10: 500, lancer_t10: 200, marksman_t10: 300 },
          heroes: { "Wu Ming": { skill_1: 5, skill_2: 5, skill_3: 5 }, Mia: { skill_1: 5, skill_2: 5, skill_3: 5 } },
          joiner_heroes: [{ name: "Jessie", levels: { skill_1: 5 } }]
        },
        defender: {
          troops: { infantry_t10: 500, lancer_t10: 200, marksman_t10: 300 },
          heroes: { "Wu Ming": { skill_1: 5, skill_2: 5, skill_3: 5 }, Bradley: { skill_1: 5, skill_2: 5, skill_3: 5 } },
          joiner_heroes: [{ name: "Norah", levels: { skill_1: 5 } }]
        }
      },
      config: loadSimulatorConfig()
    }
  ];

  for (const { name, input, config } of cases) {
    const full = runOnce(input, config);
    const fast = runOnce(input, config, { mode: "fast" });

    assert.deepEqual(semanticBattleSummary(fast), semanticBattleSummary(full), name);
    assert.deepEqual(fast.attacks, [], name);
    assert.equal(fast.trace, undefined, name);
  }
});

test("signedRemainingScore returns signed remaining troops from a fast-mode result", () => {
  const config = loadSimulatorConfig();
  const input: BattleInput = {
    maxRounds: 8,
    seed: "score-real-heroes",
    engagement_type: "rally",
    attacker: {
      troops: { infantry_t10: 500, lancer_t10: 200, marksman_t10: 300 },
      heroes: { "Wu Ming": { skill_1: 5, skill_2: 5, skill_3: 5 }, Mia: { skill_1: 5, skill_2: 5, skill_3: 5 } },
      joiner_heroes: [{ name: "Jessie", levels: { skill_1: 5 } }]
    },
    defender: {
      troops: { infantry_t10: 500, lancer_t10: 200, marksman_t10: 300 },
      heroes: { "Wu Ming": { skill_1: 5, skill_2: 5, skill_3: 5 }, Bradley: { skill_1: 5, skill_2: 5, skill_3: 5 } },
      joiner_heroes: [{ name: "Norah", levels: { skill_1: 5 } }]
    }
  };

  const result = runOnce(input, config, { mode: "fast" });
  const score = signedRemainingScore(result);

  const expected =
    result.winner === "attacker"
      ? totalRemaining(result.remaining.attacker)
      : result.winner === "defender"
        ? -totalRemaining(result.remaining.defender)
        : 0;

  assert.equal(score, expected);
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

function skillActivations(result: ReturnType<typeof runOnce>, skillId: string): number {
  return result.skillReport.attacker.find((entry) => entry.skillId === skillId)?.skillActivations ?? 0;
}

function totalRemaining(troops: Record<UnitType, number>): number {
  return Object.values(troops).reduce((sum, count) => sum + count, 0);
}

function semanticBattleSummary(result: ReturnType<typeof runOnce>): Pick<
  ReturnType<typeof runOnce>,
  "winner" | "rounds" | "remaining" | "effectActivationCounts" | "extraSkillAttackJobsByEffect" | "attackControlCounts"
> {
  return {
    winner: result.winner,
    rounds: result.rounds,
    remaining: result.remaining,
    effectActivationCounts: result.effectActivationCounts,
    extraSkillAttackJobsByEffect: result.extraSkillAttackJobsByEffect,
    attackControlCounts: result.attackControlCounts
  };
}

function sameEffectStackingInput(heroName: string): BattleInput {
  return {
    maxRounds: 2,
    attacker: {
      troops: { infantry_t1: 10000 },
      heroes: { [heroName]: { skill_1: 1 } }
    },
    defender: {
      troops: { infantry_t1: 10000 },
      heroes: {}
    }
  };
}

function sameEffectStackingConfig(heroName: string, same_effect_stacking: "add" | "max", type: "active.hero.lethality.up" | "extra_skill_attack"): SimulatorConfig {
  const effect: Omit<EffectIntentDefinition, "id"> =
    type === "extra_skill_attack"
      ? {
          type,
          value: 100,
          same_effect_stacking,
          units: { applies_to: ["infantry"], applies_vs: "any" },
          trigger_damage_jobs: [{ source: "use.source", target: "use.target" }],
          duration: { turns: { count: 2 } }
        }
      : {
          type,
          value: 100,
          same_effect_stacking,
          units: { applies_to: ["infantry"], applies_vs: "any" },
          duration: { turns: { count: 2 } }
        };
  return minimalConfig({
    [heroName]: {
      name: heroName,
      skills: {
        Overlap: {
          trigger: { type: "turn" },
          effects: { stacking: effect }
        }
      }
    }
  });
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
    diagnostics: { legacyFields: [], effectTypes: {}, unsupportedEffects: [], ambiguousTurnTriggerSelectors: [] }
  };
}
