import Link from "next/link";
import {
  getHeroTestcases,
  getHeroErrorHistory,
  getLatestRunId,
  getHeroCoverageTimeline,
  getHeroSkillHistory,
} from "@/lib/db";
import HeroTrendChart from "@/components/HeroTrendChart";
import HeroCoverageTimelineChart from "@/components/HeroCoverageTimelineChart";
import { ExperimentalBadge } from "@/components/ExperimentalBadge";
import MetricCard from "@/components/MetricCard";
import { testcaseDetailHref } from "@/lib/testcase-file";
import { formatStatAdjustment, statAdjustmentTitle } from "@/lib/stat-adjustment";
import { getHero } from "@/lib/heroes-catalogue";
import { getLiveHeroCoverage } from "@/lib/live-coverage";

const stickyTh =
  "sticky top-0 z-10 bg-[var(--sidebar-bg)] px-1.5 py-1 text-left";
const compactTd = "px-1.5 py-1";

export const dynamic = "force-dynamic";

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return iso;
  }
}

interface PageProps {
  params: Promise<{ name: string }>;
}

export default async function HeroDetailPage({ params }: PageProps) {
  const { name } = await params;
  const heroName = decodeURIComponent(name);
  const hero = getHero(heroName);

  if (!hero) {
    return (
      <div>
        <Link
          href="/heroes"
          className="text-xs opacity-50 hover:opacity-100 mb-4 inline-block"
          style={{ color: "var(--sidebar-active)" }}
        >
          &larr; Back to Heroes
        </Link>
        <div
          className="rounded p-6 text-sm opacity-60 mt-4"
          style={{ border: "1px solid var(--border-color)" }}
        >
          Hero <code className="font-mono">{heroName}</code> is not present in{" "}
          <code className="font-mono">simulator/config/hero_definitions/</code>.
        </div>
      </div>
    );
  }

  const latestRunId = getLatestRunId();
  const testcases = latestRunId
    ? getHeroTestcases(heroName, latestRunId)
    : [];
  const errorHistory = getHeroErrorHistory(heroName);
  const coverageTimeline = getHeroCoverageTimeline(heroName);
  const skillHistory = getHeroSkillHistory(heroName);
  const currentCoverage = getLiveHeroCoverage(
    hero.skills.map((skill) => ({ hero: hero.name, skillId: skill.id })),
  );
  const coverageBySkill = new Map(
    currentCoverage.map((cell) => [cell.skillId, cell]),
  );
  const skillHistoryById = new Map(
    skillHistory.map((skill) => [skill.skill_id, skill]),
  );
  const coveredSkillCount = currentCoverage.filter((cell) => cell.covered).length;

  return (
    <div>
      <Link
        href="/heroes"
        className="text-xs opacity-50 hover:opacity-100 mb-4 inline-block"
        style={{ color: "var(--sidebar-active)" }}
      >
        &larr; Back to Heroes
      </Link>

      <div className="mb-6 flex flex-wrap items-center gap-2 sm:gap-3">
        <h2
          className="text-xl font-bold"
          style={{ color: "var(--sidebar-active)" }}
        >
          {hero.name}
        </h2>
        {hero.experimental && <ExperimentalBadge />}
        <span
          className="inline-block px-2 py-0.5 rounded text-xs font-bold font-mono"
          style={{
            backgroundColor: "var(--sidebar-bg)",
            border: "1px solid var(--border-color)",
            color: "var(--sidebar-active)",
          }}
        >
          {hero.generation ?? "—"}
        </span>
        {hero.troopType && (
          <span className="text-xs opacity-50 capitalize">{hero.troopType}</span>
        )}
      </div>

      {/* Stat cards */}
      <div className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Skills"
          value={String(hero.skills.length)}
          valueClassName="text-xl sm:text-2xl"
        />
        <MetricCard
          label="Testcases"
          value={latestRunId ? String(testcases.length) : "—"}
          valueClassName="text-xl sm:text-2xl"
        />
        <MetricCard
          label="History Runs"
          value={String(errorHistory.length)}
          valueClassName="text-xl sm:text-2xl"
        />
        <MetricCard
          label="Current Coverage"
          value={`${coveredSkillCount}/${hero.skills.length}`}
          valueClassName="text-xl sm:text-2xl"
        />
      </div>

      {/* Coverage Timeline chart */}
      {coverageTimeline.length > 0 && (
        <div
          data-testid="coverage-timeline"
          className="rounded p-4 mb-8"
          style={{
            border: "1px solid var(--border-color)",
            backgroundColor: "var(--sidebar-bg)",
          }}
        >
          <h3
            className="font-bold mb-3 text-xs uppercase tracking-wider opacity-60"
          >
            Coverage Timeline
          </h3>
          <HeroCoverageTimelineChart data={coverageTimeline} heroName={hero.name} />
        </div>
      )}

      {/* Error trend chart */}
      {errorHistory.length > 0 && (
        <div
          className="rounded p-4 mb-8"
          style={{
            border: "1px solid var(--border-color)",
            backgroundColor: "var(--sidebar-bg)",
          }}
        >
          <h3
            className="font-bold mb-3 text-xs uppercase tracking-wider opacity-60"
          >
            Avg Bias % Over Time
          </h3>
          <HeroTrendChart data={errorHistory} heroName={hero.name} />
        </div>
      )}

      {/* Enriched skill history table */}
      <div className="mb-8">
        <h3
          className="font-bold mb-3 text-sm"
          style={{ color: "var(--sidebar-active)" }}
        >
          Skills
        </h3>
        {hero.skills.length === 0 ? (
          <p className="text-sm opacity-50">No skills found for {hero.name}.</p>
        ) : (
          <div className="overflow-x-auto">
            <table
              className="w-full text-xs border-collapse font-mono"
              style={{ borderColor: "var(--border-color)" }}
            >
              <thead>
                <tr
                  className="text-left uppercase tracking-wider opacity-50"
                  style={{ borderBottom: "1px solid var(--border-color)" }}
                >
                  <th className="pb-2 pr-4">Skill</th>
                  <th className="pb-2 pr-4">Name</th>
                  <th className="pb-2 pr-4">Covered</th>
                  <th className="pb-2 pr-4">First Covered</th>
                  <th className="pb-2">Last Changed</th>
                </tr>
              </thead>
              <tbody>
                {hero.skills.map((skill) => {
                  const coverage = coverageBySkill.get(skill.id);
                  const history = skillHistoryById.get(skill.id);
                  return (
                    <tr
                      key={skill.id}
                      style={{ borderBottom: "1px solid var(--border-color)" }}
                    >
                      <td className="py-1.5 pr-4 opacity-70">{skill.id}</td>
                      <td className="py-1.5 pr-4">{skill.name}</td>
                      <td className="py-1.5 pr-4">
                        <span
                          className="inline-block px-1.5 py-0.5 rounded text-xs font-bold"
                          style={{
                            backgroundColor: coverage?.covered
                              ? "#a6e3a1"
                              : "rgba(243,139,168,0.25)",
                            color: coverage?.covered ? "#1e1e2e" : "#f38ba8",
                          }}
                          title={`${coverage?.testcaseCount ?? 0} current testcases`}
                        >
                          {coverage?.covered ? "YES" : "NO"}
                        </span>
                      </td>
                      <td className="py-1.5 pr-4 opacity-70">
                        {shortDate(history?.first_seen_at ?? null)}
                      </td>
                      <td className="py-1.5 opacity-70">
                        {shortDate(history?.last_changed_at ?? null)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Testcase list (latest run) */}
      <div>
        <h3
          className="font-bold mb-3 text-sm"
          style={{ color: "var(--sidebar-active)" }}
        >
          Testcases (Latest Run)
        </h3>
        {!latestRunId ? (
          <p className="text-sm opacity-50">No runs in database.</p>
        ) : testcases.length === 0 ? (
          <p className="text-sm opacity-50">
            No testcases for {hero.name} in the latest run.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table
              className="w-full border-collapse font-mono text-[11px] leading-tight"
              style={{ borderColor: "var(--border-color)" }}
            >
              <thead>
                <tr
                  className="text-left uppercase tracking-wider"
                  style={{ borderBottom: "1px solid var(--border-color)" }}
                >
                  <th className={stickyTh}>File</th>
                  <th className={stickyTh}>Case</th>
                  <th className={stickyTh}>#</th>
                  <th className={stickyTh}>Adj</th>
                  <th className={stickyTh}>Bias%</th>
                  <th className={stickyTh}>q</th>
                  <th className={stickyTh}>P</th>
                  <th className={stickyTh}>W</th>
                </tr>
              </thead>
              <tbody>
                {testcases.map((tc, i) => {
                  const isBhSig = (tc.q ?? 1) <= 0.05 && tc.passes === 0;
                  const isWaived = tc.waived_bool === 1;
                  return (
                    <tr
                      key={i}
                      style={{
                        borderBottom: "1px solid var(--border-color)",
                        opacity: isWaived ? 0.45 : 1,
                        backgroundColor: isBhSig
                          ? "rgba(243,139,168,0.08)"
                          : "transparent",
                      }}
                    >
                      <td
                        className={`${compactTd} max-w-32 truncate`}
                        title={tc.file}
                      >
                        <Link
                          href={`${testcaseDetailHref(tc.file)}?tc=${tc.idx}`}
                          className="underline hover:opacity-80"
                          style={{ color: "var(--sidebar-active)" }}
                        >
                          {tc.file}
                        </Link>
                      </td>
                      <td className={`${compactTd} max-w-36 truncate`} title={tc.testcase_id}>{tc.testcase_id}</td>
                      <td className={compactTd}>{tc.idx}</td>
                      <td
                        className={compactTd}
                        title={statAdjustmentTitle(
                          tc.stat_adjustment_value,
                          tc.stat_adjustment_mode,
                        )}
                      >
                        {formatStatAdjustment(tc.stat_adjustment_value)}
                      </td>
                      <td
                        className={compactTd}
                        style={{
                          color:
                            Math.abs(tc.bias_pct ?? 0) > 5 ? "#f38ba8" : "inherit",
                        }}
                      >
                        {tc.bias_pct?.toFixed(2)}%
                      </td>
                      <td
                        className={compactTd}
                        style={{ color: (tc.q ?? 1) <= 0.05 ? "#f38ba8" : "inherit" }}
                      >
                        {tc.q?.toPrecision(2)}
                      </td>
                      <td className={compactTd}>
                        <span
                          className="inline-block px-1.5 py-0.5 rounded text-xs font-bold"
                          style={{
                            backgroundColor:
                              tc.passes === 1 ? "#a6e3a1" : "#f38ba8",
                            color: "#1e1e2e",
                          }}
                        >
                          {tc.passes === 1 ? "P" : "F"}
                        </span>
                      </td>
                      <td className={compactTd}>
                        {isWaived ? (
                          <span className="opacity-60 text-xs">W</span>
                        ) : (
                          <span className="opacity-20">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
