import TournamentClient from "./TournamentClient";
import { readSimulationRun } from "@/lib/simulation-store";
import {
  isTournamentSavedSimulationKind,
  type SavedSimulationRunResponse,
} from "@/lib/simulate-run";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ run?: string }>;
}

export default async function TournamentPage({ searchParams }: PageProps) {
  const { run } = await searchParams;
  let initialSavedRun: SavedSimulationRunResponse | null = null;
  let initialSavedRunError: string | null = null;

  if (run) {
    try {
      const saved = await readSimulationRun(run);
      if (!saved) {
        initialSavedRunError = `No saved tournament found for ${run}`;
      } else if (!isTournamentSavedSimulationKind(saved.kind)) {
        initialSavedRunError = `Saved run ${run} is not a tournament.`;
      } else {
        initialSavedRun = saved;
      }
    } catch (err) {
      initialSavedRunError =
        err instanceof Error ? err.message : "Failed to load saved tournament";
    }
  }

  return (
    <TournamentClient
      initialRunId={run ?? null}
      initialSavedRun={initialSavedRun}
      initialSavedRunError={initialSavedRunError}
    />
  );
}
