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
        <h3 className="max-w-full text-sm font-bold leading-6 sm:leading-normal">
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
      <span className="text-[10px] font-bold opacity-50">
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

function SummaryTile({
  label,
  value,
  helper,
  tone,
}: {
  label: string;
  value: string;
  helper: string;
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
    <div
      className="rounded p-3"
      style={{
        border: "1px solid var(--border-color)",
        backgroundColor: "var(--sidebar-bg)",
      }}
    >
      <div className="text-[10px] font-bold opacity-55">{label}</div>
      <div className="mt-1 text-xl font-bold leading-tight" style={{ color }}>
        {value}
      </div>
      <div className="mt-1 text-[11px] opacity-55">{helper}</div>
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
        <h2 className="text-xl font-bold mb-1" style={{ color: "var(--sidebar-active)" }}>
          Health Dashboard
        </h2>
        <p className="mb-4 text-sm opacity-65">Can I trust the simulator today?</p>
        <div
          className="rounded p-6 text-sm opacity-60"
          style={{ border: "1px solid var(--border-color)" }}
        >
          No historical runs found. Run{" "}
          <code>npx tsx scripts/run_testcases.ts --save-snapshot --db-ingest</code> from the
          repo root to generate a current simulator run report.
        </div>
      </div>
    );
  }

  const latestRun = getRun(latestRunId);
  const prevRun = getPreviousRun(latestRunId);
  const delta = prevRun
    ? getRunDeltaCounts(latestRunId, prevRun.id)
    : { changed: 0, improved: 0, regressed: 0, added: 0, retired: 0, skipped: 0 };
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
  let coveredSkillRows = 0;
  let totalSkillRows = 0;
  for (const row of matrix) {
    const entry = perHero.get(row.hero) ?? { covered: 0, total: 0 };
    entry.total += 1;
    totalSkillRows += 1;
    if (row.covered_bool === 1) entry.covered += 1;
    if (row.covered_bool === 1) coveredSkillRows += 1;
    perHero.set(row.hero, entry);
  }
  const coveragePct =
    totalSkillRows > 0 ? (coveredSkillRows / totalSkillRows) * 100 : null;

  const compareHref =
    topRegressions.length > 0
      ? `/compare/${topRegressions[0].window_start_run_id}/${topRegressions[0].window_end_run_id}`
      : prevRun
      ? `/compare/${prevRun.id}/${latestRunId}`
      : undefined;

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-xl font-bold" style={{ color: "var(--sidebar-active)" }}>
            Health Dashboard
          </h2>
          <p className="mt-1 text-sm opacity-65">Can I trust the simulator today?</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link
            href="/simulate"
            className="inline-flex min-h-[40px] items-center justify-center rounded px-3 py-2 text-xs font-bold"
            style={{
              border: "1px solid var(--sidebar-active)",
              backgroundColor: "var(--sidebar-active)",
              color: "#1e1e2e",
            }}
          >
            Run simulation
          </Link>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryTile
          label="Average error"
          value={formatPct(latestRun?.overall_avg_error_pct)}
          helper={latestRun ? formatRelativeAge(latestRun.started_at) : "No run"}
          tone={
            latestRun?.overall_avg_error_pct == null
              ? undefined
              : latestRun.overall_avg_error_pct <= 5
              ? "good"
              : latestRun.overall_avg_error_pct <= 10
              ? "warn"
              : "bad"
          }
        />
        <SummaryTile
          label="Changed"
          value={String(delta.changed)}
          helper={`${delta.regressed} regressed, ${delta.improved} improved`}
          tone={delta.regressed > 0 ? "bad" : delta.changed > 0 ? "warn" : "good"}
        />
        <SummaryTile
          label="Coverage"
          value={coveragePct == null ? "—" : `${coveragePct.toFixed(0)}%`}
          helper={`${coveredSkillRows}/${totalSkillRows} hero skills`}
          tone={coveragePct == null ? undefined : coveragePct >= 90 ? "good" : "warn"}
        />
        <SummaryTile
          label="Skipped"
          value={String(delta.skipped)}
          helper="latest run"
          tone={delta.skipped > 0 ? "warn" : "good"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Card 1 — Latest Run */}
        <Card
          testid="card-latest-run"
          title="Latest run"
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
            <Stat label="Changed" value={String(delta.changed)} tone="warn" />
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
          title="Needs attention"
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
          title="Coverage trend + Gen 5-7 heroes"
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
          title="Testcase changes (last 7 days)"
          href="/testcases/changelog"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] font-bold opacity-50 mb-1">
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
              <p className="text-[10px] font-bold opacity-50 mb-1">
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
          title="Recent activity"
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
