"use client";

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
  onClose,
  onRefresh,
  onLoadMore,
  onChoose,
  title = "Recent runs",
  emptyMessage = "No saved simulation runs yet.",
}: {
  runs: SavedSimulationRunListItem[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  onClose: () => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onChoose: (run: SavedSimulationRunListItem) => void;
  title?: string;
  emptyMessage?: string;
}) {
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
              className="sim-edit-chip min-h-[32px] px-3 py-1 text-xs font-bold"
            >
              Refresh
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
          {loading ? (
            <p className="px-1 py-4 text-xs opacity-60">Loading recent runs…</p>
          ) : error ? (
            <p className="px-1 py-4 text-xs" style={{ color: "#f38ba8" }}>
              {error}
            </p>
          ) : runs.length === 0 ? (
            <p className="px-1 py-4 text-xs opacity-60">
              {emptyMessage}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {runs.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => onChoose(run)}
                  className="sim-tool-panel p-3 text-left"
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
          )}
        </div>
      </div>
    </div>
  );
}
