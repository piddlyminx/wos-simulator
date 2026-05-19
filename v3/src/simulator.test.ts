import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { loadSimulatorConfig } from "./config.js";
import { createSeededRng, chancePasses } from "./effects.js";
import { resolveFighter } from "./resolve.js";
import { simulateBattle } from "./simulator.js";
import type { BattleInput, ResolvedSkill, SimulatorConfig, SkillFile, UnitType } from "./types.js";

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

test("simulateBattle carries fractional casualties between rounds and ceils final survivors", () => {
  const config = loadSimulatorConfig();
  const fixturePath = fileURLToPath(new URL("../testcases/emulator_verified/simple_001_nc.json", import.meta.url));
  const testcases = JSON.parse(readFileSync(fixturePath, "utf8")) as Array<BattleInput & { test_id: string }>;
  const input = testcases.find((testcase) => testcase.test_id === "simple_001");
  assert.notEqual(input, undefined);

  const result = simulateBattle({ ...input!, trace: true }, config);

  assert.equal(totalRemaining(result.remaining.attacker) - totalRemaining(result.remaining.defender), -186);
  assert.equal(result.remaining.defender.lancer, 186);
  assert.equal(result.trace?.rounds[1]?.roundStartTroops.defender.lancer.toFixed(6), "198.003308");
});

test("simulateBattle defaults to a 1500 round cap when no explicit maxRounds is provided", () => {
  const result = simulateBattle(
    {
      attacker: { troops: {}, heroes: {} },
      defender: { troops: {}, heroes: {} }
    },
    minimalConfig()
  );

  assert.equal(result.winner, "draw");
  assert.equal(result.rounds, 1500);
});

test("round-start trigger units.for all rolls once then creates one target-locked effect per live unit type", () => {
  const result = simulateBattle(
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
            trigger: { type: "turn", units: { for: "all" } },
            effects: {
              buff: {
                type: "damage_up",
                value: 100,
                units: { applies_to: "trigger", applies_vs: "target" },
                duration: { type: "turn", value: 1 }
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

test("requires_effect is ignored by native v3 effect activation", () => {
  const result = simulateBattle(
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
                type: "stat_bonus",
                stat: "attack",
                value: 10
              },
              legacyDependent: {
                ...({ requires_effect: "missing-effect" } as Record<string, unknown>),
                type: "stat_bonus",
                stat: "defense",
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

test("extra skill attacks with array trigger damage targets hit those defender unit types", () => {
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
                units: { applies_to: "trigger.source", applies_vs: "any" },
                trigger_damage_jobs: [{ source: "use.source", target: ["lancer"] }],
                duration: { type: "attack", value: 1 }
              },
              hitMarksman: {
                type: "extra_skill_attack",
                value: 100,
                units: { applies_to: "trigger.source", applies_vs: "any" },
                trigger_damage_jobs: [{ source: "use.source", target: ["marksman"] }],
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

test('extra skill attacks with applies_vs "any" keep current-target compatibility', () => {
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
          SingleHit: {
            trigger: { type: "attack", units: { by: ["marksman"] } },
            effects: {
              hitAny: {
                type: "extra_skill_attack",
                value: 100,
                units: { applies_to: "trigger.source", applies_vs: "any" },
                trigger_damage_jobs: [{ source: "use.source", target: "use.target" }],
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
    [["hitAny", "lancer"]]
  );
});

test("extra skill trigger damage jobs reject missing runtime selectors", () => {
  assert.throws(
    () =>
      simulateBattle(
        {
          maxRounds: 1,
          trace: true,
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
                trigger: { type: "attack", probability: 100, units: { by: "marksman" } },
                effects: {
                  hitAgain: {
                    type: "extra_skill_attack",
                    value: 100,
                    units: { applies_to: "trigger.source", applies_vs: "any" },
                    trigger_damage_jobs: [{ source: "use.source" } as never],
                    duration: { type: "attack", value: 1 }
                  }
                }
              }
            }
          }
        })
      ),
    /target selector is required/i
  );
});

test("extra skill attacks reject missing trigger damage jobs at activation", () => {
  assert.throws(
    () =>
      simulateBattle(
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
                trigger: { type: "attack", probability: 100, units: { by: "marksman" } },
                effects: {
                  hitAgain: {
                    type: "extra_skill_attack",
                    value: 100,
                    units: { applies_to: "trigger.source", applies_vs: "any" },
                    duration: { type: "attack", value: 1 }
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
  const result = simulateBattle(
    {
      maxRounds: 1,
      trace: true,
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
            trigger: { type: "attack", probability: 100, units: { by: "marksman" } },
            effects: {
              hitAgain: {
                type: "extra_skill_attack",
                value: 100,
                units: { applies_to: "trigger.source", applies_vs: "any" },
                trigger_damage_jobs: [{ source: "use.source", target: "use.target" }],
                duration: { type: "attack", value: 1 }
              }
            }
          }
        }
      }
    })
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
  const result = simulateBattle(
    {
      maxRounds: 2,
      trace: true,
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
                duration: { type: "attack", value: 1 }
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
                units: { side: "enemy", applies_to: ["marksman"], applies_vs: "any" },
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
  assert.equal(cancelled!.consumedEffectIds.some((id) => id.includes(":hitAgain:")), false);

  const skillJobsByRound = result.trace?.rounds.map((round) => round.jobs.filter((job) => job.kind === "skill").length) ?? [];
  assert.deepEqual(skillJobsByRound, [0, 1]);
  assert.deepEqual(result.extraSkillAttackJobsByEffect, { hitAgain: 1 });
});

test("extra skill attack effects cannot be used by later enemy normal attacks", () => {
  const result = simulateBattle(
    {
      maxRounds: 1,
      trace: true,
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
            trigger: { type: "attack", probability: 100, units: { by: "marksman" } },
            effects: {
              hitAgain: {
                type: "extra_skill_attack",
                value: 100,
                units: { applies_to: "trigger.source", applies_vs: "any" },
                trigger_damage_jobs: [{ source: "use.source", target: "use.target" }],
                duration: { type: "attack", value: 2 }
              }
            }
          }
        }
      }
    })
  );

  const skillJobs = result.trace?.rounds[0]?.jobs.filter((job) => job.kind === "skill") ?? [];
  assert.deepEqual(
    skillJobs.map((job) => `${job.attackerSide}.${job.attackerUnit}->${job.defenderSide}.${job.defenderUnit}`),
    ["attacker.marksman->defender.infantry"]
  );
  assert.deepEqual(result.extraSkillAttackJobsByEffect, { hitAgain: 1 });
});

test("extra skill trigger damage jobs can resolve to multiple living enemy targets without recursive attack triggers", () => {
  const result = simulateBattle(
    {
      maxRounds: 1,
      trace: true,
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
            trigger: { type: "attack", probability: 100, units: { by: "marksman" } },
            effects: {
              hitLiving: {
                type: "extra_skill_attack",
                value: 100,
                units: { applies_to: "trigger.source", applies_vs: "any" },
                trigger_damage_jobs: [{ source: "use.source", target: "enemy.living" }],
                duration: { type: "attack", value: 1 }
              }
            }
          },
          RecursiveGuard: {
            trigger: { type: "attack", probability: 100, units: { by: "marksman" } },
            effects: {
              recursive: {
                type: "extra_skill_attack",
                value: 100,
                units: { applies_to: "trigger.source", applies_vs: "any" },
                trigger_damage_jobs: [{ source: "use.source", target: "use.target" }],
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
    skillJobs.map((job) => job.defenderUnit).sort(),
    ["infantry", "infantry", "lancer", "marksman"]
  );
  assert.equal(result.skillReport.attacker.find((entry) => entry.skillId === "MultiTargetShot")?.triggersSeen, 1);
  assert.equal(result.skillReport.attacker.find((entry) => entry.skillId === "RecursiveGuard")?.triggersSeen, 1);
});

test("extra skill attack consumes one use regardless of multiple generated target jobs", () => {
  const result = simulateBattle(
    {
      maxRounds: 2,
      trace: true,
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
                duration: { type: "attack", value: 2 }
              }
            }
          }
        }
      }
    })
  );

  const skillJobsByRound = result.trace?.rounds.map((round) => round.jobs.filter((job) => job.kind === "skill").length) ?? [];
  assert.deepEqual(skillJobsByRound, [3, 3]);
  assert.deepEqual(result.extraSkillAttackJobsByEffect, { hitLiving: 6 });
});

test('direct simulator configs reject applies_vs "all" usage gates', () => {
  assert.throws(
    () =>
      simulateBattle(
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
  const result = simulateBattle(
    {
      maxRounds: 1,
      trace: true,
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
                duration: { type: "attack", value: 1 }
              }
            }
          }
        }
      }
    })
  );

  const skillJobs = result.trace?.rounds[0]?.jobs.filter((job) => job.kind === "skill") ?? [];
  assert.equal(skillJobs.length, 1);
  assert.deepEqual(result.extraSkillAttackJobsByEffect, { hitAgain: 1 });
});

test("extra skill attack applies_vs must match the current normal attack target", () => {
  const result = simulateBattle(
    {
      maxRounds: 1,
      trace: true,
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
            trigger: { type: "attack", probability: 100, units: { by: "marksman" } },
            effects: {
              hitLancer: {
                type: "extra_skill_attack",
                value: 100,
                units: { applies_to: "trigger.source", applies_vs: ["lancer"] },
                trigger_damage_jobs: [{ source: "use.source", target: "use.target" }],
                duration: { type: "attack", value: 1 }
              }
            }
          }
        }
      }
    })
  );

  const jobs = result.trace?.rounds[0]?.jobs ?? [];
  assert.deepEqual(
    jobs.map((job) => `${job.kind}:${job.attackerUnit}->${job.defenderUnit}`),
    ["normal:marksman->infantry", "normal:infantry->marksman", "normal:lancer->marksman"]
  );
  assert.deepEqual(result.extraSkillAttackJobsByEffect, {});
});

test("extra skill de-dupe does not suppress unrelated attack-duration effect consumption", () => {
  const result = simulateBattle(
    {
      maxRounds: 2,
      trace: true,
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
                duration: { type: "attack", value: 2 }
              }
            }
          },
          SkillDamageBoost: {
            trigger: { type: "battle_start" },
            effects: {
              boost: {
                type: "skill_damage_up",
                value: 100,
                units: { applies_to: ["marksman"], applies_vs: "any" },
                duration: { type: "attack", value: 4 }
              }
            }
          }
        }
      }
    })
  );

  const skillJobsByRound = result.trace?.rounds.map((round) => round.jobs.filter((job) => job.kind === "skill").length) ?? [];
  const skillBoosts = result.attacks
    .filter((attack) => attack.kind === "skill")
    .map((attack) => attack.trace?.buckets.numerator.skillDamageUp.totalPct ?? 0);
  assert.deepEqual(skillJobsByRound, [2, 2]);
  assert.deepEqual(skillBoosts, [100, 100, 0, 0]);
  assert.deepEqual(result.extraSkillAttackJobsByEffect, { hitLiving: 4 });
});

test("attack-triggered source and target selectors resolve to concrete active scopes", () => {
  const result = simulateBattle(
    {
      maxRounds: 1,
      trace: true,
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
            trigger: { type: "attack", units: { by: "infantry" } },
            effects: {
              down: {
                type: "damage_down",
                value: 50,
                units: { applies_to: "trigger.source", applies_vs: "trigger.target" },
                duration: { type: "turn", value: 1 }
              }
            }
          }
        }
      }
    })
  );

  const attackerAttack = result.attacks.find((attack) => attack.attackerSide === "attacker" && attack.attackerUnit === "infantry");
  const defenderLancerAttack = result.attacks.find((attack) => attack.attackerSide === "defender" && attack.attackerUnit === "lancer");
  const defenderMarksmanAttack = result.attacks.find((attack) => attack.attackerSide === "defender" && attack.attackerUnit === "marksman");

  assert.equal(attackerAttack?.trace?.buckets.denominator.outgoingDamageDown.totalPct, 50);
  assert.equal(defenderLancerAttack?.trace?.buckets.denominator.outgoingDamageDown.totalPct, 0);
  assert.equal(defenderMarksmanAttack?.trace?.buckets.denominator.outgoingDamageDown.totalPct, 0);
});

test('attack-triggered target selector with applies_vs "any" gates later opposing attacks', () => {
  const result = simulateBattle(
    {
      maxRounds: 1,
      trace: true,
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
            trigger: { type: "attack", units: { by: "infantry" } },
            effects: {
              down: {
                type: "damage_down",
                value: 50,
                units: { applies_to: "trigger.target", applies_vs: "any" },
                duration: { type: "turn", value: 1 }
              }
            }
          }
        }
      }
    })
  );

  const attackerAttack = result.attacks.find((attack) => attack.attackerSide === "attacker" && attack.attackerUnit === "infantry");
  const defenderLancerAttack = result.attacks.find((attack) => attack.attackerSide === "defender" && attack.attackerUnit === "lancer");
  const defenderMarksmanAttack = result.attacks.find((attack) => attack.attackerSide === "defender" && attack.attackerUnit === "marksman");

  assert.equal(attackerAttack?.trace?.buckets.denominator.outgoingDamageDown.totalPct, 0);
  assert.equal(defenderLancerAttack?.trace?.buckets.denominator.outgoingDamageDown.totalPct, 50);
  assert.equal(defenderMarksmanAttack?.trace?.buckets.denominator.outgoingDamageDown.totalPct, 0);
});

test("engagement_type requirements decide whether hero skills resolve", () => {
  const config = minimalConfig({
    Gated: {
      name: "Gated",
      skills: {
        RallyOnly: {
          requirements: [{ level: 1, type: "engagement_type", value: "rally" }],
          trigger: { type: "battle_start" },
          effects: { rally: { type: "stat_bonus", stat: "attack", value: 10 } }
        },
        GarrisonOnly: {
          requirements: [{ level: 1, type: "engagement_type", value: "garrison" }],
          trigger: { type: "battle_start" },
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
  assert.equal(defaultResult.skillReport.attacker.some((entry) => entry.skillId === "RallyOnly"), false);
  assert.equal(defaultResult.skillReport.attacker.some((entry) => entry.skillId === "GarrisonOnly"), false);
  assert.equal(skillActivations(rallyResult, "RallyOnly"), 1);
  assert.equal(skillActivations(rallyResult, "GarrisonOnly"), 0);
  assert.equal(rallyResult.skillReport.attacker.some((entry) => entry.skillId === "GarrisonOnly"), false);
  assert.equal(skillActivations(garrisonResult, "RallyOnly"), 0);
  assert.equal(skillActivations(garrisonResult, "GarrisonOnly"), 1);
  assert.equal(garrisonResult.skillReport.attacker.some((entry) => entry.skillId === "RallyOnly"), false);
});

test("simulateBattle identifies stochastic battles from resolved chance triggers", () => {
  const config = minimalConfig({
    Chance: {
      name: "Chance",
      skills: {
        CoinFlip: {
          trigger: { type: "battle_start", probability: [50] },
          effects: { buff: { type: "stat_bonus", stat: "attack", value: 10 } }
        },
        RallyCoinFlip: {
          requirements: [{ level: 1, type: "engagement_type", value: "rally" }],
          trigger: { type: "battle_start", probability: [50] },
          effects: { rally: { type: "stat_bonus", stat: "attack", value: 10 } }
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

  const chanceResult = simulateBattle(input, config);
  const gatedOnlyResult = simulateBattle(
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

function totalRemaining(troops: Record<UnitType, number>): number {
  return Object.values(troops).reduce((sum, count) => sum + count, 0);
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
