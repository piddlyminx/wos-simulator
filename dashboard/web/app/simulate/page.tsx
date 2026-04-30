import SimulateClient from "./SimulateClient";
import { readSimulationRun } from "@/lib/simulation-store";
import type { SavedSimulationRunResponse } from "@/lib/simulate-run";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ run?: string }>;
}

export default async function SimulatePage({ searchParams }: PageProps) {
  const { run } = await searchParams;
  let initialSavedRun: SavedSimulationRunResponse | null = null;
  let initialSavedRunError: string | null = null;

  if (run) {
    try {
      initialSavedRun = await readSimulationRun(run);
      if (!initialSavedRun) {
        initialSavedRunError = `No saved simulation found for ${run}`;
      }
    } catch (err) {
      initialSavedRunError =
        err instanceof Error ? err.message : "Failed to load saved run";
    }
  }

  return (
    <SimulateClient
      initialRunId={run ?? null}
      initialSavedRun={initialSavedRun}
      initialSavedRunError={initialSavedRunError}
    />
  );
}
