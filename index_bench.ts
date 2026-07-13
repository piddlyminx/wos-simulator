import { performance } from "node:perf_hooks";
import { loadSimulatorConfig } from "./simulator/src/config";
import { prepareBattle, runPrepared, signedRemainingScore } from "./simulator/src/simulator";
import { teamToBattleInput } from "./scripts/tournament/teamInput";
import type { Team } from "./scripts/tournament/types";

const troops = { infantry_t10: 333_334, lancer_t10: 333_333, marksman_t10: 333_333 };
const teams: Team[] = [
  { id: 1, ratioLabel: "balanced", mains: ["Wu Ming", "Mia", "Bradley"], joiners: ["Jessie", "Seo-yoon", "Lumak", "Ling"], troops },
  { id: 2, ratioLabel: "balanced", mains: ["Hector", "Reina", "Gwen"], joiners: ["Jeronimo", "Norah", "Jasser", "Wayne"], troops },
  { id: 3, ratioLabel: "balanced", mains: ["Flint", "Molly", "Alonso"], joiners: ["Natalia", "Philly", "Greg", "Zinman"], troops },
  { id: 4, ratioLabel: "balanced", mains: ["Ahmose", "Renee", "Lynn"], joiners: ["Sergey", "Patrick", "Bahiti", "Edith"], troops }
];
const pairs: Array<[number, number]> = [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2], [1, 3]];
const config = loadSimulatorConfig();
const compiled = pairs.map(([a, d], i) => prepareBattle(teamToBattleInput(teams[a], teams[d], 10_000 + i, config), config));
const iterations = Number(process.argv[2] ?? 8_000);
const sampleResults = compiled.map((battle, i) => runPrepared(battle, 10_000 + i, { mode: "standard" }));

function one(i: number): number {
  const result = runPrepared(compiled[i % compiled.length], 100_000 + i, { mode: "fast" });
  return signedRemainingScore(result) + result.rounds;
}

let checksum = 0;
for (let i = 0; i < 750; i += 1) checksum += one(i);
const start = performance.now();
for (let i = 0; i < iterations; i += 1) checksum += one(i);
const elapsedMs = performance.now() - start;
process.stdout.write(JSON.stringify({
  iterations,
  elapsedMs,
  msPerBattle: elapsedMs / iterations,
  checksum,
  meanRounds: sampleResults.reduce((sum, result) => sum + result.rounds, 0) / sampleResults.length,
  meanAttacks: sampleResults.reduce((sum, result) => sum + result.attacks.length, 0) / sampleResults.length
}) + "\n");
