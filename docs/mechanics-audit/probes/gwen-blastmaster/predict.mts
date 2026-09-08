import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareBattle, runPrepared, signedRemainingScore } from "../../../../simulator/src/simulator";
import type { BattleInput, SimulatorConfig } from "../../../../simulator/src/types";

const dir = dirname(fileURLToPath(import.meta.url));
const snapshotPath = resolve(dir, "config-snapshot.json");
const snapshot = readFileSync(snapshotPath, "utf8");
const frozen: SimulatorConfig = JSON.parse(snapshot);
const inputPath = resolve(process.argv[2] ?? resolve(dir, "estimated-input.json"));
const outputPath = resolve(process.argv[3] ?? resolve(dir, "prediction.json"));
if (outputPath === resolve(dir, "prediction.json") && existsSync(outputPath)) throw Error("Preserve the original prospective prediction; supply a different output path for replay.");
const input: BattleInput = JSON.parse(readFileSync(inputPath, "utf8"));
const estimatedInputReplay = inputPath === resolve(dir, "estimated-input.json");
const candidateDefinitions = {
  all_living: { description: "Frozen current configuration: Blastmaster emits one skill job per enemy living troop line.", changes: [] },
  current_target: {
    description: "Only Blastmaster fanout changes; the full Gwen kit and all other behavior are identical.",
    changes: [{ path: "heroDefinitions.Gwen.skills.Blastmaster.effects.Blastmaster/1.trigger_damage_jobs.0.target", from: "enemy.living", to: "use.target" }]
  }
};
const variants = { all_living: frozen, current_target: structuredClone(frozen) };
variants.current_target.heroDefinitions.Gwen.skills.Blastmaster.effects["Blastmaster/1"].trigger_damage_jobs![0].target = "use.target";
const uncertainFields = [
  ...["attack", "defense", "lethality", "health"].map(stat => ["attacker", "mark", stat]),
  ...["inf", "lanc", "mark"].flatMap(unit => ["attack", "defense", "lethality", "health"].map(stat => ["defender", unit, stat]))
];
let state = 20260907;
const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
const perturbations = Array.from({ length: 256 }, () => uncertainFields.map(() => (random() - 0.5) * 0.1));
for (let index = 0; index < uncertainFields.length; index++) for (const sign of [-1, 1]) perturbations.push(uncertainFields.map((_, i) => i === index ? sign * 0.05 : 0));
for (const sign of [-1, 1]) perturbations.push(uncertainFields.map(([side]) => (side === "attacker" ? sign : -sign) * 0.05));
const candidates = Object.fromEntries(Object.entries(variants).map(([name, config]) => {
  const result = runPrepared(prepareBattle(input, config), "gwen-fanout", { mode: "trace" });
  const blastmaster = result.attacks.filter(attack => attack.sourceEffectId === "Blastmaster/1");
  const sampleScores = perturbations.map(offsets => {
    const variantInput: any = structuredClone(input);
    uncertainFields.forEach(([side, unit, stat], index) => variantInput[side].stats[unit][stat] += offsets[index]);
    return signedRemainingScore(runPrepared(prepareBattle(variantInput, config), "gwen-fanout-stat-precision", { mode: "fast" }));
  });
  return [name, {
    signedRemaining: signedRemainingScore(result), winner: result.winner, rounds: result.rounds,
    remaining: result.remaining, randomness: result.randomness,
    heroReport: result.skillReport.attacker.filter(entry => entry.sourceKind === "hero_skill"),
    blastmasterJobs: blastmaster.map(attack => ({ round: attack.round, kind: attack.kind, target: attack.takerUnit, rawKills: attack.kills })),
    sampledStatPrecisionRange: { min: Math.min(...sampleScores), max: Math.max(...sampleScores), sampleCount: sampleScores.length },
    everyDefenderLineSurvives: Object.values(result.remaining.defender).every(count => count > 0)
  }];
}));
const prediction = {
  generatedAt: new Date().toISOString(), phase: estimatedInputReplay ? "historical_estimate_replay" : "frozen_candidate_replay",
  configSnapshotSha256: createHash("sha256").update(snapshot).digest("hex"), configSnapshot: snapshotPath,
  inputPath, input, candidateDefinitions,
  provenance: {
    inputStats: estimatedInputReplay
      ? "Historical report-resolved estimates copied from skill/tmp/renee_gwen_2k_discriminator.ts. Only attacker Marksman stats are used; Renee's Lancer-generation bonus is inactive. No hero-generation stats are added. This replay occurs after the new game outcome was observed; the original prospective prediction is preserved separately."
      : "Exact displayed report stats and full kit from testcases/emulator_verified/gwen_blastmaster_fanout_800m_vs_600_each.json, substituted through the inputPath BattleInput after capture. Stats remain report-resolved; no hero-generation bonus is added. The +/-0.05 probe models report display precision, not account drift.",
    heroKit: "Parent confirmed minxxx Gwen 3/1/1 by fresh capture on 2026-09-07: skill/tmp/debug/hero_skills_minxxx_20260907T035615Z_00.",
    outcomeExposure: "The new game outcome has been observed before this replay. Both hypothesis definitions and the config snapshot were frozen before capture; this replay changes only the supplied battle input. The original prospective prediction.json remains unchanged."
  },
  uncertainty: { allowedReportStatOffsets: [-0.05, 0.05], uncertainFields, randomSeed: 20260907, note: "256 independent shared stat vectors, 32 one-coordinate endpoints, and 2 common favorable corners. This is a sensitivity screen, not an exhaustive envelope or bound on account drift." },
  candidates
};
writeFileSync(outputPath, `${JSON.stringify(prediction, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, configSnapshotSha256: prediction.configSnapshotSha256, candidates: Object.fromEntries(Object.entries(candidates).map(([name, result]: [string, any]) => [name, { score: result.signedRemaining, rounds: result.rounds, remaining: result.remaining, precision: result.sampledStatPrecisionRange }])) }, null, 2));
