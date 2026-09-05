"use client";

import { useRouter } from "next/navigation";
import BearSimClient from "@/app/bear/BearSimClient";
import SimulateClient from "@/app/simulate/SimulateClient";
import type { SavedSimulationRunResponse } from "@/lib/simulate-run";
import type { DeploySimulatorMode } from "@/lib/simulate/deploy-route";

interface DeploySimulatorClientProps {
  mode: DeploySimulatorMode;
  initialRunId: string | null;
  initialSavedRun: SavedSimulationRunResponse | null;
  initialSavedRunError: string | null;
}

export default function DeploySimulatorClient({
  mode,
  initialRunId,
  initialSavedRun,
  initialSavedRunError,
}: DeploySimulatorClientProps) {
  const router = useRouter();

  function chooseMode(nextMode: DeploySimulatorMode) {
    if (nextMode === mode) return;
    router.push(`/simualate-wosui?mode=${nextMode}`);
  }

  return (
    <div className="deploy-simulator-skin" data-testid="deploy-simulator">
      <header className="deploy-hero">
        <div className="deploy-hero-snow" aria-hidden="true" />
        <button
          type="button"
          className="deploy-back-button"
          onClick={() => router.push("/")}
          aria-label="Back to dashboard"
        >
          <span aria-hidden="true">←</span>
        </button>
        <div className="deploy-hero-copy">
          <h1>Deploy</h1>
        </div>
        <div
          className="deploy-mode-tabs"
          role="tablist"
          aria-label="Deployment target"
        >
          <button
            type="button"
            role="tab"
            aria-label="Battle Army vs army"
            aria-selected={mode === "battle"}
            data-active={mode === "battle"}
            onClick={() => chooseMode("battle")}
          >
            <span aria-hidden="true">⚔</span>
            <span><strong>Battle</strong><small>Army vs army</small></span>
          </button>
          <button
            type="button"
            role="tab"
            aria-label="Bear Rally score"
            aria-selected={mode === "bear"}
            data-active={mode === "bear"}
            onClick={() => chooseMode("bear")}
          >
            <span aria-hidden="true">◆</span>
            <span><strong>Bear</strong><small>Rally score</small></span>
          </button>
        </div>
      </header>

      <div className="deploy-workspace" data-mode={mode}>
        {mode === "battle" ? (
          <SimulateClient
            initialRunId={initialRunId}
            initialSavedRun={initialSavedRun}
            initialSavedRunError={initialSavedRunError}
            alternateRunLinks
            presentation="deploy"
          />
        ) : (
          <BearSimClient
            initialRunId={initialRunId}
            initialSavedRun={initialSavedRun}
            initialSavedRunError={initialSavedRunError}
            alternateRunLinks
            presentation="deploy"
          />
        )}
      </div>
    </div>
  );
}
