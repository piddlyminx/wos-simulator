import Link from "next/link";
import { execSync } from "child_process";
import path from "path";
import {
  getCoverageMatrix,
  getCoverageTrend,
  getHeroes,
  getLatestRunId,
  getPreviousRun,
  getRecentFileChanges,
  getRun,
  getRunDeltaCounts,
  getTopRegressions,
} from "@/lib/db";
import CoverageTrendChart from "@/components/CoverageTrendChart";

export const dynamic = "force-dynamic";

interface RecentCommit {
  sha: string;
  author: string;
  relative_age: string;
  subject: string;
}

function getRecentSimulatorCommits(days = 7): RecentCommit[] {
  try {
    const repoRoot = path.resolve(process.cwd(), "../..");
    const out = execSync(
      `git -C "${repoRoot}" log --since="${days} days ago" --pretty="%h|%an|%ar|%s" -- assets/ skills/ Base_classes/`,
      { encoding: "utf8" }
    );
    return out
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => {
        const [sha, author, relative_age, ...rest] = l.split("|");
        return { sha, author, relative_age, subject: rest.join("|") };
      });
  } catch (err) {
    console.error("[wos-dashboard] getRecentSimulatorCommits failed:", err);
    return [];
  }
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
      className="rounded p-5 flex flex-col gap-3"
      style={{
        border: "1px solid var(--border-color)",
        backgroundColor: "var(--sidebar-bg)",
      }}
    >
      <header className="flex items-baseline justify-between gap-3">
        <h3
          className="text-sm font-bold uppercase tracking-wider"
          style={{ color: "var(--sidebar-active)" }}
        >
          {title}
        </h3>
        {href && (
          <Link
            href={href}
            className="text-xs opacity-60 hover:opacity-100 underline"
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
    <div className="flex flex-col gap-0.5 min-w-20">
      <span className="text-[10px] uppercase tracking-wider opacity-50">
        {label}
      </span>
      <span className="text-xl font-bold font-mono" style={{ color }}>
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
          No runs found. Run{" "}
          <code className="font-mono">check_testcases.py</code> to populate the
          database.
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
  const recentCommits = getRecentSimulatorCommits(7);

  // Tier-1 hero coverage status (Gen 5 + Gen 6)
  const heroes = getHeroes();
  const tierOne = heroes.filter(
    (h) => h.generation === "Gen 5" || h.generation === "Gen 6"
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
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="truncate flex-1">
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
                      {shortFile(r.file)} · {r.testcase_id}[{r.idx}]
                    </span>
                    <span className="opacity-70 tabular-nums whitespace-nowrap">
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

        {/* Card 3 — Coverage Trend + Tier-1 heroes */}
        <Card
          testid="card-coverage"
          title="Coverage Trend + Tier-1 Heroes"
          href="/coverage"
        >
          {coverageTrend.length > 0 && <CoverageTrendChart data={coverageTrend} />}
          <div className="flex flex-wrap gap-2 mt-1">
            {tierOne.map((h) => {
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
                      {shortFile(r.file_path)}
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
                      {shortFile(r.file_path)}
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
              No commits touching <code>assets/</code>, <code>skills/</code>, or{" "}
              <code>Base_classes/</code> in the last 7 days.
            </p>
          ) : (
            <ul className="flex flex-col gap-1 text-xs font-mono">
              {recentCommits.slice(0, 8).map((c) => (
                <li key={c.sha} className="flex gap-2">
                  <span className="opacity-50 w-16 shrink-0">{c.sha}</span>
                  <span className="opacity-40 w-24 shrink-0">
                    {c.relative_age}
                  </span>
                  <span className="flex-1 truncate" title={c.subject}>
                    {c.subject}
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
