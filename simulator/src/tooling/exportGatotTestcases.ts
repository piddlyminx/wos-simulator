import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadSimulatorConfig } from "../config-node";
import type { BattleInput, SimulatorConfig } from "../types";
import { GATOT_GAME_OBSERVATIONS, type GatotGameObservation } from "./gatotEvidence";

export interface GatotTestcaseArtifact {
  filename: string;
  testcase: readonly [Record<string, unknown>];
  runnable: boolean;
}

function runnableTestcase(
  observation: GatotGameObservation,
  input: BattleInput
): Record<string, unknown> {
  return {
    test_id: observation.id,
    description: `Gatot evidence section ${observation.section}: ${observation.caseLabel}`,
    attacker: input.attacker,
    defender: input.defender,
    ...(input.engagement_type !== undefined ? { engagement_type: input.engagement_type } : {}),
    game_report_result: [
      {
        attacker: observation.game.survivors.attacker,
        defender: observation.game.survivors.defender
      }
    ]
  };
}

function disabledTestcase(
  observation: GatotGameObservation,
  reason: string
): Record<string, unknown> {
  return {
    test_id: observation.id,
    description: `Gatot evidence section ${observation.section}: ${observation.caseLabel}`,
    disabled_reason: reason
  };
}

export function gatotTestcaseArtifacts(
  config: SimulatorConfig = loadSimulatorConfig()
): GatotTestcaseArtifact[] {
  return GATOT_GAME_OBSERVATIONS.map((observation) => {
    const hasCompleteOutcome =
      observation.game.survivors.attacker !== undefined &&
      observation.game.survivors.defender !== undefined;
    const runnable = Boolean(observation.buildInput && hasCompleteOutcome);
    const reason = observation.notRunnableReason ??
      "The recorded evidence does not contain both survivor counts, so it cannot be used for parity scoring.";
    const testcase = runnable
      ? runnableTestcase(observation, observation.buildInput!(config))
      : disabledTestcase(observation, reason);
    return {
      filename: `${observation.id}.json${runnable ? "" : ".disabled"}`,
      testcase: [testcase],
      runnable
    };
  });
}

export function writeGatotTestcases(
  outputDirectory = resolve(import.meta.dirname, "../../../testcases/gatot_verified")
): GatotTestcaseArtifact[] {
  const artifacts = gatotTestcaseArtifacts();
  mkdirSync(outputDirectory, { recursive: true });
  for (const artifact of artifacts) {
    writeFileSync(
      resolve(outputDirectory, artifact.filename),
      `${JSON.stringify(artifact.testcase, null, 2)}\n`,
      "utf8"
    );
  }
  return artifacts;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (invokedPath === import.meta.url) {
  const artifacts = writeGatotTestcases(process.argv[2]);
  const runnable = artifacts.filter((artifact) => artifact.runnable).length;
  process.stdout.write(
    `Wrote ${artifacts.length} Gatot testcase files (${runnable} active, ${artifacts.length - runnable} disabled).\n`
  );
}
