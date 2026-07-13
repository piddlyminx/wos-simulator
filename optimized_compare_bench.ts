import { performance } from "node:perf_hooks";

import { loadSimulatorConfig } from "./simulator/src/config";
import { teamToBattleInput } from "./scripts/tournament/teamInput";
import type { Team } from "./scripts/tournament/types";

const implementationRoot = process.argv[2];
const workload = process.argv[3] ?? "representative";
const iterations = Number(
  process.argv[4] ?? (workload === "long" ? 200 : 8_000),
);
if (!implementationRoot) throw new Error("implementation root is required");

async function main(): Promise<void> {
  const simulator = await import(
    `${implementationRoot}/simulator/src/simulator.ts`
  );
  const config = loadSimulatorConfig();

  const representativeTroops = {
    infantry_t10: 333_334,
    lancer_t10: 333_333,
    marksman_t10: 333_333,
  };
  const representativeTeams: Team[] = [
    {
      id: 1,
      ratioLabel: "balanced",
      mains: ["Wu Ming", "Mia", "Bradley"],
      joiners: ["Jessie", "Seo-yoon", "Lumak", "Ling"],
      troops: representativeTroops,
    },
    {
      id: 2,
      ratioLabel: "balanced",
      mains: ["Hector", "Reina", "Gwen"],
      joiners: ["Jeronimo", "Norah", "Jasser", "Wayne"],
      troops: representativeTroops,
    },
    {
      id: 3,
      ratioLabel: "balanced",
      mains: ["Flint", "Molly", "Alonso"],
      joiners: ["Natalia", "Philly", "Greg", "Zinman"],
      troops: representativeTroops,
    },
    {
      id: 4,
      ratioLabel: "balanced",
      mains: ["Ahmose", "Renee", "Lynn"],
      joiners: ["Sergey", "Patrick", "Bahiti", "Edith"],
      troops: representativeTroops,
    },
  ];
  const pairs: Array<[number, number]> = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [0, 2],
    [1, 3],
  ];

  let compiled: Array<ReturnType<typeof simulator.prepareBattle>>;
  let warmups: number;
  if (workload === "long") {
    const troops = { infantry_t10: 300_000, lancer_t10: 0, marksman_t10: 0 };
    const base = {
      ratioLabel: "inf",
      mains: ["Logan"] as unknown as Team["mains"],
      joiners: ["Ahmose", "Natalia", "Hector", "Molly"] as Team["joiners"],
      troops,
    };
    const input = teamToBattleInput(
      { id: 1, ...base },
      { id: 2, ...base },
      10_000,
      config,
    );
    input.maxRounds = 1_500;
    compiled = [simulator.prepareBattle(input, config)];
    warmups = 50;
  } else {
    compiled = pairs.map(([attacker, defender], index) =>
      simulator.prepareBattle(
        teamToBattleInput(
          representativeTeams[attacker],
          representativeTeams[defender],
          10_000 + index,
          config,
        ),
        config,
      ),
    );
    warmups = 750;
  }

  const samples = compiled.map((battle, index) =>
    simulator.runPrepared(battle, 10_000 + index, { mode: "standard" }),
  );
  function one(index: number): number {
    const result = simulator.runPrepared(
      compiled[index % compiled.length],
      100_000 + index,
      { mode: "fast" },
    );
    return simulator.signedRemainingScore(result) + result.rounds;
  }

  let checksum = 0;
  for (let index = 0; index < warmups; index += 1) checksum += one(index);
  const start = performance.now();
  for (let index = 0; index < iterations; index += 1) checksum += one(index);
  const elapsedMs = performance.now() - start;

  console.log(
    JSON.stringify({
      workload,
      iterations,
      elapsedMs,
      msPerBattle: elapsedMs / iterations,
      checksum,
      meanRounds:
        samples.reduce((sum, result) => sum + result.rounds, 0) /
        samples.length,
      meanAttacks:
        samples.reduce((sum, result) => sum + result.attacks.length, 0) /
        samples.length,
    }),
  );
}

void main();
