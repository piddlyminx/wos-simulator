"use client";

import OptimizeRatioScatterChart from "@/components/OptimizeRatioScatterChart";
import SimulateOutcomeChart from "@/components/SimulateOutcomeChart";
import TernaryPanel, { WinrateLegend } from "@/components/TernaryPanel";
import {
  BattleTraceDetails,
  ResultCard,
  SkillUseTable,
} from "@/components/simulate/SharedSimComponents";
import {
  formatComposition,
  formatCounts,
  type OptimizeRatioPoint,
  type OptimizeRatioResult,
  type OptimizeSide,
} from "@/lib/optimize-ratio";
import type {
  OptimizeRatioApiResponse,
  SimulateApiResponse,
  SimulateApiResult,
  SimulateTrace,
  SurfaceSweepApiResponse,
} from "@/lib/simulate-run";
import {
  SURFACE_RATIO_TOTAL,
  type SurfaceSweepResult,
} from "@/lib/simulator/surface";
import { surfacePointLabel } from "@/lib/simulator/surface-view";
import {
  compactNumber,
  formatCompactCounts,
  formatCompactRatio,
  optimizeRowKey,
} from "@/lib/simulate/form-state";

export interface SummaryCard {
  label: string;
  value: string;
}

export function SimulateResultsPanel({
  attackerTotalTroops,
  battleTrace,
  defenderTotalTroops,
  onShowBattleExample,
  result,
  sidesSwapped,
  summaryCards,
  traceError,
  traceLoadingSeed,
  visible,
}: {
  attackerTotalTroops: number;
  battleTrace: SimulateTrace | null;
  defenderTotalTroops: number;
  onShowBattleExample: (seed: string | number) => void;
  result: SimulateApiResult | SimulateApiResponse;
  sidesSwapped: boolean;
  summaryCards: SummaryCard[] | null;
  traceError: string | null;
  traceLoadingSeed: string | number | null;
  visible: boolean;
}) {
  return (
    <div
      className={`${
        visible ? "block" : "hidden"
      } sim-tool-panel sim-panel-results-shell mb-6 p-3 sm:p-4`}
      data-tour="simulate-results"
    >
      <h3 className="mb-3 text-sm font-bold opacity-70">
        Results ({result.replicates} replicates)
      </h3>
      <div
        className="mb-4 grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4"
        data-tour="simulate-results-summary"
      >
        {summaryCards?.map((card) => (
          <div
            key={card.label}
            className="sim-tool-panel flex min-w-0 flex-col gap-0.5 px-3 py-2"
          >
            <span className="text-[10px] sm:text-xs uppercase tracking-wider opacity-50">
              {card.label}
            </span>
            <span
              className="break-words font-mono text-sm font-bold leading-snug"
              style={{ color: "var(--sim-blue)" }}
            >
              {card.value}
            </span>
          </div>
        ))}
      </div>
      <h4 className="mb-2 text-xs font-bold opacity-70">
        Survivor distribution
      </h4>
      <p className="text-xs opacity-60 mb-2">
        X-axis: attacker survivors minus defender survivors. Draws can appear on
        either side of zero. Open a point for its outcome breakdown and an exact
        example.
      </p>
      <div data-tour="simulate-outcome-chart">
        <SimulateOutcomeChart
          outcomes={result.outcomes}
          outcomeRuns={result.outcome_runs}
          attackerArmy={attackerTotalTroops}
          defenderArmy={defenderTotalTroops}
          attackerOnLeft={!sidesSwapped}
          onShowExample={onShowBattleExample}
        />
      </div>
      <div className="mt-2 min-h-5 text-xs">
        {traceLoadingSeed !== null && (
          <span className="font-mono opacity-70">
            Loading full trace for seed {traceLoadingSeed}...
          </span>
        )}
        {traceError && <span style={{ color: "#f38ba8" }}>{traceError}</span>}
      </div>
      <div data-tour="simulate-trace">
        {battleTrace ? (
          <BattleTraceDetails trace={battleTrace} attackerOnLeft={!sidesSwapped} />
        ) : (
          <div className="sim-tool-panel p-3 text-xs opacity-60">
            Pick Show example on the distribution chart to load a seed-level
            battle trace here.
          </div>
        )}
      </div>
      <div
        className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4"
        data-tour="simulate-skill-tables"
      >
        <SkillUseTable
          title="Attacker skills"
          entries={result.per_side_skills.attacker}
        />
        <SkillUseTable
          title="Defender skills"
          entries={result.per_side_skills.defender}
        />
      </div>
    </div>
  );
}

export function OptimizeResultsPanel({
  onApplySelectedRatio,
  onSelectRow,
  optimizeSide,
  result,
  selectedRow,
  visible,
}: {
  onApplySelectedRatio: () => void;
  onSelectRow: (key: string) => void;
  optimizeSide: OptimizeSide;
  result: OptimizeRatioResult | OptimizeRatioApiResponse;
  selectedRow: OptimizeRatioPoint | null;
  visible: boolean;
}) {
  const optimizedSide = (result.optimized_side ?? optimizeSide) === "defender"
    ? "defender"
    : "attacker";

  return (
    <div
      className={`${
        visible ? "block" : "hidden"
      } sim-tool-panel sim-panel-results-shell mb-6 p-3 sm:p-4`}
      data-testid="optimize-results"
      data-tour="optimize-results"
    >
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className="text-sm font-bold opacity-70">Ratio Optimisation</h3>
          <p className="mt-1 text-xs opacity-60">
            Optimised {optimizedSide} ratio with {result.search_mode ?? "grid"}{" "}
            search. Ran {result.projected_battles.toLocaleString()} battle
            simulations across {result.compositions_tested.toLocaleString()}{" "}
            candidates, with {result.replicates_per_ratio.toLocaleString()}{" "}
            replicates for each finalist. Infantry was constrained to{" "}
            {result.infantry_min_pct}%–{result.infantry_max_pct}%. Ranked by{" "}
            {result.rank_by === "margin" ? "margin" : "win rate"} first.
          </p>
        </div>
        <button
          type="button"
          onClick={onApplySelectedRatio}
          className="sim-edit-chip min-h-[34px] px-3 py-2 text-xs font-bold"
          style={{ color: "var(--sim-blue)" }}
          data-tour="optimize-apply"
        >
          Use selected {optimizedSide} ratio
        </button>
      </div>

      <div
        className="mb-4 grid grid-cols-2 gap-2 xl:grid-cols-5"
        data-tour="optimize-results-summary"
      >
        <ResultCard
          label="Win rate"
          value={`${result.best.win_rate_pct.toFixed(1)}%`}
        />
        <ResultCard label="Best mix" value={formatComposition(result.best)} />
        <ResultCard label="Best counts" value={formatCounts(result.best)} />
        <ResultCard
          label="Avg optimized margin"
          value={compactNumber(result.best.avg_margin)}
        />
        <ResultCard
          label="Infantry band"
          value={`${result.infantry_min_pct}%–${result.infantry_max_pct}%`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <div className="sim-tool-panel p-3" data-tour="optimize-scatter">
          <h4 className="mb-2 text-xs font-bold opacity-70">
            3D win-rate samples
          </h4>
          <OptimizeRatioScatterChart points={result.points} />
        </div>

        <div className="sim-tool-panel p-3" data-tour="optimize-table">
          <h4 className="mb-2 text-xs font-bold opacity-70">Top 10 ratios</h4>
          <div className="overflow-x-auto sm:overflow-visible">
            <table className="w-full table-auto text-[11px] font-mono sm:text-xs">
              <thead>
                <tr
                  className="text-left uppercase tracking-wider opacity-50"
                  style={{ borderBottom: "1px solid var(--sim-line)" }}
                >
                  <th className="w-8 pb-1 pr-1">#</th>
                  <th className="pb-1 pr-1 text-right">Winrate</th>
                  <th className="pb-1 pr-1 text-right">Margin</th>
                  <th className="pb-1 pr-1 text-right">Ratio</th>
                  <th className="pb-1 text-right">Troops</th>
                </tr>
              </thead>
              <tbody>
                {result.top_results.map((row) => {
                  const selected =
                    selectedRow != null &&
                    optimizeRowKey(selectedRow) === optimizeRowKey(row);
                  return (
                    <tr
                      key={`${row.rank}-${row.infantry_count}-${row.lancer_count}-${row.marksman_count}`}
                      tabIndex={0}
                      aria-selected={selected}
                      className="cursor-pointer outline-none transition-colors hover:bg-white/[0.06] focus-visible:bg-white/[0.08]"
                      onClick={() => onSelectRow(optimizeRowKey(row))}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onSelectRow(optimizeRowKey(row));
                        }
                      }}
                      style={{
                        borderTop: "1px solid rgba(255,255,255,0.04)",
                        backgroundColor: selected
                          ? "rgba(137, 180, 250, 0.14)"
                          : row.is_best
                            ? "rgba(166, 227, 161, 0.08)"
                            : "transparent",
                      }}
                    >
                      <td className="py-1.5 pr-1 font-bold whitespace-nowrap">
                        {row.rank}
                      </td>
                      <td className="py-1.5 pr-1 text-right whitespace-nowrap">
                        {row.win_rate_pct.toFixed(1)}%
                      </td>
                      <td className="py-1.5 pr-1 text-right whitespace-nowrap">
                        {compactNumber(row.avg_margin)}
                      </td>
                      <td className="py-1.5 pr-1 text-right whitespace-nowrap">
                        {formatCompactRatio(row)}
                      </td>
                      <td className="py-1.5 text-right whitespace-nowrap">
                        {formatCompactCounts(row)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SurfaceResultsPanel({
  activeAttIdx,
  activeDefIdx,
  attackerTotalTroops,
  defenderTotalTroops,
  onAttackerHover,
  onAttackerSelect,
  onDefenderHover,
  onDefenderSelect,
  pinnedAttIdx,
  pinnedDefIdx,
  result,
  surfaceAttValues,
  surfaceDefValues,
  visible,
}: {
  activeAttIdx: number | null;
  activeDefIdx: number | null;
  attackerTotalTroops: number;
  defenderTotalTroops: number;
  onAttackerHover: (index: number | null) => void;
  onAttackerSelect: (index: number) => void;
  onDefenderHover: (index: number | null) => void;
  onDefenderSelect: (index: number) => void;
  pinnedAttIdx: number | null;
  pinnedDefIdx: number | null;
  result: SurfaceSweepResult | SurfaceSweepApiResponse;
  surfaceAttValues: number[];
  surfaceDefValues: number[];
  visible: boolean;
}) {
  return (
    <div
      className={`${
        visible ? "block" : "hidden"
      } sim-tool-panel sim-panel-results-shell mb-6 p-3 sm:p-4`}
      data-testid="surface-results"
      data-tour="surface-results"
    >
      <div className="mb-4">
        <h3 className="text-sm font-bold opacity-70">Explore Ratios</h3>
        <p className="mt-1 text-xs opacity-60">
          Attacker compositions sum to {attackerTotalTroops.toLocaleString()}{" "}
          troops and defender compositions sum to{" "}
          {defenderTotalTroops.toLocaleString()} troops. Each point keeps the
          configured troop tiers for that side.
        </p>
      </div>
      <div
        className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-center sm:gap-6"
        data-tour="surface-panels"
      >
        <TernaryPanel
          points={result.points}
          total={SURFACE_RATIO_TOTAL}
          values={surfaceAttValues}
          selectedIdx={pinnedAttIdx}
          title={
            activeDefIdx !== null
              ? "Attackers vs selected defender"
              : "Attackers - mean vs all defenders"
          }
          subtitle={
            activeDefIdx !== null
              ? `Each point shows the matchup outcome against defender ${surfacePointLabel(result.points[activeDefIdx], SURFACE_RATIO_TOTAL)}.`
              : "Each point shows the average matchup outcome across all defender compositions."
          }
          showLegend={false}
          onHover={onAttackerHover}
          onClick={onAttackerSelect}
        />
        <TernaryPanel
          points={result.points}
          total={SURFACE_RATIO_TOTAL}
          values={surfaceDefValues}
          selectedIdx={pinnedDefIdx}
          title={
            activeAttIdx !== null
              ? "Defenders vs selected attacker"
              : "Defenders - mean matchup outcome"
          }
          subtitle={
            activeAttIdx !== null
              ? `Each point shows the matchup outcome for selected attacker ${surfacePointLabel(result.points[activeAttIdx], SURFACE_RATIO_TOTAL)}.`
              : "Each point shows the average matchup outcome across all attacker compositions."
          }
          showLegend={false}
          onHover={onDefenderHover}
          onClick={onDefenderSelect}
        />
      </div>
      <div className="mt-3">
        <WinrateLegend />
      </div>
      <p className="mt-3 text-center text-[10px] opacity-50">
        Blue is defender-favored, white is even, and red is attacker-favored.
        Hover a point to show that composition matchup profile on the other
        triangle; click to pin.
      </p>
    </div>
  );
}
