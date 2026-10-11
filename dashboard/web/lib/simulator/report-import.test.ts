import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSimulatorConfig } from "@simulator/config-default";
import { STATIC_BUCKET_INDEX } from "@simulator/damageBuckets";
import { prepareBattle } from "@simulator/prepare";
import { buildStaticDamageBucketFactors } from "@simulator/staticDamageProfile";
import type { ReportImportFighter, ReportImportRequest } from "@/lib/simulate-run";
import { sideFromPayload, toApiPayload } from "@/lib/simulate/form-state";
import { toBattleInput } from "./adapters";
import { normalizeReportImport } from "./report-import";

function fighter(): ReportImportFighter {
  return {
    troops: { infantry_t6: 200, infantry_t6_fc5: 100, lancer_t6: 50 },
    stats: {
      infantry: { attack: 400, defense: 300, lethality: 250, health: 350 },
      lancer: { attack: 400, defense: 300, lethality: 250, health: 350 },
      marksman: { attack: 400, defense: 300, lethality: 250, health: 350 },
    },
  };
}

function imported(): ReportImportRequest {
  return {
    report_import: { attacker: fighter(), defender: fighter() },
    replicates: 1000,
    rally_mode: true,
    source_report: {
      reference: "report-original",
      raw_report_base64: "AAEC/w==",
      report: { experts: [{ unknown: 123 }], extraTroopSkills: [456] },
      warnings: [],
    },
  };
}

test("mixed-tier troop counts and source warnings survive normalization, form edits and reruns", () => {
  const input = imported();
  input.source_report.warnings.push("A report skill was not recognized.");
  const before = JSON.stringify(input);
  const normalized = normalizeReportImport(input);
  const attacker = sideFromPayload(normalized.attacker);
  attacker.stats.infantry.defense = 123;
  const rerun = toApiPayload(attacker, sideFromPayload(normalized.defender), 1000, true, undefined, normalized.source_report);
  assert.equal(rerun.attacker.stats.inf[1], 123);
  assert.deepEqual(
    Object.fromEntries(Object.entries(toBattleInput(rerun, 1).attacker.troops).filter(([, count]) => count > 0)),
    input.report_import.attacker.troops,
  );
  assert.deepEqual(rerun.source_report, input.source_report);
  assert.equal(JSON.stringify(input), before);
});

test("supported observations with expert evidence do not manufacture import warnings", () => {
  const input = imported();
  const normalized = normalizeReportImport(input);
  assert.deepEqual(normalized.source_report?.warnings, []);
  assert.deepEqual(normalized.source_report?.report, input.source_report.report);
});

test("reported widget totals are not counted twice, while unobserved stats remain neutral", () => {
  const input = imported();
  input.report_import.attacker.heroes = { "jero-NIMO": { skill_4: 5 } };
  delete input.report_import.attacker.stats!.lancer!.attack;
  const config = loadSimulatorConfig();
  const normalized = normalizeReportImport(input, config);
  assert.equal(normalized.attacker.heroes.infantry.name, "Jeronimo");
  assert.ok(Math.abs(normalized.attacker.stats.inf[0] - (500 / 1.15 - 100)) < 1e-9);
  assert.equal(normalized.attacker.stats.lanc[0], 0);
  const compiled = prepareBattle(toBattleInput(normalized, 1), config);
  const factors = buildStaticDamageBucketFactors(compiled.fighters, compiled.preBattleEffects);
  const up = factors.attacker.infantry[STATIC_BUCKET_INDEX["passive.attack.up"]];
  const down = factors.attacker.infantry[STATIC_BUCKET_INDEX["passive.attack.down"]];
  assert.ok(Math.abs((100 + normalized.attacker.stats.inf[0]) * up / down - 100 - 400) < 1e-9);
  assert.ok(normalized.source_report!.warnings.some(warning => warning.includes("lancer attack")));
});

test("city, pet and Gareth context is removed once alongside heroes and survives form round trips", () => {
  const input = imported();
  const attacker = input.report_import.attacker;
  const defender = input.report_import.defender;
  attacker.heroes = defender.heroes = { Jeronimo: { skill_4: 5 } };
  attacker.stat_modifiers = { attack: 20, defense: 20, lethality: 20, health: 20, enemy_attack: -20, enemy_defense: -20 };
  defender.stat_modifiers = { ...attacker.stat_modifiers };
  attacker.gareth = 1;
  defender.gareth = 4;
  defender.pet_modifiers = {
    attack: 10, defense: 10, lethality: 10, health: 10,
    enemy_defense: -10, enemy_lethality: -5, enemy_health: -5,
  };
  // Concrete final totals for base bonuses [400, 300, 250, 350].
  // City, pets and the attacker's 15% rally widget share the additive numerator;
  // opposing city, pets and Gareth share the additive denominator.
  attacker.stats!.infantry = {
    attack: 462.5, defense: 480 / 1.3 - 100,
    lethality: 420 / 1.09 - 100, health: 540 / 1.05 - 100,
  };
  defender.stats!.infantry = {
    attack: 650 / 1.2 - 100, defense: 520 / 1.2 - 100,
    lethality: 455 / 1.01 - 100, health: 485,
  };
  attacker.stats!.lancer = { attack: Number.NaN, defense: -100 };
  attacker.stats!.marksman = undefined;
  const before = JSON.stringify(input);
  const config = loadSimulatorConfig();
  const normalized = normalizeReportImport(input, config);
  for (const side of ["attacker", "defender"] as const) {
    normalized[side].stats.inf.forEach((value, index) => {
      assert.ok(Math.abs(value - [400, 300, 250, 350][index]) < 1e-9, `${side} base stat ${index}: ${value}`);
    });
  }
  assert.deepEqual(normalized.attacker.stats.lanc, [0, 0, 0, 0]);
  assert.deepEqual(normalized.attacker.stats.mark, [0, 0, 0, 0]);
  const rerun = toApiPayload(sideFromPayload(normalized.attacker), sideFromPayload(normalized.defender), 1000, true);
  const compiled = prepareBattle(toBattleInput(rerun, 1), config);
  const factors = buildStaticDamageBucketFactors(compiled.fighters, compiled.preBattleEffects);
  for (const side of ["attacker", "defender"] as const) {
    for (const [index, stat] of (["attack", "defense", "lethality", "health"] as const).entries()) {
      const up = factors[side].infantry[STATIC_BUCKET_INDEX[`passive.${stat}.up`]];
      const down = factors[side].infantry[STATIC_BUCKET_INDEX[`passive.${stat}.down`]];
      const effective = (100 + rerun[side].stats.inf[index]) * up / down - 100;
      assert.ok(Math.abs(effective - input.report_import[side].stats!.infantry![stat]!) < 1e-9);
    }
  }
  assert.deepEqual(rerun.attacker.stats.lanc, [0, 0, 0, 0]);
  assert.deepEqual(rerun.attacker.stats.mark, [0, 0, 0, 0]);
  assert.equal(JSON.stringify(input), before);
});

test("unsupported troops, heroes and skills are omitted independently rather than rejecting usable armies", () => {
  const input = imported();
  input.report_import.attacker.troops!.unknown_troop = 100;
  input.report_import.attacker.heroes = {
    UnknownHero: { skill_1: 5 },
    Jeronimo: { skill_1: 3, skill_2: 7, skill_3: 2, skill_5: 5 },
  };
  const normalized = normalizeReportImport(input);
  assert.deepEqual(normalized.attacker.troops, { infantry: 300, lancer: 50, marksman: 0 });
  assert.deepEqual(normalized.attacker.heroes.infantry, { name: "Jeronimo", skills: [3, 0, 2, 0] });
  assert.ok(normalized.source_report!.warnings.some(warning => warning.includes("unknown_troop")));
  assert.ok(normalized.source_report!.warnings.some(warning => warning.includes("UnknownHero")));
  assert.ok(normalized.source_report!.warnings.some(warning => warning.includes("skill 2")));
});

test("unusable contributing joiners do not promote the fifth positional contribution", () => {
  const input = imported();
  input.report_import.attacker.joiner_heroes = [
    { name: "UnknownHero", levels: { skill_1: 5 } },
    { name: "Jasser", levels: { skill_1: 2 } },
    { name: "Jasser", levels: { skill_1: 0 } },
    { name: "Jasser", levels: { skill_1: 4 } },
    { name: "Jasser", levels: { skill_1: 5 } },
  ];
  const normalized = normalizeReportImport(input);
  assert.deepEqual(normalized.attacker.joiners, [
    { name: "Jasser", skill_1: 2 }, { name: "Jasser", skill_1: 4 },
  ]);
  assert.ok(normalized.source_report!.warnings.some(warning => warning.includes("first four")));
});

test("missing and unusable observed stats use neutral values and require at least one usable troop per side", () => {
  const input = imported();
  input.report_import.attacker.stats = undefined;
  input.report_import.defender.stats!.infantry = { attack: -100, defense: Number.NaN, health: 0 };
  const normalized = normalizeReportImport(input);
  assert.deepEqual(normalized.attacker.stats, { inf: [0, 0, 0, 0], lanc: [0, 0, 0, 0], mark: [0, 0, 0, 0] });
  assert.deepEqual(normalized.defender.stats.inf, [0, 0, 0, 0]);
  input.report_import.defender.troops = { unknown_troop: 50, lancer_t6: 0 };
  assert.throws(() => normalizeReportImport(input), /defender: no usable troops/);
  input.report_import.defender.troops.lancer_t6 = 1;
  assert.deepEqual(normalizeReportImport(input).defender.troops, { infantry: 0, lancer: 1, marksman: 0 });
});
