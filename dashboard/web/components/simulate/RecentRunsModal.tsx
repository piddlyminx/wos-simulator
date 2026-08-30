"use client";

import { useState } from "react";

import type {
  SavedSimulationKind,
  SavedSimulationRunListItem,
} from "@/lib/simulate-run";

export const SAVED_RUN_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "medium",
  timeZone: "UTC",
  hour12: false,
});

export type SavedRunListScope = "mine" | "starred" | "all";

const SAVED_RUN_SCOPE_LABELS: Record<SavedRunListScope, string> = {
  mine: "My runs",
  starred: "Starred",
  all: "All runs",
};

export function savedRunKindLabel(kind: SavedSimulationKind): string {
  if (kind === "simulate") return "Simulation";
  if (kind === "optimize_ratio") return "Ratio search";
  if (kind === "ratio_explorer") return "Explore ratios";
  if (kind === "bear_simulate") return "Bear sim";
  if (kind === "bear_optimize_ratio") return "Bear ratio search";
  return "Tournament";
}

export function formatSavedRunTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return `${SAVED_RUN_DATE_FORMATTER.format(date)} UTC`;
}

export function RecentRunsModal({
  runs,
  loading,
  loadingMore,
  hasMore,
  error,
  scope,
  contentScope,
  onClose,
  onRefresh,
  onLoadMore,
  onChoose,
  onScopeChange,
  title = "Recent runs",
  emptyMessage = "No saved simulation runs yet.",
}: {
  runs: SavedSimulationRunListItem[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  scope: SavedRunListScope;
  contentScope: SavedRunListScope;
  onClose: () => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onChoose: (run: SavedSimulationRunListItem) => void;
  onScopeChange: (scope: SavedRunListScope) => void;
  title?: string;
  emptyMessage?: string;
}) {
  const [busyRunId, setBusyRunId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const changingScope = contentScope !== scope;

  async function setStarred(run: SavedSimulationRunListItem): Promise<void> {
    setBusyRunId(run.id);
    setActionError(null);
    try {
      const response = await fetch(
        `/api/simulate/runs/${encodeURIComponent(run.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kept: !run.kept }),
        },
      );
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || `Run update failed with ${response.status}`);
      }
      await onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to update run");
    } finally {
      setBusyRunId(null);
    }
  }

  return (
    <div
      className="sim-modal-scope fixed inset-0 z-50 flex items-end justify-center px-3 py-4 sm:items-center"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.55)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="recent-runs-modal-title"
      onClick={onClose}
      data-testid="recent-runs-modal"
    >
      <div
        className="sim-modal max-h-[85vh] w-full max-w-lg overflow-hidden shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sim-modal-header flex items-center justify-between gap-3 border-b border-[var(--sim-line)] px-4 py-3">
          <h3 id="recent-runs-modal-title" className="sim-modal-title">
            {title}
          </h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="sim-edit-chip min-h-[32px] px-3 py-1 text-xs font-bold"
              style={{ opacity: loading ? 0.6 : 1 }}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="sim-edit-chip min-h-[32px] px-2 py-1 text-sm font-bold leading-none"
              aria-label={`Close ${title.toLowerCase()}`}
            >
              ×
            </button>
          </div>
        </div>

        <div className="max-h-[65vh] overflow-y-auto p-3">
          <div className="sim-segmented mb-3 grid grid-cols-3" role="group" aria-label="Saved run list">
            {(Object.keys(SAVED_RUN_SCOPE_LABELS) as SavedRunListScope[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setActionError(null);
                  onScopeChange(option);
                }}
                aria-pressed={scope === option}
                data-active={scope === option}
              >
                {SAVED_RUN_SCOPE_LABELS[option]}
              </button>
            ))}
          </div>
          {actionError ? (
            <p
              className="px-1 pb-2 text-xs"
              style={{ color: "#f38ba8" }}
              aria-live="polite"
            >
              {actionError}
            </p>
          ) : null}
          <div className="relative" data-testid="recent-runs-content">
            <div
              className={changingScope ? "invisible pointer-events-none" : undefined}
              aria-hidden={changingScope}
            >
              {error ? (
                <p className="px-1 py-4 text-xs" style={{ color: "#f38ba8" }}>
                  {error}
                </p>
              ) : null}
              {loading && runs.length === 0 ? (
                <p className="px-1 py-4 text-xs opacity-60">Loading recent runs…</p>
              ) : !error && runs.length === 0 ? (
                <p className="px-1 py-4 text-xs opacity-60">
                  {scope === "mine"
                    ? "No runs saved by this browser yet."
                    : scope === "starred"
                      ? "No starred runs saved by this browser yet."
                      : emptyMessage}
                </p>
              ) : runs.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {runs.map((run) => (
                    <div
                      key={run.id}
                      className="sim-tool-panel flex items-center gap-2 p-2"
                    >
                      <button
                        type="button"
                        onClick={() => onChoose(run)}
                        className="min-w-0 flex-1 p-1 text-left"
                      >
                        <span className="block truncate text-xs font-bold">
                          {run.title}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] opacity-55">
                          <span>{savedRunKindLabel(run.kind)}</span>
                          <span>{formatSavedRunTimestamp(run.created_at)}</span>
                          <span className="truncate">{run.id}</span>
                        </span>
                      </button>
                      {scope !== "all" ? (
                        <button
                          type="button"
                          onClick={() => void setStarred(run)}
                          disabled={busyRunId === run.id}
                          aria-label={`${run.kept ? "Unstar" : "Star"} saved run ${run.id}`}
                          aria-pressed={run.kept}
                          title={run.kept ? "Unstar run" : "Star run"}
                          className="sim-edit-chip flex min-h-[32px] min-w-[32px] shrink-0 items-center justify-center p-1.5"
                          style={{
                            color: run.kept ? "#f9e2af" : undefined,
                            opacity: busyRunId === run.id ? 0.6 : 1,
                          }}
                        >
                          <svg
                            aria-hidden="true"
                            viewBox="0 0 24 24"
                            className="h-4 w-4"
                            fill={run.kept ? "currentColor" : "none"}
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinejoin="round"
                          >
                            <path d="m12 2.8 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3-5.6-3-5.6 3 1.1-6.3-4.6-4.5 6.3-.9L12 2.8Z" />
                          </svg>
                        </button>
                      ) : null}
                    </div>
                  ))}
                  {hasMore && (
                    <button
                      type="button"
                      onClick={onLoadMore}
                      disabled={loadingMore}
                      className="sim-edit-chip min-h-[36px] px-3 py-2 text-xs font-bold"
                      style={{ opacity: loadingMore ? 0.6 : 1 }}
                    >
                      {loadingMore ? "Loading more…" : "Load more"}
                    </button>
                  )}
                </div>
              ) : null}
            </div>
            {changingScope ? (
              <p
                className="absolute inset-0 flex items-start justify-center px-1 py-4 text-xs opacity-60"
                aria-live="polite"
              >
                {error ?? `Loading ${SAVED_RUN_SCOPE_LABELS[scope].toLowerCase()}…`}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
