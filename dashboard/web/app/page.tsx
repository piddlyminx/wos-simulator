import Link from "next/link";
import { redirect } from "next/navigation";
import {
  getCoverageMatrix,
  getCoverageTrend,
  getHeroes,
  getLatestRunId,
  getPreviousRun,
  getRecentCommits,
  getRecentFileChanges,
  getRun,
  getRunDeltaCounts,
  getTopRegressions,
} from "@/lib/db";
import CoverageTrendChart from "@/components/CoverageTrendChart";
import { isPublicSimulateSurface } from "@/lib/public-surface";
import { testcaseDetailHref } from "@/lib/testcase-file";

export const dynamic = "force-dynamic";

function formatRelativeAge(iso: string | null): string {
  if (!iso) return "";
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  const days = Math.floor(seconds / 86400);
  if (days >= 1) return `${days}d ago`;
  const hours = Math.floor(seconds / 3600);
  if (hours >= 1) return `${hours}h ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes >= 1) return `${minutes}m ago`;
  return `${seconds}s ago`;
}

function formatPct(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

function signed(n: number, digits = 2): string {
  const s = n.toFixed(digits);
  return n > 0 ? `+${s}` : s;
}

function Card({
  testid,
  title,
  href,
  children,
}: {
  testid: string;
  title: string;
  href?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      data-testid={testid}
      className="flex flex-col gap-3 rounded p-4 sm:p-5"
      style={{
        border: "1px solid var(--border-color)",
        backgroundColor: "var(--sidebar-bg)",
      }}
    >
      <header className="flex flex-col items-start gap-2 sm:flex-row sm:items-baseline sm:justify-between">
        <h3
          className="max-w-full text-sm font-bold uppercase tracking-wider leading-6 sm:leading-normal"
          style={{ color: "var(--sidebar-active)" }}
        >
          {title}
        </h3>
        {href && (
          <Link
            href={href}
            className="inline-flex items-center whitespace-nowrap text-xs opacity-60 underline hover:opacity-100"
          >
            View →
          </Link>
        )}
      </header>
      {children}
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad" | "warn";
}) {
  const color =
    tone === "good"
      ? "#a6e3a1"
      : tone === "bad"
      ? "#f38ba8"
      : tone === "warn"
      ? "#f9e2af"
      : "var(--sidebar-active)";
  return (
    <div className="flex min-w-[7.5rem] flex-col gap-0.5 sm:min-w-20">
      <span className="text-[10px] uppercase tracking-wider opacity-50">
        {label}
      </span>
      <span
        className="text-lg font-bold font-mono leading-tight sm:text-xl"
        style={{ color }}
      >
        {value}
      </span>
    </div>
  );
}

function shortFile(p: string): string {
  const parts = p.split("/");
  return parts[parts.length - 1] ?? p;
}

export default function HomePage() {
  if (isPublicSimulateSurface()) {
    redirect("/simulate");
  }

  const latestRunId = getLatestRunId();

  if (!latestRunId) {
    return (
      <div>
        <h2
          className="text-lg font-bold mb-4"
          style={{ color: "var(--sidebar-active)" }}
        >
          Dashboard
        </h2>
        <div
          className="rounded p-6 text-sm opacity-60"
          style={{ border: "1px solid var(--border-color)" }}
        >
          No historical runs found. Use Check now to generate a current simulator
          run report, or backfill the database for older run history.
        </div>
      </div>
    );
  }

  const latestRun = getRun(latestRunId);
  const prevRun = getPreviousRun(latestRunId);
  const delta = prevRun
    ? getRunDeltaCounts(latestRunId, prevRun.id)
    : { improved: 0, regressed: 0, added: 0, retired: 0, skipped: 0 };
  const deltaAvgErr =
    prevRun &&
    latestRun?.overall_avg_error_pct != null &&
    prevRun.overall_avg_error_pct != null
      ? latestRun.overall_avg_error_pct - prevRun.overall_avg_error_pct
      : null;

  const topRegressions = getTopRegressions(3, 5);
  const coverageTrend = getCoverageTrend(50);
  const recentChanges = getRecentFileChanges(7);
  const recentCommits = getRecentCommits(7);

  // Newest combat generations surfaced on the dashboard landing page.
  const heroes = getHeroes();
  const featuredHeroes = heroes.filter(
    (h) =>
      h.generation === "Gen 5" ||
      h.generation === "Gen 6" ||
      h.generation === "Gen 7"
  );
  const matrix = getCoverageMatrix(latestRunId);
  const perHero = new Map<string, { covered: number; total: number }>();
  for (const row of matrix) {
    const entry = perHero.get(row.hero) ?? { covered: 0, total: 0 };
    entry.total += 1;
    if (row.covered_bool === 1) entry.covered += 1;
    perHero.set(row.hero, entry);
  }

  const compareHref =
    topRegressions.length > 0
      ? `/compare/${topRegressions[0].window_start_run_id}/${topRegressions[0].window_end_run_id}`
      : prevRun
      ? `/compare/${prevRun.id}/${latestRunId}`
      : undefined;

  return (
    <div>
      <h2
        className="text-lg font-bold mb-4"
        style={{ color: "var(--sidebar-active)" }}
      >
        Dashboard
      </h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Card 1 — Latest Run */}
        <Card
          testid="card-latest-run"
          title="Latest Run"
          href={prevRun ? `/runs/${latestRunId}/compare/prev` : `/runs/${latestRunId}`}
        >
          <div className="flex flex-wrap gap-5">
            <Stat
              label="Avg Error"
              value={formatPct(latestRun?.overall_avg_error_pct)}
            />
            <Stat
              label="Δ vs prev"
              value={deltaAvgErr != null ? `${signed(deltaAvgErr)}pp` : "—"}
              tone={
                deltaAvgErr == null
                  ? undefined
                  : deltaAvgErr < 0
                  ? "good"
                  : deltaAvgErr > 0
                  ? "bad"
                  : undefined
              }
            />
          </div>
          <div className="flex flex-wrap gap-5 mt-1">
            <Stat label="Improved" value={String(delta.improved)} tone="good" />
            <Stat label="Regressed" value={String(delta.regressed)} tone="bad" />
            <Stat label="Added" value={String(delta.added)} />
            <Stat label="Retired" value={String(delta.retired)} />
            <Stat label="Skipped" value={String(delta.skipped)} tone="warn" />
          </div>
          <p className="text-[11px] font-mono opacity-50 mt-1 break-all">
            {latestRunId}
          </p>
        </Card>

        {/* Card 2 — Recent Regressions */}
        <Card
          testid="card-regressions"
          title="Recent Regressions (last 3 runs)"
          href={compareHref}
        >
          {topRegressions.length === 0 ? (
            <p className="text-xs opacity-50">
              No regressions detected in the last 3 runs.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-xs font-mono">
              {topRegressions.map((r) => {
                const passFail =
                  r.passes_old === 1 && r.passes_new === 0;
                return (
                  <li
                    key={`${r.file}|${r.testcase_id}|${r.idx}`}
                    className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="min-w-0 flex-1 break-words text-[11px] leading-5 sm:text-xs sm:leading-normal">
                      {passFail && (
                        <span
                          className="px-1 mr-1.5 rounded text-[9px] uppercase"
                          style={{
                            backgroundColor: "rgba(243,139,168,0.2)",
                            color: "#f38ba8",
                            border: "1px solid #f38ba8",
                          }}
                        >
                          pass→fail
                        </span>
                      )}
                      <Link
                        href={`${testcaseDetailHref(r.file)}?tc=${r.idx}`}
                        className="underline hover:opacity-80"
                        style={{ color: "var(--sidebar-active)" }}
                      >
                        {shortFile(r.file)}
                      </Link>{" "}
                      · {r.testcase_id}[{r.idx}]
                    </span>
                    <span className="self-start whitespace-nowrap opacity-70 tabular-nums sm:self-auto">
                      {r.bias_old != null ? formatPct(r.bias_old, 1) : "—"}{" "}
                      →{" "}
                      <span style={{ color: "#f38ba8" }}>
                        {r.bias_new != null ? formatPct(r.bias_new, 1) : "—"}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Card 3 — Coverage Trend + newest hero generations */}
        <Card
          testid="card-coverage"
          title="Coverage Trend + Gen 5-7 Heroes"
          href="/coverage"
        >
          {coverageTrend.length > 0 && <CoverageTrendChart data={coverageTrend} />}
          <div className="flex flex-wrap gap-2 mt-1">
            {featuredHeroes.map((h) => {
              const c = perHero.get(h.name);
              const covered = c && c.total > 0 && c.covered === c.total;
              const partial = c && c.covered > 0 && c.covered < c.total;
              const tone = covered ? "good" : partial ? "warn" : "bad";
              const color =
                tone === "good"
                  ? "#a6e3a1"
                  : tone === "warn"
                  ? "#f9e2af"
                  : "#f38ba8";
              return (
                <Link
                  key={h.name}
                  href={`/heroes/${encodeURIComponent(h.name)}`}
                  className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-mono"
                  style={{
                    border: `1px solid ${color}`,
                    color,
                    backgroundColor: `${color}15`,
                  }}
                  title={`${h.name} (${h.generation}): ${
                    c ? `${c.covered}/${c.total} skills covered` : "no coverage data"
                  }`}
                >
                  <span>{covered ? "✓" : "✗"}</span>
                  <span>{h.name}</span>
                  {c && (
                    <span className="opacity-60">
                      {c.covered}/{c.total}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </Card>

        {/* Card 4 — Testcase additions/retirals */}
        <Card
          testid="card-testcase-changes"
          title="Testcase Changes (last 7 days)"
          href="/testcases/changelog"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider opacity-50 mb-1">
                Added ({recentChanges.added.length})
              </p>
              {recentChanges.added.length === 0 ? (
                <p className="text-xs opacity-40">None</p>
              ) : (
                <ul className="flex flex-col gap-0.5 text-xs font-mono">
                  {recentChanges.added.slice(0, 5).map((r) => (
                    <li key={r.file_path} className="truncate" title={r.file_path}>
                      <span style={{ color: "#a6e3a1" }}>+</span>{" "}
                      <Link
                        href={testcaseDetailHref(r.file_path)}
                        className="underline hover:opacity-80"
                        style={{ color: "var(--sidebar-active)" }}
                      >
                        {shortFile(r.file_path)}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider opacity-50 mb-1">
                Retired ({recentChanges.retired.length})
              </p>
              {recentChanges.retired.length === 0 ? (
                <p className="text-xs opacity-40">None</p>
              ) : (
                <ul className="flex flex-col gap-0.5 text-xs font-mono">
                  {recentChanges.retired.slice(0, 5).map((r) => (
                    <li key={r.file_path} className="truncate" title={r.file_path}>
                      <span style={{ color: "#f38ba8" }}>−</span>{" "}
                      <Link
                        href={testcaseDetailHref(r.file_path)}
                        className="underline hover:opacity-80"
                        style={{ color: "var(--sidebar-active)" }}
                      >
                        {shortFile(r.file_path)}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Card>

        {/* Card 5 — Recent simulator commits */}
        <Card
          testid="card-recent-commits"
          title="Recent Simulator Commits (last 7 days)"
          href={compareHref}
        >
          {recentCommits.length === 0 ? (
            <p className="text-xs opacity-50">
              No recorded simulator commits in the last 7 days.
            </p>
          ) : (
            <ul className="flex flex-col gap-1 text-xs font-mono">
              {recentCommits.slice(0, 8).map((c) => (
                <li
                  key={c.git_sha}
                  className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-2"
                >
                  <div className="flex items-center gap-2 text-[11px] sm:text-xs">
                    <span className="w-16 shrink-0 opacity-50">
                      {c.git_sha.slice(0, 8)}
                    </span>
                    <span className="shrink-0 opacity-40">
                      {formatRelativeAge(c.commit_date)}
                    </span>
                  </div>
                  <span
                    className="min-w-0 flex-1 break-words leading-5 sm:truncate sm:leading-normal"
                    title={c.commit_subject ?? ""}
                  >
                    {c.commit_subject ?? "(no subject)"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
