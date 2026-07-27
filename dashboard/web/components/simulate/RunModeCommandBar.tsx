"use client";

import type { Dispatch, SetStateAction } from "react";
import {
  MAX_ADAPTIVE_FINAL_REPLICATES,
  MAX_ADAPTIVE_PRELIMINARY_REPLICATES,
  recommendedOptimizeStep,
  type OptimizeRankBy,
  type OptimizeSearchMode,
  type OptimizeSide,
} from "@/lib/optimize-ratio";
import { ClampedNumberField, NumberStringField } from "./ClampedNumberField";
import { ProgressBar } from "./SharedSimComponents";
import { MAX_SURFACE_JOBS } from "@/lib/simulate/saved-run-state";

export type RunMode = "simulate" | "optimise" | "explore";

export interface RunModeView {
  summary: string;
  progress: {
    active: boolean;
    done: number;
    total: number;
  };
  error: string | null;
  primaryLabel: string;
  disabled: boolean;
  title: string;
  status: string;
}

const RUN_MODE_LABEL: Record<RunMode, string> = {
  simulate: "Simulate",
  optimise: "Optimise ratio",
  explore: "Explore ratios",
};

export function runModeLabel(mode: RunMode) {
  return RUN_MODE_LABEL[mode];
}

export function RunModeCommandBar({
  adaptiveFinalReplicates,
  adaptivePhase1Replicates,
  adaptivePhase2Replicates,
  loading,
  optimizeBudgetTooLarge,
  optimizeHelpText,
  optimizeInfantryMaxPct,
  optimizeInfantryMinPct,
  optimizeInputsValid,
  optimizeLoading,
  optimizeRankBy,
  optimizeReplicates,
  optimizeSearchMode,
  optimizeSide,
  optimizeStepInput,
  optimizedTotalTroops,
  replicates,
  resolvedInfantryBounds,
  resolvedOptimizeStep,
  runMode,
  runModeView,
  runOptionsOpen,
  runOptionsPanelId,
  runSelectedMode,
  setAdaptiveFinalReplicates,
  setAdaptivePhase1Replicates,
  setAdaptivePhase2Replicates,
  setOptimizeInfantryMaxPct,
  setOptimizeInfantryMinPct,
  setOptimizeRankBy,
  setOptimizeReplicates,
  setOptimizeSearchMode,
  setOptimizeSide,
  setOptimizeStepInput,
  setReplicates,
  setRunMode,
  setRunOptionsOpen,
  setSurfaceJobs,
  setSurfacePointsPerEdge,
  setSurfaceReplicates,
  surfaceJobs,
  surfaceLoading,
  surfacePointsPerEdge,
  surfaceReplicates,
}: {
  adaptiveFinalReplicates: number;
  adaptivePhase1Replicates: number;
  adaptivePhase2Replicates: number;
  loading: boolean;
  optimizeBudgetTooLarge: boolean;
  optimizeHelpText: string;
  optimizeInfantryMaxPct: number;
  optimizeInfantryMinPct: number;
  optimizeInputsValid: boolean;
  optimizeLoading: boolean;
  optimizeRankBy: OptimizeRankBy;
  optimizeReplicates: number;
  optimizeSearchMode: OptimizeSearchMode;
  optimizeSide: OptimizeSide;
  optimizeStepInput: string;
  optimizedTotalTroops: number;
  replicates: number;
  resolvedInfantryBounds: { minPct: number; maxPct: number };
  resolvedOptimizeStep: number;
  runMode: RunMode;
  runModeView: RunModeView;
  runOptionsOpen: boolean;
  runOptionsPanelId: string;
  runSelectedMode: () => void;
  setAdaptiveFinalReplicates: (value: number) => void;
  setAdaptivePhase1Replicates: (value: number) => void;
  setAdaptivePhase2Replicates: (value: number) => void;
  setOptimizeInfantryMaxPct: (value: number) => void;
  setOptimizeInfantryMinPct: (value: number) => void;
  setOptimizeRankBy: (value: OptimizeRankBy) => void;
  setOptimizeReplicates: (value: number) => void;
  setOptimizeSearchMode: (value: OptimizeSearchMode) => void;
  setOptimizeSide: Dispatch<SetStateAction<OptimizeSide>>;
  setOptimizeStepInput: (value: string) => void;
  setReplicates: (value: number) => void;
  setRunMode: (value: RunMode) => void;
  setRunOptionsOpen: Dispatch<SetStateAction<boolean>>;
  setSurfaceJobs: (value: number) => void;
  setSurfacePointsPerEdge: (value: number) => void;
  setSurfaceReplicates: (value: number) => void;
  surfaceJobs: number;
  surfaceLoading: boolean;
  surfacePointsPerEdge: number;
  surfaceReplicates: number;
}) {
  return (
    <section
      className="sim-mode-command"
      aria-label="Run mode"
      data-testid="run-mode-command"
      data-tour="run-mode-command"
    >
      {runOptionsOpen && runMode !== "simulate" && (
        <div
          id={runOptionsPanelId}
          className="sim-mode-options"
          data-testid="run-mode-options-panel"
        >
          <div className="sim-mode-options-header">
            <h3>{runModeLabel(runMode)} options</h3>
            <button
              type="button"
              onClick={() => setRunOptionsOpen(false)}
              className="sim-options-close"
              aria-label="Hide run options"
            >
              Close
            </button>
          </div>
          {runMode === "optimise" && (
            <div
              className="sim-mode-options-grid"
              data-testid="optimize-options-panel"
            >
              <div className="sim-mode-option-copy">
                <p>{optimizeHelpText}</p>
                <p>
                  Infantry search band: {resolvedInfantryBounds.minPct}% to{" "}
                  {resolvedInfantryBounds.maxPct}%.
                  {optimizeSearchMode === "adaptive"
                    ? " Adaptive search starts on a 5% grid, checks 1% neighbours, then reruns finalist ratios."
                    : optimizeStepInput.trim()
                      ? ` Step ${resolvedOptimizeStep.toLocaleString()} troops.`
                      : ` Auto step ${resolvedOptimizeStep.toLocaleString()} troops.`}
                </p>
              </div>
              <div
                className="sim-mode-option-row sim-mode-search-row"
                role="group"
                aria-labelledby="optimize-side-label"
              >
                <span id="optimize-side-label" className="sim-field-label">
                  Optimise side
                </span>
                <div className="sim-segmented">
                  {(["attacker", "defender"] as OptimizeSide[]).map((side) => (
                    <button
                      key={side}
                      type="button"
                      onClick={() => setOptimizeSide(side)}
                      className="capitalize"
                      data-active={optimizeSide === side}
                    >
                      {side}
                    </button>
                  ))}
                </div>
              </div>
              <div
                className="sim-mode-option-row sim-mode-search-row"
                role="group"
                aria-labelledby="optimize-rank-by-label"
              >
                <span id="optimize-rank-by-label" className="sim-field-label">
                  Rank by
                </span>
                <div className="sim-segmented">
                  {(["win_rate", "margin"] as OptimizeRankBy[]).map((rankBy) => (
                    <button
                      key={rankBy}
                      type="button"
                      onClick={() => setOptimizeRankBy(rankBy)}
                      data-active={optimizeRankBy === rankBy}
                    >
                      {rankBy === "win_rate" ? "Win rate" : "Margin"}
                    </button>
                  ))}
                </div>
              </div>
              <div
                className="sim-mode-option-row sim-mode-search-row"
                role="group"
                aria-labelledby="optimize-search-mode-label"
              >
                <span id="optimize-search-mode-label" className="sim-field-label">
                  Search mode
                </span>
                <div className="sim-segmented">
                  {(["adaptive", "grid"] as OptimizeSearchMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setOptimizeSearchMode(mode)}
                      className="capitalize"
                      data-active={optimizeSearchMode === mode}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>
              {optimizeSearchMode === "adaptive" ? (
                <>
                  <ClampedNumberField
                    label="Coarse reps"
                    name="optimise.adaptive.phase1Replicates"
                    min={1}
                    max={MAX_ADAPTIVE_PRELIMINARY_REPLICATES}
                    value={adaptivePhase1Replicates}
                    onChange={setAdaptivePhase1Replicates}
                  />
                  <ClampedNumberField
                    label="Local reps"
                    name="optimise.adaptive.phase2Replicates"
                    min={1}
                    max={MAX_ADAPTIVE_PRELIMINARY_REPLICATES}
                    value={adaptivePhase2Replicates}
                    onChange={setAdaptivePhase2Replicates}
                  />
                  <ClampedNumberField
                    label="Final reps"
                    name="optimise.adaptive.finalReplicates"
                    min={1}
                    max={MAX_ADAPTIVE_FINAL_REPLICATES}
                    value={adaptiveFinalReplicates}
                    onChange={setAdaptiveFinalReplicates}
                  />
                </>
              ) : (
                <>
                  <ClampedNumberField
                    label="Ratio reps"
                    name="optimise.grid.ratioReplicates"
                    min={1}
                    max={500}
                    value={optimizeReplicates}
                    onChange={setOptimizeReplicates}
                  />
                  <NumberStringField
                    label="Grid step"
                    name="optimise.grid.step"
                    min={1}
                    inputMode="numeric"
                    value={optimizeStepInput}
                    onChange={setOptimizeStepInput}
                    placeholder={String(recommendedOptimizeStep(optimizedTotalTroops))}
                  />
                </>
              )}
              <ClampedNumberField
                label="Inf min %"
                name="optimise.infantryMinPct"
                min={0}
                max={100}
                parse="float"
                value={optimizeInfantryMinPct}
                onChange={setOptimizeInfantryMinPct}
              />
              <ClampedNumberField
                label="Inf max %"
                name="optimise.infantryMaxPct"
                min={0}
                max={100}
                parse="float"
                value={optimizeInfantryMaxPct}
                onChange={setOptimizeInfantryMaxPct}
              />
            </div>
          )}
          {runMode === "explore" && (
            <div
              className="sim-mode-options-grid"
              data-testid="explore-ratios-options-panel"
            >
              <div className="sim-mode-option-copy">
                <p>
                  Sweeps both armies across all troop ratios. Counts vary; each
                  side keeps its configured tiers, heroes, stats, buffs, and total
                  troop count.
                </p>
              </div>
              <label className="sim-mode-option-row">
                <span className="sim-field-label">Points / edge</span>
                <select
                  name="explore.pointsPerEdge"
                  value={surfacePointsPerEdge}
                  onChange={(e) => setSurfacePointsPerEdge(Number(e.target.value))}
                  className="sim-input min-h-[42px] px-3 py-2 font-mono text-sm"
                >
                  {[6, 11, 21].map((n) => (
                    <option key={n} value={n}>
                      {n} {"->"} {((n * (n + 1)) / 2).toLocaleString()} comps
                    </option>
                  ))}
                </select>
              </label>
              <ClampedNumberField
                label="Ratio reps"
                name="explore.ratioReplicates"
                min={1}
                max={50}
                value={surfaceReplicates}
                onChange={setSurfaceReplicates}
              />
              <ClampedNumberField
                label="Workers"
                name="explore.workers"
                min={1}
                max={MAX_SURFACE_JOBS}
                value={surfaceJobs}
                onChange={setSurfaceJobs}
              />
            </div>
          )}
        </div>
      )}

      <div className="sim-mode-command-main" data-testid="optimize-panel">
        <div className="sim-mode-tabs" role="tablist" aria-label="Run mode">
          {(["simulate", "optimise", "explore"] as RunMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={runMode === mode}
              onClick={() => {
                setRunMode(mode);
                if (mode === "simulate") setRunOptionsOpen(false);
              }}
              data-active={runMode === mode}
              className="sim-mode-tab"
            >
              {runModeLabel(mode)}
            </button>
          ))}
        </div>

        <div
          className="sim-mode-command-row"
          data-mode={runMode}
          data-testid="simulate-runbar"
        >
          {runMode === "simulate" && (
            <ClampedNumberField
              wrapperClassName="sim-replicates-inline"
              className="sim-input min-h-[34px] px-2 py-1 text-right font-mono text-sm tabular-nums"
              label="Replicates"
              name="simulate.replicates"
              min={1}
              max={10000}
              value={replicates}
              onChange={setReplicates}
            />
          )}
          {runMode !== "simulate" && (
            <button
              type="button"
              onClick={() => setRunOptionsOpen((open) => !open)}
              aria-expanded={runOptionsOpen}
              aria-controls={runOptionsPanelId}
              aria-label={runOptionsOpen ? "Hide run options" : "Show run options"}
              className="sim-options-toggle"
              data-testid="optimize-options-toggle"
              data-tour="run-mode-options-toggle"
            >
              <span>Options</span>
              <span aria-hidden="true" className="sim-options-chevron" />
            </button>
          )}
          {runMode !== "simulate" && (
            <div className="sim-mode-status">
              <span className="sim-mode-status-label">{runModeLabel(runMode)}</span>
              <span className="sim-mode-status-detail">{runModeView.summary}</span>
            </div>
          )}
          <button
            type="button"
            onClick={runSelectedMode}
            disabled={runModeView.disabled}
            className="sim-run-button sim-mode-primary-button"
            style={{
              opacity: runModeView.disabled ? 0.62 : 1,
              cursor:
                runModeView.disabled || loading || optimizeLoading
                  ? "not-allowed"
                  : surfaceLoading
                    ? "wait"
                    : "pointer",
            }}
            title={runModeView.title}
          >
            {runModeView.primaryLabel}
          </button>
        </div>
        <p
          className="sim-mode-inline-status"
          style={{
            color:
              runModeView.error ||
              (runMode === "optimise" &&
                (optimizeBudgetTooLarge || !optimizeInputsValid))
                ? "#f38ba8"
                : "var(--sim-muted)",
          }}
        >
          {runModeView.error ?? runModeView.status}
        </p>
        <ProgressBar
          active={runModeView.progress.active}
          done={runModeView.progress.done}
          total={runModeView.progress.total}
        />
      </div>
    </section>
  );
}
