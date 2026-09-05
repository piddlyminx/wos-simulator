import DeploySimulatorClient from "./DeploySimulatorClient";
import { readSimulationRun } from "@/lib/simulation-store";
import type { SavedSimulationRunResponse } from "@/lib/simulate-run";
import {
  deployModeForSavedKind,
  type DeploySimulatorMode,
} from "@/lib/simulate/deploy-route";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ mode?: string; run?: string }>;
}

export default async function DeployPage({ searchParams }: PageProps) {
  const { mode: requestedMode, run } = await searchParams;
  let mode: DeploySimulatorMode = requestedMode === "bear" ? "bear" : "battle";
  let initialSavedRun: SavedSimulationRunResponse | null = null;
  let initialSavedRunError: string | null = null;

  if (run) {
    try {
      const saved = await readSimulationRun(run);
      if (!saved) {
        initialSavedRunError = `No saved simulation found for ${run}`;
      } else {
        initialSavedRun = saved;
        mode = deployModeForSavedKind(saved.kind);
      }
    } catch (error) {
      initialSavedRunError =
        error instanceof Error ? error.message : "Failed to load saved run";
    }
  }

  return (
    <DeploySimulatorClient
      mode={mode}
      initialRunId={run ?? null}
      initialSavedRun={initialSavedRun}
      initialSavedRunError={initialSavedRunError}
    />
  );
}
