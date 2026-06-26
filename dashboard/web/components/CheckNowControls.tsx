"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CheckNowStatus } from "@/lib/check-now";
import { formatDashboardDateTime } from "@/lib/date-format";

const POLL_INTERVAL_MS = 3000;

function formatDuration(durationMs: number | undefined): string {
  if (!durationMs || durationMs < 1000) return "under 1s";
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function filterLabel(matching: string[] | undefined): string {
  if (!matching || matching.length === 0) return "all testcases";
  return matching.join(", ");
}

function StatusPanel({ status }: { status: CheckNowStatus }) {
  if (status.state === "idle") {
    return (
      <p className="text-xs opacity-55" data-testid="check-now-status">
        No dashboard-triggered run in progress.
      </p>
    );
  }

  const tone =
    status.state === "running"
      ? "#89b4fa"
      : status.state === "succeeded"
      ? "#a6e3a1"
      : "#f38ba8";

  return (
    <div
      className="rounded px-3 py-3 text-xs flex flex-col gap-2"
      style={{
        border: `1px solid ${tone}`,
        backgroundColor:
          status.state === "running"
            ? "rgba(137,180,250,0.12)"
            : status.state === "succeeded"
            ? "rgba(166,227,161,0.12)"
            : "rgba(243,139,168,0.12)",
      }}
      data-testid="check-now-status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-bold" style={{ color: tone }}>
          {status.state === "running"
            ? "Running"
            : status.state === "succeeded"
            ? "Completed"
            : "Failed"}
        </span>
        <span className="opacity-80">
          Filter: <span className="font-mono">{filterLabel(status.matching)}</span>
        </span>
        <span className="opacity-60">
          Started: <span className="font-mono">{formatDashboardDateTime(status.started_at)}</span>
        </span>
        {status.finished_at && (
          <span className="opacity-60">
            Finished: <span className="font-mono">{formatDashboardDateTime(status.finished_at)}</span>
          </span>
        )}
        {status.duration_ms != null && (
          <span className="opacity-60">
            Duration: <span className="font-mono">{formatDuration(status.duration_ms)}</span>
          </span>
        )}
      </div>

      {status.state === "running" && (
        <p className="opacity-80">
          The TypeScript simulator testcase runner is running in the background.
          The run report page will show the new result when it lands.
        </p>
      )}

      {status.state === "succeeded" && status.latest_report?.path && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="opacity-80">
            Latest report: <span className="font-mono">{status.latest_report.path}</span>
          </span>
          <Link href="/parity" className="underline" style={{ color: "#a6e3a1" }}>
            View run reports
          </Link>
        </div>
      )}

      {status.state === "succeeded" && status.latest_run?.id && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="opacity-80">
            Latest run: <span className="font-mono">{status.latest_run.id}</span>
          </span>
          <Link
            href={`/runs/${status.latest_run.id}`}
            className="underline"
            style={{ color: "#a6e3a1" }}
          >
            View run
          </Link>
          <Link
            href={`/runs/${status.latest_run.id}/compare/prev`}
            className="underline"
            style={{ color: "#a6e3a1" }}
          >
            Compare vs previous
          </Link>
        </div>
      )}

      {status.state === "failed" && (
        <>
          <p className="opacity-90">
            {status.error ?? "The background run failed without a specific error."}
          </p>
          {status.stderr_tail && (
            <details>
              <summary className="cursor-pointer opacity-80">Show stderr tail</summary>
              <pre
                className="mt-2 whitespace-pre-wrap break-words text-[11px] font-mono"
                style={{ color: "#f5c2e7" }}
              >
                {status.stderr_tail}
              </pre>
            </details>
          )}
        </>
      )}
    </div>
  );
}

export default function CheckNowControls() {
  const router = useRouter();
  const [status, setStatus] = useState<CheckNowStatus>({ state: "idle" });
  const [starting, setStarting] = useState(false);
  const [matchingInput, setMatchingInput] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const previousState = useRef<CheckNowStatus["state"]>("idle");

  async function refreshStatus(): Promise<void> {
    try {
      const response = await fetch("/api/check-testcases", { cache: "no-store" });
      if (!response.ok) return;
      const nextStatus = (await response.json()) as CheckNowStatus;
      setStatus(nextStatus);
    } catch {
      // Leave the existing state in place. A transient fetch failure shouldn't
      // wipe the current UI status.
    }
  }

  useEffect(() => {
    void refreshStatus();
  }, []);

  useEffect(() => {
    if (status.state !== "running") return;
    const interval = window.setInterval(() => {
      void refreshStatus();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [status.state]);

  useEffect(() => {
    const latestRunId = status.latest_run?.id;
    if (
      previousState.current === "running" &&
      status.state === "succeeded" &&
      latestRunId
    ) {
      router.refresh();
    }
    previousState.current = status.state;
  }, [router, status]);

  const canStart = status.state !== "running" && !starting;
  const showFilter = filterOpen || matchingInput.trim().length > 0;
  const runButtonLabel = useMemo(() => {
    if (starting) return "Starting…";
    if (status.state === "running") return "Running…";
    return "Check now";
  }, [starting, status.state]);

  async function handleStart() {
    if (!canStart) return;
    setStarting(true);
    try {
      const response = await fetch("/api/check-testcases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchingInput }),
      });
      const nextStatus = (await response.json()) as CheckNowStatus & {
        error?: string;
      };
      if (!response.ok && response.status !== 409) {
        setStatus({
          state: "failed",
          finished_at: new Date().toISOString(),
          error: nextStatus.error ?? "Failed to start simulator testcase runner.",
        });
        return;
      }
      setStatus(nextStatus);
    } catch (err) {
      setStatus({
        state: "failed",
        finished_at: new Date().toISOString(),
        error: err instanceof Error ? err.message : "Failed to start simulator testcase runner.",
      });
    } finally {
      setStarting(false);
    }
  }

  return (
    <section
      className="rounded p-4 flex flex-col gap-3 mb-4"
      style={{
        border: "1px solid var(--border-color)",
        backgroundColor: "var(--sidebar-bg)",
      }}
      data-testid="check-now-controls"
    >
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex flex-col gap-1 max-w-2xl">
          <h3
            className="text-sm font-bold"
            style={{ color: "var(--sidebar-active)" }}
          >
            Check now
          </h3>
          <p className="text-xs opacity-65">
            Launch the TypeScript simulator testcase runner from the dashboard and
            write a run report under <code>simulator/testcase_results</code>.
          </p>
        </div>

        <div className="flex flex-col gap-2 w-full xl:w-auto xl:min-w-[26rem]">
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={handleStart}
              disabled={!canStart}
              className="rounded px-4 py-2 text-sm font-bold transition-opacity disabled:opacity-50"
              style={{
                backgroundColor:
                  status.state === "running" ? "#89b4fa" : "var(--sidebar-active)",
                color: "#11111b",
              }}
              data-testid="check-now-button"
            >
              {runButtonLabel}
            </button>
            <button
              type="button"
              onClick={() => setFilterOpen((value) => !value)}
              className="rounded px-3 py-2 text-sm"
              style={{
                border: "1px solid var(--border-color)",
                backgroundColor: showFilter ? "var(--sidebar-hover)" : "transparent",
              }}
              data-testid="check-now-filter-toggle"
              aria-expanded={showFilter}
              aria-controls="check-now-filter-panel"
            >
              {showFilter ? "Hide filter" : "Matching filter"}
            </button>
          </div>

          {showFilter && (
            <div
              id="check-now-filter-panel"
              className="flex flex-col gap-2"
              data-testid="check-now-filter-panel"
            >
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={matchingInput}
                  onChange={(event) => setMatchingInput(event.target.value)}
                  placeholder="e.g. alonso solo"
                  className="min-w-0 flex-1 rounded px-3 py-2 text-sm"
                  style={{
                    border: "1px solid var(--border-color)",
                    backgroundColor: "var(--main-bg)",
                    color: "var(--main-text)",
                  }}
                  data-testid="check-now-filter-input"
                  aria-label="matching filter"
                />
                {matchingInput.trim().length > 0 && (
                  <button
                    type="button"
                    onClick={() => setMatchingInput("")}
                    className="rounded px-3 py-2 text-sm"
                    style={{ border: "1px solid var(--border-color)" }}
                  >
                    Clear
                  </button>
                )}
              </div>
              <p className="text-[11px] opacity-55">
                Optional, unobtrusive filter. Separate terms with spaces or commas; the
                dashboard passes them through `--matching` as basename contains checks.
              </p>
            </div>
          )}
        </div>
      </div>

      <StatusPanel status={status} />
    </section>
  );
}
