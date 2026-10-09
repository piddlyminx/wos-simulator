import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, symlinkSync, linkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadSimulatorConfig } from "../simulator/src/config-node";
import { applyHeroGenerationStats, removeHeroGenerationStats } from "../simulator/src/fighterResolution";
import type { StatBlock } from "../simulator/src/types";
import { parseDefinition, type OptimizationResult } from "./three_army_optimizer";
import {
  UNIT_TYPES, DEFAULT_OPTIONS, coarseCompositions, createEvaluator, createSearchModel,
  definitionForLoadout, exportConfiguration, gearCandidates, localCompositions,
  parseCli, passOrder, searchLoadouts, singleTroopVariants, main,
  type Composition, type GearDefinition, type Loadout
} from "./three_army_loadout_optimizer";

const config = loadSimulatorConfig();
const stat = (n: number): StatBlock => ({ attack: n, defense: n, lethality: n, health: n });
function input() {
  const heroes = [["Gatot", "Sonya", "Greg"], ["Edith", "Mia", "Bradley"], ["Wu Ming", "Philly", "Hendrik"]];
  const armies = heroes.map((names, i) => ({ name: `Army ${i + 1}`, fighter: {
    troops: { infantry_t6: 600, lancer_t6: 200, marksman_t6: 200 },
    stats: { infantry: stat(1000 + i * 100), lancer: stat(1200 + i * 100), marksman: stat(1400 + i * 100) },
    heroes: Object.fromEntries(names.map(n => [n, { skill_1: 5, skill_2: 5, skill_3: 5 }]))
  } }));
  return {
    ordering: "random", max_rounds: 20,
    input_stats_include_hero_generation: { attacker: false, defender: false },
    attacker: { passive: { own: { attack: { up: 10 } } }, armies },
    defender: { armies: structuredClone(armies) },
    optimization: { side: "attacker", hero_skill_levels: [5, 5, 5, 0], unique_heroes: true,
      per_army_hero_pools: heroes.map(names => Object.fromEntries(UNIT_TYPES.map((t, j) => [t, [names[j]]]))) },
    troop_optimization: { side: "attacker", coarse_step_percent: 5, fine_step_percent: 1, fine_radius_percent: 3, passes: 2 }
  };
}
function synthetic(scoreRate: number, reps: number): OptimizationResult {
  return { rank: 1, heroes: [], winRate: scoreRate, scoreRate, averageMargin: scoreRate,
    evaluation: { scenarios: reps, attackerWins: 0, defenderWins: 0, draws: 0,
      attackerWinRate: 0, defenderWinRate: 0, averageAttackerRemaining: 0,
      averageDefenderRemaining: 0, averageAttackerMargin: 0, attackerMarginStd: 0, averageBattles: 1 } };
}

test("inferred gear transfers residual profiles by type and follows new hero generation exactly once", () => {
  const raw = input();
  raw.input_stats_include_hero_generation.attacker = true;
  for (const a of raw.attacker.armies) a.fighter.stats = applyHeroGenerationStats(a.fighter, config).stats as typeof a.fighter.stats;
  const untouched = structuredClone(raw);
  const model = createSearchModel(raw, config);
  const loadout: Loadout = { ...model.initial, heroes: [...model.initial.heroes],
    gear: { infantry: [2, 0, 1], lancer: [0, 1, 2], marksman: [1, 2, 0] } };
  loadout.heroes[0] = { Magnus: { skill_1: 5, skill_2: 5, skill_3: 5 }, Mia: { skill_1: 5 }, Xura: { skill_1: 5 } };
  const definition = definitionForLoadout(model, loadout);
  const effective = applyHeroGenerationStats(definition.attacker[0].fighter, config);
  assert.equal(effective.stats!.infantry!.attack, 1200 + config.heroGenerationStats.S9.attack!);
  assert.equal(effective.stats!.lancer!.attack, 1200 + config.heroGenerationStats.S3.attack!);
  assert.equal(effective.stats!.marksman!.attack, 1500 + config.heroGenerationStats.S9.attack!);
  assert.deepEqual(definition.attacker[0].fighter.passive, { attack: { up: 10 } });
  assert.deepEqual(raw, untouched);
});

test("explicit base plus gear matches inference and rejects missing, reused, or inconsistent sets", () => {
  const raw = input();
  const inferred = createSearchModel(raw, config);
  const g: GearDefinition = structuredClone(inferred.gear);
  g.base_stats = { infantry: stat(100), lancer: stat(200), marksman: stat(300) };
  for (const t of UNIT_TYPES) for (const set of g.sets[t]) for (const k of Object.keys(set.stats) as Array<keyof StatBlock>) set.stats[k] -= g.base_stats[t][k];
  const model = createSearchModel({ ...raw, gear_optimization: g }, config);
  assert.deepEqual(definitionForLoadout(model, model.initial), definitionForLoadout(inferred, inferred.initial));
  const bad = structuredClone(g); bad.initial_assignment.infantry[1] = bad.initial_assignment.infantry[0];
  assert.throws(() => createSearchModel({ ...raw, gear_optimization: bad }, config), /exactly once/);
  const inconsistent = structuredClone(g); inconsistent.base_stats.infantry.health += 1;
  assert.throws(() => createSearchModel({ ...raw, gear_optimization: inconsistent }, config), /does not reproduce/);
});

test("gear allocation enumerates 216 legal type-restricted assignments", () => {
  const model = createSearchModel(input(), config);
  const candidates = [...gearCandidates(model.initial)];
  assert.equal(candidates.length, 216);
  for (const c of candidates) for (const t of UNIT_TYPES) assert.deepEqual([...c.gear[t]].sort(), [0, 1, 2]);
});

test("gear screening considers all 216 assignments regardless of troop ratios", async () => {
  const model = createSearchModel(input(), config);
  const options = { ...DEFAULT_OPTIONS, passes: 1, jobs: 1, reps: 2, screenReps: 1, validationReps: 4,
    coarseStep: 50, refineStep: 10, seeds: 1, finalists: 2 };
  const seen = new Set<string>();
  const result = await searchLoadouts(model, config, options, async (c, reps) => {
    if (reps === options.screenReps) seen.add(JSON.stringify(c.gear));
    return synthetic(0.5, reps);
  });
  assert.equal(seen.size, 216);
  assert.equal(result.history.find(s => s.stage === "gear")!.candidates, 216);
  for (const counts of [[1000, 0, 0], [0, 1000, 0], [0, 0, 1000], [600, 200, 200]] as Composition[]) {
    const changed: Loadout = { ...model.initial, troops: [counts, counts, counts] };
    assert.equal([...gearCandidates(changed)].length, 216);
  }
});

test("grids preserve capacity and test zero and one for each absent type including both together", () => {
  assert.deepEqual(singleTroopVariants([1000, 0, 0]), [[1000, 0, 0], [999, 1, 0], [999, 0, 1], [998, 1, 1]]);
  const coarse = coarseCompositions(1001, 10);
  for (const c of coarse) {
    assert.equal(c.reduce((a, b) => a + b, 0), 1001);
    assert.ok(c.every(n => Number.isInteger(n) && n >= 0));
  }
  for (const c of [[1001, 0, 0], [999, 1, 1], [0, 1001, 0], [0, 0, 1001]] as Composition[]) {
    assert.ok(coarse.some(row => row.join() === c.join()));
  }
  const local = localCompositions([600, 400, 0], 2, 1);
  assert.ok(local.some(c => c[2] === 0)); assert.ok(local.some(c => c[2] === 1));
  assert.ok(local.some(c => c.join() === "610,390,0"));
});

test("CLI keeps repetition budgets independent of ordering and forbids invalid refinement", () => {
  const cli = parseCli(["input.json", "--reps", "37", "--seed", "0"]);
  assert.equal(cli.options.reps, 37); assert.equal(cli.options.screenReps, 4);
  assert.equal(cli.options.validationReps, 74); assert.equal(cli.options.seed, 0);
  assert.throws(() => parseCli(["input.json", "--refine-step", "0"]), /integer/);
  assert.throws(() => parseCli(["input.json", "--screen-reps", "1001"]), /screen-reps/);
  assert.throws(() => parseCli(["input.json", "--starts", "4"]), /starts/);
  assert.throws(() => parseCli(["input.json", "--wat"]), /Unexpected/);
  assert.deepEqual(passOrder(0), ["heroes", "gear", "troops"]);
  assert.deepEqual(passOrder(1), ["gear", "heroes", "troops"]);
});

test("new troop refinement finds a 1% optimum and retains one troop on the boundary", async () => {
  const raw = input(); delete (raw as Partial<typeof raw>).optimization;
  const model = createSearchModel(raw, config);
  const options = { ...DEFAULT_OPTIONS, passes: 1, jobs: 1, reps: 10, screenReps: 1, validationReps: 20, coarseStep: 20, refineStep: 5, seeds: 2, finalists: 3 };
  const result = await searchLoadouts(model, config, options, async (s, reps) => {
    const distance = s.troops.reduce((sum, c) => sum + Math.abs(c[0] - 630) + Math.abs(c[1] - 369) + Math.abs(c[2] - 1), 0);
    return synthetic(1 - distance / 10000, reps);
  });
  assert.deepEqual(result.best.loadout.troops, [[630, 369, 1], [630, 369, 1], [630, 369, 1]]);
});

test("alternating stages revisit choices and independent validation can retain original setup", async () => {
  const model = createSearchModel(input(), config);
  const calls: Array<{ reps: number; seed: number }> = [];
  const options = { ...DEFAULT_OPTIONS, passes: 2, starts: 2, jobs: 2, reps: 3, screenReps: 1, validationReps: 7, coarseStep: 100, refineStep: 100, seeds: 1, finalists: 1 };
  const result = await searchLoadouts(model, config, options, async (s, reps, seed) => {
    calls.push({ reps, seed });
    const original = JSON.stringify(s) === JSON.stringify(model.initial);
    // Search samples prefer a changed allocation; independent validation reverses that.
    const score = seed === options.seed + 10_000_019 ? (original ? 0.9 : 0.1) : s.gear.infantry[0] === 2 ? 0.8 : 0.2;
    return synthetic(score, reps);
  });
  assert.deepEqual(result.best.loadout, model.initial);
  assert.deepEqual(result.history.slice(0, 6).map(s => s.stage), ["heroes", "gear", "troops", "gear", "heroes", "troops"]);
  assert.equal(result.history.length, 12);
  assert.equal(result.matches, calls.reduce((sum, c) => sum + c.reps, 0));
  assert.equal(result.evaluations, calls.length);
  assert.ok(calls.filter(c => c.reps === 7).every(c => c.seed === options.seed + 10_000_019));
});

test("a later hero pass changes its choice after gear allocation changes the context", async () => {
  const raw = input(); raw.optimization.per_army_hero_pools[0].infantry = ["Gatot", "Magnus"];
  const model = createSearchModel(raw, config);
  const options = { ...DEFAULT_OPTIONS, passes: 2, jobs: 1, reps: 2, screenReps: 1, validationReps: 4,
    coarseStep: 50, refineStep: 10, seeds: 1, finalists: 3 };
  const result = await searchLoadouts(model, config, options, async (s, reps) => {
    const heroes = s.heroes[0];
    const magnus = Array.isArray(heroes) ? heroes.some(h => h.name === "Magnus") : Object.hasOwn(heroes ?? {}, "Magnus");
    const bestGear = s.gear.infantry[0] === 2;
    return synthetic(0.2 + (bestGear ? 0.2 : 0) + (magnus ? bestGear ? 0.2 : -0.1 : 0), reps);
  });
  assert.equal(result.history[0].scoreRate, 0.2);
  assert.equal(result.history[1].scoreRate, 0.4);
  assert.ok(Math.abs(result.history[4].scoreRate - 0.6) < 1e-10);
  assert.equal(result.best.loadout.gear.infantry[0], 2);
  const heroes = result.best.loadout.heroes[0];
  assert.ok(Array.isArray(heroes) && heroes.some(h => h.name === "Magnus"));
});

test("export round-trips both input formats without applying player passives twice", () => {
  const raw = input();
  const model = createSearchModel(raw, config);
  const loadout = [...gearCandidates(model.initial)][80];
  const output = exportConfiguration(raw, model, loadout, config);
  const parsed = parseDefinition(output, config);
  assert.deepEqual(parsed.attacker[0].fighter.passive, { attack: { up: 10 } });
  const restored = createSearchModel(output, config);
  assert.deepEqual(definitionForLoadout(restored, restored.initial), definitionForLoadout(model, loadout));
  assert.deepEqual(output.defender, raw.defender);
  const residual = removeHeroGenerationStats(parsed.attacker[0].fighter, config);
  assert.deepEqual(residual.stats, definitionForLoadout(model, loadout).attacker[0].fighter.stats);
});

test("actual serial and worker evaluations agree in both ordering modes with the exact match budget", async () => {
  for (const ordering of ["random", "sequential"]) {
    const raw = input(); raw.ordering = ordering;
    const model = createSearchModel(raw, config);
    const serial = createEvaluator(model, config, 1);
    const parallel = createEvaluator(model, config, 2);
    try {
      const results = await Promise.all([serial.evaluate(model.initial, 7, 42), parallel.evaluate(model.initial, 7, 42)]);
      assert.deepEqual(results[0], results[1]);
      assert.equal(results[0].evaluation.scenarios, 7);
    } finally { await serial.close(); await parallel.close(); }
  }
});

test("public synthetic inputs round-trip both hero-stat provenance modes without mutation", () => {
  for (const includesGeneration of [false, true]) {
    const raw = input();
    raw.input_stats_include_hero_generation.attacker = includesGeneration;
    if (includesGeneration) for (const army of raw.attacker.armies) {
      army.fighter.stats = applyHeroGenerationStats(army.fighter, config).stats as typeof army.fighter.stats;
    }
    const before = JSON.stringify(raw);
    const model = createSearchModel(raw, config);
    const original = parseDefinition(raw, config);
    const rebuilt = definitionForLoadout(model, model.initial);
    for (let i = 0; i < 3; i++) {
      const effective = applyHeroGenerationStats(rebuilt[model.side][i].fighter, config);
      const expected = original.input_stats_include_hero_generation[model.side]
        ? original[model.side][i].fighter.stats : applyHeroGenerationStats(original[model.side][i].fighter, config).stats;
      for (const t of UNIT_TYPES) for (const k of Object.keys(stat(0)) as Array<keyof StatBlock>) {
        assert.ok(Math.abs(effective.stats![t]![k]! - expected![t]![k]!) < 1e-8);
      }
    }
    assert.equal(JSON.stringify(raw), before);
  }
});

test("defender optimization moves only defender gear and keeps opponent fixed", () => {
  const raw = input(); raw.optimization.side = "defender"; raw.troop_optimization.side = "defender";
  const model = createSearchModel(raw, config);
  const changed = [...gearCandidates(model.initial)][100];
  assert.deepEqual(definitionForLoadout(model, changed).attacker, model.definition.attacker);
  assert.notDeepEqual(definitionForLoadout(model, changed).defender, model.definition.defender);
});

test("mixed tiers, missing troop IDs, fractional counts and empty hero searches fail clearly", async () => {
  const missing = input(); delete (missing.attacker.armies[0].fighter.troops as Record<string, number>).marksman_t6;
  assert.throws(() => createSearchModel(missing, config), /zero count/);
  const mixed = input(); Object.assign(mixed.attacker.armies[0].fighter.troops, { infantry_t10: 0 });
  assert.throws(() => createSearchModel(mixed, config), /multiple tiers/);
  const fraction = input(); fraction.attacker.armies[0].fighter.troops.infantry_t6 = 1.5;
  assert.throws(() => createSearchModel(fraction, config), /integer/);
  const raw = input();
  raw.optimization.per_army_hero_pools[1].infantry = ["Gatot"];
  await assert.rejects(searchLoadouts(createSearchModel(raw, config), config, DEFAULT_OPTIONS, async () => synthetic(0, 1)), /no valid candidates/);
});

test("CLI rejects input aliases before parsing or searching and leaves the input untouched", async () => {
  const dir = mkdtempSync(join(tmpdir(), "loadout-output-safety-"));
  try {
    const path = join(dir, "input.json");
    const contents = "deliberately invalid JSON: must not reach parsing";
    writeFileSync(path, contents);
    const symlink = join(dir, "symlink.json"), hardlink = join(dir, "hardlink.json");
    symlinkSync(path, symlink); linkSync(path, hardlink);
    for (const output of [path, join(dir, ".", "input.json"), symlink, hardlink]) {
      await assert.rejects(main([path, "--output", output]), /must differ from the input/);
      assert.equal(readFileSync(path, "utf8"), contents);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
