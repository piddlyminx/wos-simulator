"use client";

import { useEffect, useMemo, useRef, useState, type FocusEventHandler } from "react";
import OptimizeRatioScatterChart from "@/components/OptimizeRatioScatterChart";
import SimulateOutcomeChart from "@/components/SimulateOutcomeChart";
import type { OcrResult, OcrSideData, UploadActiveModifiers } from "@/components/UploadReportModal";
import type { TroopCategory } from "@/lib/heroes-catalogue";
import {
  DEFAULT_INFANTRY_MAX_PCT,
  DEFAULT_INFANTRY_MIN_PCT,
  DEFAULT_OPTIMIZE_REPLICATES,
  DEFAULT_OPTIMIZE_SEARCH_MODE,
  DEFAULT_TOP_RESULTS,
  estimateAdaptiveBattleCount,
  estimateAdaptiveCompositionCount,
  estimateCompositionCount,
  formatComposition,
  formatCounts,
  MAX_OPTIMIZE_BATTLES,
  MAX_OPTIMIZE_COMPOSITIONS,
  OptimizeRatioPoint,
  OptimizeSearchMode,
  recommendedOptimizeStep,
  resolveInfantryBounds,
  totalTroopsForCounts,
} from "@/lib/optimize-ratio";
import type {
  BearOptimizeRatioPoint,
  BearOptimizeRatioRequestPayload,
  BearOptimizeRatioResult,
  BearSimRequestPayload,
  BearSimResult,
  SimulateTrace,
} from "@/lib/simulate-run";
import {
  cleanStatPresetName,
  MAX_STAT_PRESETS,
  normalizeStatPresetStats,
  sortPlayerStatPresets,
  type PlayerStatPreset,
} from "@/lib/stat-presets";
import {
  runWorkerBearOptimizeRatio,
  runWorkerBearSimulation,
  runWorkerBearSimulationTrace,
} from "@/lib/simulator/worker-client";
import {
  BattleTraceDetails,
  compactNumber,
  defaultSide,
  heroAdjustedStats,
  loadLocalStatPresets,
  mergeSideFromOcr,
  newStatPresetId,
  ProgressBar,
  ResultCard,
  saveLocalStatPresets,
  SidePanel,
  sideWithPresetStats,
  SkillUseTable,
  toApiPayload,
  type SideState,
} from "@/app/simulate/SimulateClient";

const CATEGORIES: TroopCategory[] = ["infantry", "lancer", "marksman"];
const RALLY_MODE = true;

const selectFocusedInputText: FocusEventHandler<HTMLDivElement> = (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (!["number", "text", "search", "tel", "url", "email"].includes(target.type)) return;
  requestAnimationFrame(() => target.select());
};

function defaultActiveModifiers(): UploadActiveModifiers {
  return {
    statModifiers: {
      attack: 0,
      defense: 0,
      lethality: 0,
      health: 0,
      enemy_attack: 0,
      enemy_defense: 0,
    },
    petModifiers: {
      attack: 0,
      defense: 0,
      lethality: 0,
      health: 0,
      enemy_defense: 0,
      enemy_lethality: 0,
      enemy_health: 0,
    },
  };
}

function activeModifiersFromSide(side: SideState): UploadActiveModifiers {
  return {
    statModifiers: { ...side.statModifiers },
    petModifiers: { ...side.petModifiers },
  };
}

function skill4LevelsFromSide(side: SideState): Record<TroopCategory, number> {
  return {
    infantry: side.heroes.infantry.skills[3],
    lancer: side.heroes.lancer.skills[3],
    marksman: side.heroes.marksman.skills[3],
  };
}

function heroSelectionFromSide(side: SideState): Record<TroopCategory, string | null> {
  return {
    infantry: side.heroes.infantry.name,
    lancer: side.heroes.lancer.name,
    marksman: side.heroes.marksman.name,
  };
}

function bearRequest(player: SideState, replicates: number, profileName: string | null): BearSimRequestPayload {
  return {
    player: toApiPayload(player, defaultSide(), replicates, RALLY_MODE, {
      attacker: profileName,
      defender: null,
    }).attacker,
    replicates,
  };
}

function bearOptimizeRequest(
  player: SideState,
  profileName: string | null,
  args: {
    gridStep: number;
    searchReplicates: number;
    infantryMinPct: number;
    infantryMaxPct: number;
    searchMode: OptimizeSearchMode;
  },
): BearOptimizeRatioRequestPayload {
  return {
    ...bearRequest(player, 1, profileName),
    grid_step: args.gridStep,
    search_replicates: args.searchReplicates,
    infantry_min_pct: args.infantryMinPct,
    infantry_max_pct: args.infantryMaxPct,
    top_n: DEFAULT_TOP_RESULTS,
    search_mode: args.searchMode,
  };
}

function bearPointForStandardChart(point: BearOptimizeRatioPoint): OptimizeRatioPoint {
  return {
    infantry_count: point.infantry_count,
    lancer_count: point.lancer_count,
    marksman_count: point.marksman_count,
    infantry_pct: point.infantry_pct,
    lancer_pct: point.lancer_pct,
    marksman_pct: point.marksman_pct,
    win_rate: point.avg_score,
    win_rate_pct: point.avg_score,
    avg_margin: point.avg_score,
    margin_std: point.score_std,
    avg_attacker_left: point.avg_score,
    avg_defender_left: 0,
    rank: point.rank,
    is_best: point.is_best,
    search_phase: point.search_phase,
    phase_replicates: point.phase_replicates,
  };
}

export default function BearSimClient() {
  const [player, setPlayer] = useState<SideState>(() => defaultSide());
  const [replicates, setReplicates] = useState(1000);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BearSimResult | null>(null);
  const [battleTrace, setBattleTrace] = useState<SimulateTrace | null>(null);
  const [traceLoadingSeed, setTraceLoadingSeed] = useState<string | number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadWarnings, setUploadWarnings] = useState<string[]>([]);

  const [statPresets, setStatPresets] = useState<PlayerStatPreset[]>([]);
  const [loadedPresetId, setLoadedPresetId] = useState<string | null>(null);
  const [loadedPresetName, setLoadedPresetName] = useState<string | null>(null);
  const [presetOpen, setPresetOpen] = useState(false);
  const [presetDraftName, setPresetDraftName] = useState("Bear profile");
  const [presetStatus, setPresetStatus] = useState<{ kind: "ok" | "error"; message: string } | null>(null);

  const [optimizeLoading, setOptimizeLoading] = useState(false);
  const [optimizeError, setOptimizeError] = useState<string | null>(null);
  const [optimizeResult, setOptimizeResult] = useState<BearOptimizeRatioResult | null>(null);
  const [selectedOptimizeKey, setSelectedOptimizeKey] = useState<string | null>(null);
  const [optimizePanelOpen, setOptimizePanelOpen] = useState(false);
  const [optimizeReplicates, setOptimizeReplicates] = useState(DEFAULT_OPTIMIZE_REPLICATES);
  const [optimizeStepInput, setOptimizeStepInput] = useState("");
  const [optimizeInfantryMinPct, setOptimizeInfantryMinPct] = useState(DEFAULT_INFANTRY_MIN_PCT);
  const [optimizeInfantryMaxPct, setOptimizeInfantryMaxPct] = useState(DEFAULT_INFANTRY_MAX_PCT);
  const [optimizeSearchMode, setOptimizeSearchMode] = useState<OptimizeSearchMode>(DEFAULT_OPTIMIZE_SEARCH_MODE);
  const [optimizeProgress, setOptimizeProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    try {
      setStatPresets(loadLocalStatPresets());
    } catch (err) {
      setPresetStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to load presets",
      });
    }
  }, []);

  const totalTroops = useMemo(() => totalTroopsForCounts(player.troops), [player.troops]);
  const resolvedOptimizeStep = useMemo(() => {
    const parsed = parseInt(optimizeStepInput, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : recommendedOptimizeStep(totalTroops);
  }, [optimizeStepInput, totalTroops]);
  const resolvedInfantryBounds = useMemo(
    () => resolveInfantryBounds(optimizeInfantryMinPct, optimizeInfantryMaxPct),
    [optimizeInfantryMaxPct, optimizeInfantryMinPct],
  );
  const estimatedOptimizeCompositions = useMemo(
    () =>
      optimizeSearchMode === "adaptive"
        ? estimateAdaptiveCompositionCount(resolvedInfantryBounds.minPct, resolvedInfantryBounds.maxPct)
        : estimateCompositionCount(totalTroops, resolvedOptimizeStep, resolvedInfantryBounds.minPct, resolvedInfantryBounds.maxPct),
    [optimizeSearchMode, resolvedInfantryBounds, resolvedOptimizeStep, totalTroops],
  );
  const estimatedOptimizeBattles = useMemo(
    () =>
      optimizeSearchMode === "adaptive"
        ? estimateAdaptiveBattleCount(resolvedInfantryBounds.minPct, resolvedInfantryBounds.maxPct)
        : estimatedOptimizeCompositions * optimizeReplicates,
    [estimatedOptimizeCompositions, optimizeReplicates, optimizeSearchMode, resolvedInfantryBounds],
  );
  const optimizeBudgetTooLarge =
    estimatedOptimizeCompositions > MAX_OPTIMIZE_COMPOSITIONS ||
    estimatedOptimizeBattles > MAX_OPTIMIZE_BATTLES;

  const selectedOptimizeRow =
    optimizeResult && selectedOptimizeKey
      ? optimizeResult.top_results.find((row) => optimizeRowKey(row) === selectedOptimizeKey) ?? optimizeResult.best
      : optimizeResult?.best ?? null;

  function openPresetModal() {
    const loaded = statPresets.find((preset) => preset.id === loadedPresetId);
    setPresetDraftName(loaded?.name ?? loadedPresetName ?? "Bear profile");
    setPresetStatus(null);
    setPresetOpen(true);
  }

  function createStatPresetFromPlayer() {
    try {
      if (statPresets.length >= MAX_STAT_PRESETS) throw new Error(`Preset limit reached (${MAX_STAT_PRESETS})`);
      const timestamp = new Date().toISOString();
      const preset: PlayerStatPreset = {
        id: newStatPresetId(),
        name: cleanStatPresetName(presetDraftName) || `Preset ${statPresets.length + 1}`,
        created_at: timestamp,
        updated_at: timestamp,
        stats: normalizeStatPresetStats(heroAdjustedStats(player, "subtract")),
      };
      const next = sortPlayerStatPresets([preset, ...statPresets.filter((row) => row.id !== preset.id)]);
      saveLocalStatPresets(next);
      setStatPresets(next);
      setLoadedPresetId(preset.id);
      setLoadedPresetName(preset.name);
      setPresetDraftName(preset.name);
      setPresetStatus({ kind: "ok", message: `Created ${preset.name}.` });
    } catch (err) {
      setPresetStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to save preset",
      });
    }
  }

  function chooseStatPreset(id: string) {
    if (!id) {
      setLoadedPresetId(null);
      setLoadedPresetName(null);
      setPresetStatus({ kind: "ok", message: "No profile loaded." });
      return;
    }
    const preset = statPresets.find((row) => row.id === id);
    if (!preset) {
      setPresetStatus({ kind: "error", message: "Choose a profile to load." });
      return;
    }
    setPlayer((prev) => sideWithPresetStats(prev, preset));
    setLoadedPresetId(preset.id);
    setLoadedPresetName(preset.name);
    setPresetDraftName(preset.name);
    setPresetStatus({ kind: "ok", message: `Loaded ${preset.name}.` });
  }

  async function runBear() {
    setLoading(true);
    setError(null);
    setTraceError(null);
    setBattleTrace(null);
    setResult(null);
    setOptimizeError(null);
    setOptimizeResult(null);
    setProgress({ done: 0, total: replicates });
    try {
      const payload = bearRequest(player, replicates, loadedPresetName);
      const job = runWorkerBearSimulation(payload, (done, total) => setProgress({ done, total }));
      setResult(await job.promise);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function showBearExample(seed: string | number) {
    setTraceLoadingSeed(seed);
    setTraceError(null);
    try {
      const job = runWorkerBearSimulationTrace(bearRequest(player, 1, loadedPresetName), seed, () => undefined);
      setBattleTrace(await job.promise);
    } catch (err) {
      setTraceError(err instanceof Error ? err.message : String(err));
    } finally {
      setTraceLoadingSeed(null);
    }
  }

  async function runOptimize() {
    setOptimizeLoading(true);
    setError(null);
    setTraceError(null);
    setResult(null);
    setBattleTrace(null);
    setOptimizeError(null);
    setOptimizeResult(null);
    setSelectedOptimizeKey(null);
    setOptimizeProgress({ done: 0, total: estimatedOptimizeCompositions });
    try {
      const payload = bearOptimizeRequest(player, loadedPresetName, {
        gridStep: resolvedOptimizeStep,
        searchReplicates: optimizeReplicates,
        infantryMinPct: resolvedInfantryBounds.minPct,
        infantryMaxPct: resolvedInfantryBounds.maxPct,
        searchMode: optimizeSearchMode,
      });
      const job = runWorkerBearOptimizeRatio(payload, (done, total) => setOptimizeProgress({ done, total }));
      setOptimizeResult(await job.promise);
    } catch (err) {
      setOptimizeError(err instanceof Error ? err.message : String(err));
    } finally {
      setOptimizeLoading(false);
    }
  }

  function applySelectedOptimizeRatio() {
    if (!selectedOptimizeRow) return;
    setPlayer((prev) => ({
      ...prev,
      troops: {
        infantry: selectedOptimizeRow.infantry_count,
        lancer: selectedOptimizeRow.lancer_count,
        marksman: selectedOptimizeRow.marksman_count,
      },
    }));
  }

  const summaryCards = result
    ? [
        { label: "Mean score", value: compactNumber(result.summary.mean) },
        { label: "Std dev", value: compactNumber(result.summary.std) },
        { label: "Best score", value: compactNumber(result.summary.best.value) },
        { label: "Worst score", value: compactNumber(result.summary.worst.value) },
        { label: "Avg activations", value: result.summary.avg_skill_activations.toFixed(1) },
        { label: "Avg skill damage", value: compactNumber(result.summary.avg_skill_damage) },
      ]
    : [];

  return (
    <div onFocusCapture={selectFocusedInputText}>
      <div className="mb-4 flex flex-col gap-3 sm:mb-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-bold" style={{ color: "var(--sidebar-active)" }}>
            Bear Sim
          </h2>
          <p className="max-w-2xl text-xs opacity-60">
            Enter one rally army and score uncapped damage against the fixed 5k infantry bear over 10 rounds.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setUploadOpen(true)}
          className="rounded px-3 py-2 text-xs font-bold min-h-[44px]"
          style={{ border: "1px solid var(--border-color)", backgroundColor: "var(--sidebar-bg)", color: "var(--sidebar-active)" }}
        >
          Upload report
        </button>
      </div>

      {uploadWarnings.length > 0 && (
        <div className="mb-4 rounded px-3 py-2 text-xs font-mono" style={{ border: "1px solid var(--border-color)", backgroundColor: "var(--sidebar-bg)", color: "#f9e2af" }}>
          OCR warnings:
          <ul className="mt-1 list-inside list-disc">
            {uploadWarnings.map((warning, index) => <li key={index}>{warning}</li>)}
          </ul>
        </div>
      )}

      <div className="mb-4 max-w-5xl sm:mb-6">
        <SidePanel
          title="Player Army"
          which="attacker"
          state={player}
          opponent={defaultSide()}
          setState={setPlayer}
          rallyMode={RALLY_MODE}
          syncStatsOnHeroChange={true}
          onStatSync={() => undefined}
          loadedPresetName={loadedPresetName}
          onOpenPreset={openPresetModal}
        />
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <div className="rounded p-3" style={{ border: "1px solid var(--border-color)", backgroundColor: "var(--sidebar-bg)" }}>
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wider opacity-60">Run bear sim</h3>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wider opacity-60">Replicates</span>
              <input
                type="number"
                min={1}
                max={5000}
                value={replicates}
                onChange={(event) => setReplicates(Math.max(1, Math.min(5000, parseInt(event.target.value || "1", 10))))}
                className="min-h-[44px] rounded px-3 py-2 text-right font-mono text-sm tabular-nums"
                style={{ backgroundColor: "var(--sidebar-bg)", border: "1px solid var(--border-color)", color: "var(--main-text)" }}
              />
            </label>
            <button
              type="button"
              onClick={runBear}
              disabled={loading}
              className="min-h-[44px] rounded px-4 py-2 text-sm font-bold"
              style={{ backgroundColor: "var(--sidebar-active)", color: "#1e1e2e", opacity: loading ? 0.5 : 1 }}
            >
              {loading ? "Simulating..." : "Bear Sim"}
            </button>
          </div>
          {error && <p className="mt-2 text-xs" style={{ color: "#f38ba8" }}>{error}</p>}
          <ProgressBar active={loading} done={progress?.done ?? 0} total={progress?.total ?? replicates} />
        </div>

        <div className="rounded p-3" style={{ border: "1px solid var(--border-color)", backgroundColor: "var(--sidebar-bg)" }}>
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wider opacity-60">Optimise ratio</h3>
          <p className="mb-3 text-xs opacity-60">
            Keeps total troops ({totalTroops.toLocaleString()}), tiers, heroes, stats, and buffs fixed; only the troop mix changes.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <button
              type="button"
              onClick={runOptimize}
              disabled={optimizeLoading || optimizeBudgetTooLarge || totalTroops <= 0 || !resolvedInfantryBounds.isValid}
              className="min-h-[42px] rounded px-4 py-2 text-sm font-bold"
              style={{
                backgroundColor: optimizeBudgetTooLarge || !resolvedInfantryBounds.isValid ? "var(--sidebar-bg)" : "#a6e3a1",
                border: `1px solid ${optimizeBudgetTooLarge || !resolvedInfantryBounds.isValid ? "var(--border-color)" : "#a6e3a1"}`,
                color: optimizeBudgetTooLarge || !resolvedInfantryBounds.isValid ? "var(--sidebar-text)" : "#11111b",
                opacity: optimizeLoading ? 0.65 : 1,
              }}
            >
              {optimizeLoading ? "Optimising..." : "Optimise ratio"}
            </button>
            <button
              type="button"
              onClick={() => setOptimizePanelOpen((open) => !open)}
              className="min-h-[42px] rounded px-3 py-2 text-xs font-bold"
              style={{ border: "1px solid var(--border-color)", color: "var(--main-text)" }}
            >
              {optimizePanelOpen ? "Hide options" : "Show options"}
            </button>
            <span className="font-mono text-xs opacity-60">
              {estimatedOptimizeCompositions.toLocaleString()} comps · {optimizeSearchMode === "adaptive" ? "30/10/100 reps" : `${optimizeReplicates} reps`} · {estimatedOptimizeBattles.toLocaleString()} battles
            </span>
          </div>
          <ProgressBar active={optimizeLoading} done={optimizeProgress?.done ?? 0} total={optimizeProgress?.total ?? estimatedOptimizeCompositions} />
          {optimizePanelOpen && (
            <div className="mt-3 grid gap-3 rounded border p-3 md:grid-cols-2 2xl:grid-cols-4" style={{ borderColor: "var(--border-color)" }}>
              <SmallNumberInput label="Ratio reps" value={optimizeReplicates} disabled={optimizeSearchMode === "adaptive"} onChange={setOptimizeReplicates} min={1} max={500} />
              <SmallTextInput label="Grid step" value={optimizeStepInput} disabled={optimizeSearchMode === "adaptive"} placeholder={String(recommendedOptimizeStep(totalTroops))} onChange={setOptimizeStepInput} />
              <SmallNumberInput label="Inf min %" value={optimizeInfantryMinPct} onChange={setOptimizeInfantryMinPct} min={0} max={100} />
              <SmallNumberInput label="Inf max %" value={optimizeInfantryMaxPct} onChange={setOptimizeInfantryMaxPct} min={0} max={100} />
              <fieldset className="md:col-span-2 2xl:col-span-4">
                <legend className="mb-1 text-xs uppercase tracking-wider opacity-60">Search mode</legend>
                <div className="grid max-w-xs grid-cols-2 overflow-hidden rounded border border-[var(--border-color)]">
                  {(["adaptive", "grid"] as OptimizeSearchMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setOptimizeSearchMode(mode)}
                      className="px-3 py-2 text-xs font-bold capitalize"
                      style={{ backgroundColor: optimizeSearchMode === mode ? "var(--sidebar-active)" : "transparent", color: optimizeSearchMode === mode ? "#1e1e2e" : "var(--main-text)" }}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>
          )}
          {optimizeError && <p className="mt-2 text-xs" style={{ color: "#f38ba8" }}>{optimizeError}</p>}
        </div>
      </div>

      {presetOpen && (
        <PresetModal
          presets={statPresets}
          activePresetId={loadedPresetId ?? ""}
          draftName={presetDraftName}
          status={presetStatus}
          onDraftName={setPresetDraftName}
          onChoose={chooseStatPreset}
          onCreate={createStatPresetFromPlayer}
          onClose={() => setPresetOpen(false)}
        />
      )}

      <BearUploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onApply={(ocr, side) => {
          const selected = side === "left" ? ocr.attacker : ocr.defender;
          setPlayer((prev) =>
            mergeSideFromOcr(
              prev,
              selected,
              heroSelectionFromSide(prev),
              RALLY_MODE,
              "attacker",
              skill4LevelsFromSide(prev),
              activeModifiersFromSide(prev),
              defaultActiveModifiers(),
            ),
          );
          setUploadWarnings(ocr.warnings ?? []);
        }}
      />

      {result && (
        <div className="mb-6 rounded p-3 sm:p-4" style={{ border: "1px solid var(--border-color)", backgroundColor: "var(--sidebar-bg)" }}>
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wider opacity-60">Results ({result.replicates} replicates)</h3>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-3">
            {summaryCards.map((card) => <ResultCard key={card.label} label={card.label} value={card.value} />)}
          </div>
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wider opacity-60">Score distribution</h4>
          <SimulateOutcomeChart
            outcomes={result.scores}
            outcomeRuns={result.score_runs?.map((run) => ({ outcome: run.score, seed: run.seed }))}
            attackerArmy={Math.max(...result.scores, 1)}
            defenderArmy={Math.max(...result.scores, 1)}
            attackerOnLeft={true}
            onShowExample={showBearExample}
          />
          <div className="mt-2 min-h-5 text-xs">
            {traceLoadingSeed !== null && <span className="font-mono opacity-70">Loading example for seed {traceLoadingSeed}...</span>}
            {traceError && <span style={{ color: "#f38ba8" }}>{traceError}</span>}
          </div>
          {battleTrace && <BattleTraceDetails trace={battleTrace} attackerOnLeft={true} />}
          <div className="mt-4">
            <SkillUseTable title="Player skills" entries={result.skills} />
          </div>
        </div>
      )}

      {optimizeResult && (
        <div className="mb-6 rounded p-3 sm:p-4" style={{ border: "1px solid var(--border-color)", backgroundColor: "var(--sidebar-bg)" }} data-testid="bear-optimize-results">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider opacity-60">Bear Ratio Optimisation</h3>
              <p className="mt-1 text-xs opacity-60">
                Best average score {compactNumber(optimizeResult.best.avg_score)} across {optimizeResult.compositions_tested.toLocaleString()} candidates.
              </p>
            </div>
            <button type="button" onClick={applySelectedOptimizeRatio} className="rounded px-3 py-2 text-xs font-bold" style={{ border: "1px solid var(--sidebar-active)", color: "var(--sidebar-active)" }}>
              Use selected ratio
            </button>
          </div>
          <div className="mb-4 grid grid-cols-2 gap-2 xl:grid-cols-5">
            <ResultCard label="Best score" value={compactNumber(optimizeResult.best.avg_score)} />
            <ResultCard label="Best mix" value={formatComposition(bearPointForStandardChart(optimizeResult.best))} />
            <ResultCard label="Best counts" value={formatCounts(bearPointForStandardChart(optimizeResult.best))} />
            <ResultCard label="Comps tested" value={optimizeResult.compositions_tested.toLocaleString()} />
            <ResultCard label="Infantry band" value={`${optimizeResult.infantry_min_pct}%-${optimizeResult.infantry_max_pct}%`} />
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
            <div className="rounded p-3" style={{ border: "1px solid var(--border-color)", backgroundColor: "var(--main-bg)" }}>
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wider opacity-60">3D score samples</h4>
              <OptimizeRatioScatterChart points={optimizeResult.points.map(bearPointForStandardChart)} />
            </div>
            <TopBearRatiosTable
              rows={optimizeResult.top_results}
              selectedKey={selectedOptimizeRow ? optimizeRowKey(selectedOptimizeRow) : null}
              onSelect={(row) => setSelectedOptimizeKey(optimizeRowKey(row))}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function optimizeRowKey(point: BearOptimizeRatioPoint): string {
  return [point.rank ?? "unranked", point.infantry_count, point.lancer_count, point.marksman_count].join(":");
}

function SmallNumberInput({ label, value, onChange, min, max, disabled = false }: { label: string; value: number; onChange: (value: number) => void; min: number; max: number; disabled?: boolean }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wider opacity-60">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(Math.max(min, Math.min(max, parseFloat(event.target.value || String(min)))))}
        className="min-h-[42px] rounded px-3 py-2 text-right font-mono text-sm tabular-nums"
        style={{ backgroundColor: "var(--sidebar-bg)", border: "1px solid var(--border-color)", color: "var(--main-text)", opacity: disabled ? 0.55 : 1 }}
      />
    </label>
  );
}

function SmallTextInput({ label, value, onChange, placeholder, disabled = false }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; disabled?: boolean }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wider opacity-60">{label}</span>
      <input
        type="number"
        min={1}
        disabled={disabled}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-[42px] rounded px-3 py-2 text-right font-mono text-sm tabular-nums"
        style={{ backgroundColor: "var(--sidebar-bg)", border: "1px solid var(--border-color)", color: "var(--main-text)", opacity: disabled ? 0.55 : 1 }}
      />
    </label>
  );
}

function PresetModal({
  presets,
  activePresetId,
  draftName,
  status,
  onDraftName,
  onChoose,
  onCreate,
  onClose,
}: {
  presets: PlayerStatPreset[];
  activePresetId: string;
  draftName: string;
  status: { kind: "ok" | "error"; message: string } | null;
  onDraftName: (value: string) => void;
  onChoose: (id: string) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-3 py-6" style={{ backgroundColor: "rgba(0,0,0,0.55)" }} role="dialog" aria-modal="true" onClick={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onCreate();
        }}
        className="w-full max-w-md rounded p-4 shadow-xl"
        style={{ border: "1px solid var(--border-color)", backgroundColor: "var(--sidebar-bg)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: "var(--sidebar-active)" }}>Bear profile</h3>
            <p className="mt-1 text-xs opacity-60">Profiles store base player stats only.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded px-2 py-1 text-lg leading-none" style={{ border: "1px solid var(--border-color)" }} aria-label="Close profile modal">x</button>
        </div>
        <label className="mb-3 flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider opacity-50">Loaded profile</span>
          <select value={activePresetId} onChange={(event) => onChoose(event.target.value)} className="min-h-[40px] rounded px-2 py-2 font-mono text-xs" style={{ backgroundColor: "var(--main-bg)", border: "1px solid var(--border-color)", color: "var(--main-text)" }}>
            <option value="">-- None --</option>
            {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
          </select>
        </label>
        <label className="mb-4 flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider opacity-50">New profile name</span>
          <input value={draftName} onChange={(event) => onDraftName(event.target.value)} className="min-h-[40px] rounded px-2 py-2 text-sm" style={{ backgroundColor: "var(--main-bg)", border: "1px solid var(--border-color)", color: "var(--main-text)" }} />
        </label>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="submit" className="min-h-[40px] rounded px-3 py-2 text-xs font-bold" style={{ border: "1px solid var(--sidebar-active)", color: "var(--sidebar-active)" }}>Create from current stats</button>
          <button type="button" onClick={onClose} className="min-h-[40px] rounded px-3 py-2 text-xs font-bold" style={{ border: "1px solid var(--border-color)" }}>Done</button>
        </div>
        {status && <p className="mt-3 text-xs font-mono" style={{ color: status.kind === "error" ? "#f38ba8" : "#a6e3a1" }}>{status.message}</p>}
      </form>
    </div>
  );
}

function TopBearRatiosTable({ rows, selectedKey, onSelect }: { rows: BearOptimizeRatioPoint[]; selectedKey: string | null; onSelect: (row: BearOptimizeRatioPoint) => void }) {
  return (
    <div className="rounded p-3" style={{ border: "1px solid var(--border-color)", backgroundColor: "var(--main-bg)" }}>
      <h4 className="mb-2 text-xs font-bold uppercase tracking-wider opacity-60">Top ratios</h4>
      <table className="w-full text-[11px] font-mono sm:text-xs">
        <thead>
          <tr className="text-left uppercase tracking-wider opacity-50" style={{ borderBottom: "1px solid var(--border-color)" }}>
            <th className="pb-1 pr-1">#</th>
            <th className="pb-1 pr-1 text-right">Score</th>
            <th className="pb-1 pr-1 text-right">Ratio</th>
            <th className="pb-1 text-right">Troops</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const selected = selectedKey === optimizeRowKey(row);
            return (
              <tr key={optimizeRowKey(row)} onClick={() => onSelect(row)} className="cursor-pointer" style={{ borderTop: "1px solid rgba(255,255,255,0.04)", backgroundColor: selected ? "rgba(137,180,250,0.14)" : row.is_best ? "rgba(166,227,161,0.08)" : "transparent" }}>
                <td className="py-1.5 pr-1 font-bold">{row.rank}</td>
                <td className="py-1.5 pr-1 text-right">{compactNumber(row.avg_score)}</td>
                <td className="py-1.5 pr-1 text-right">{formatComposition(bearPointForStandardChart(row))}</td>
                <td className="py-1.5 text-right">{formatCounts(bearPointForStandardChart(row))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BearUploadModal({ open, onClose, onApply }: { open: boolean; onClose: () => void; onApply: (ocr: OcrResult, side: "left" | "right") => void }) {
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [selectedSide, setSelectedSide] = useState<"left" | "right">("left");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  function loadFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setError(`Unsupported file type: ${file.type || "unknown"}`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setImageDataUrl(dataUrl);
      const commaIdx = dataUrl.indexOf(",");
      setImageBase64(commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl);
    };
    reader.readAsDataURL(file);
  }

  async function submit() {
    if (!imageBase64) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ocr-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_base64: imageBase64 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `OCR request failed (${res.status})`);
      onApply(data as OcrResult, selectedSide);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3" style={{ backgroundColor: "rgba(0,0,0,0.6)" }} role="dialog" aria-modal="true" onClick={onClose}>
      <div className="w-full max-w-2xl rounded p-4" style={{ border: "1px solid var(--border-color)", backgroundColor: "var(--sidebar-bg)" }} onClick={(event) => event.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: "var(--sidebar-active)" }}>Upload Bear Stats</h3>
          <button type="button" onClick={onClose} className="rounded px-2 py-1" style={{ border: "1px solid var(--border-color)" }}>Close</button>
        </div>
        <div className="mb-3 grid grid-cols-2 overflow-hidden rounded border border-[var(--border-color)]">
          {(["left", "right"] as const).map((side) => (
            <button key={side} type="button" onClick={() => setSelectedSide(side)} className="px-3 py-2 text-xs font-bold capitalize" style={{ backgroundColor: selectedSide === side ? "var(--sidebar-active)" : "transparent", color: selectedSide === side ? "#1e1e2e" : "var(--main-text)" }}>
              Import {side} stats
            </button>
          ))}
        </div>
        <button type="button" onClick={() => fileInputRef.current?.click()} className="flex min-h-40 w-full flex-col items-center justify-center gap-2 rounded border border-dashed p-4 text-center" style={{ borderColor: "var(--border-color)", backgroundColor: "var(--main-bg)" }}>
          {imageDataUrl ? <img src={imageDataUrl} alt="OCR preview" className="max-h-64 max-w-full object-contain" /> : <span className="text-sm font-bold">Click to choose a Stat Bonuses screenshot</span>}
        </button>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) loadFile(file);
        }} />
        {error && <p className="mt-3 text-xs" style={{ color: "#f38ba8" }}>{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-[40px] rounded px-3 py-2 text-xs font-bold" style={{ border: "1px solid var(--border-color)" }}>Cancel</button>
          <button type="button" onClick={submit} disabled={loading || !imageBase64} className="min-h-[40px] rounded px-3 py-2 text-xs font-bold" style={{ backgroundColor: "var(--sidebar-active)", color: "#1e1e2e", opacity: loading || !imageBase64 ? 0.5 : 1 }}>
            {loading ? "Parsing..." : "Parse and apply"}
          </button>
        </div>
      </div>
    </div>
  );
}
