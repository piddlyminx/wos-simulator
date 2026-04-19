import Link from "next/link";
import {
  getHero,
  getHeroSkills,
  getHeroTestcases,
  getHeroErrorHistory,
  getLatestRunId,
  getMissingTables,
  getHeroCoverageTimeline,
  getHeroSkillHistory,
} from "@/lib/db";
import HeroTrendChart from "@/components/HeroTrendChart";
import HeroCoverageTimelineChart from "@/components/HeroCoverageTimelineChart";
import { testcaseDetailHref } from "@/lib/testcase-file";

export const dynamic = "force-dynamic";

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded p-4 flex flex-col gap-1 min-w-28"
      style={{
        border: "1px solid var(--border-color)",
        backgroundColor: "var(--sidebar-bg)",
      }}
    >
      <span className="text-xs uppercase tracking-wider opacity-50">
        {label}
      </span>
      <span
        className="text-2xl font-bold font-mono"
        style={{ color: "var(--sidebar-active)" }}
      >
        {value}
      </span>
    </div>
  );
}

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
    const missingTables = getMissingTables();
    return (
      <div>
        <Link
          href="/heroes"
          className="text-xs opacity-50 hover:opacity-100 mb-4 inline-block"
          style={{ color: "var(--sidebar-active)" }}
        >
          &larr; Back to Heroes
        </Link>
        {missingTables.length > 0 ? (
          <div
            className="rounded p-3 mt-4 text-sm font-mono"
            style={{
              border: "1px solid #f38ba8",
              backgroundColor: "rgba(243,139,168,0.08)",
              color: "#f38ba8",
            }}
          >
            DB misconfiguration: missing tables:{" "}
            <strong>{missingTables.join(", ")}</strong>. Run{" "}
            <code>python dashboard/seed_heroes.py</code> to seed the hero
            catalogue (one-time setup, separate from{" "}
            <code>check_testcases.py</code>).
          </div>
        ) : (
          <div
            className="rounded p-6 text-sm opacity-60 mt-4"
            style={{ border: "1px solid var(--border-color)" }}
          >
            Hero <code className="font-mono">{heroName}</code> not found in the
            heroes table. Check that the name matches a hero in{" "}
            <code className="font-mono">assets/hero_skills/</code>.
          </div>
        )}
      </div>
    );
  }

  const skills = getHeroSkills(heroName);
  const latestRunId = getLatestRunId();
  const testcases = latestRunId
    ? getHeroTestcases(heroName, latestRunId)
    : [];
  const errorHistory = getHeroErrorHistory(heroName);
  const coverageTimeline = getHeroCoverageTimeline(heroName);
  const skillHistory = getHeroSkillHistory(heroName);

  // Get latest coverage stats from the last timeline point
  const latestCoverage = coverageTimeline.length > 0
    ? coverageTimeline[coverageTimeline.length - 1]
    : null;

  let classes: string[] = [];
  try {
    classes = JSON.parse(hero.classes ?? "[]");
  } catch {
    // ignore
  }

  return (
    <div>
      <Link
        href="/heroes"
        className="text-xs opacity-50 hover:opacity-100 mb-4 inline-block"
        style={{ color: "var(--sidebar-active)" }}
      >
        &larr; Back to Heroes
      </Link>

      <div className="flex items-center gap-3 mb-6">
        <h2
          className="text-xl font-bold"
          style={{ color: "var(--sidebar-active)" }}
        >
          {hero.name}
        </h2>
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
        {classes.length > 0 && (
          <span className="text-xs opacity-50">{classes.join(", ")}</span>
        )}
      </div>

      {/* Stat cards */}
      <div className="flex flex-wrap gap-4 mb-8">
        <StatCard label="Skills" value={String(skills.length)} />
        <StatCard
          label="Testcases"
          value={latestRunId ? String(testcases.length) : "—"}
        />
        <StatCard
          label="History Runs"
          value={String(errorHistory.length)}
        />
        {latestCoverage && (
          <StatCard
            label="Coverage"
            value={`${latestCoverage.skills_covered}/${latestCoverage.skills_total}`}
          />
        )}
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
        {skillHistory.length === 0 && skills.length === 0 ? (
          <p className="text-sm opacity-50">No skills found for {hero.name}.</p>
        ) : skillHistory.length > 0 ? (
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
                {skillHistory.map((skill) => (
                  <tr
                    key={skill.skill_id}
                    style={{ borderBottom: "1px solid var(--border-color)" }}
                  >
                    <td className="py-1.5 pr-4 opacity-70">{skill.skill_id}</td>
                    <td className="py-1.5 pr-4">{skill.skill_name}</td>
                    <td className="py-1.5 pr-4">
                      <span
                        className="inline-block px-1.5 py-0.5 rounded text-xs font-bold"
                        style={{
                          backgroundColor:
                            skill.currently_covered === 1
                              ? "#a6e3a1"
                              : "rgba(243,139,168,0.25)",
                          color:
                            skill.currently_covered === 1
                              ? "#1e1e2e"
                              : "#f38ba8",
                        }}
                      >
                        {skill.currently_covered === 1 ? "YES" : "NO"}
                      </span>
                    </td>
                    <td className="py-1.5 pr-4 opacity-70">
                      {shortDate(skill.first_seen_at)}
                    </td>
                    <td className="py-1.5 opacity-70">
                      {shortDate(skill.last_changed_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          /* Fall back to plain skill list if no coverage history yet */
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
                  <th className="pb-2 pr-4">Skill ID</th>
                  <th className="pb-2 pr-4">Name</th>
                </tr>
              </thead>
              <tbody>
                {skills.map((skill) => (
                  <tr
                    key={skill.skill_id}
                    style={{ borderBottom: "1px solid var(--border-color)" }}
                  >
                    <td className="py-1.5 pr-4 opacity-70">{skill.skill_id}</td>
                    <td className="py-1.5 pr-4">{skill.name}</td>
                  </tr>
                ))}
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
              className="w-full text-xs border-collapse font-mono"
              style={{ borderColor: "var(--border-color)" }}
            >
              <thead>
                <tr
                  className="text-left uppercase tracking-wider opacity-50"
                  style={{ borderBottom: "1px solid var(--border-color)" }}
                >
                  <th className="pb-2 pr-3">File</th>
                  <th className="pb-2 pr-3">Testcase</th>
                  <th className="pb-2 pr-3">Idx</th>
                  <th className="pb-2 pr-3">bias%</th>
                  <th className="pb-2 pr-3">q</th>
                  <th className="pb-2 pr-3">Pass</th>
                  <th className="pb-2">Waived</th>
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
                        className="py-1.5 pr-3 max-w-40 truncate"
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
                      <td className="py-1.5 pr-3">{tc.testcase_id}</td>
                      <td className="py-1.5 pr-3">{tc.idx}</td>
                      <td
                        className="py-1.5 pr-3"
                        style={{
                          color:
                            Math.abs(tc.bias_pct ?? 0) > 5 ? "#f38ba8" : "inherit",
                        }}
                      >
                        {tc.bias_pct?.toFixed(2)}%
                      </td>
                      <td
                        className="py-1.5 pr-3"
                        style={{ color: (tc.q ?? 1) <= 0.05 ? "#f38ba8" : "inherit" }}
                      >
                        {tc.q?.toFixed(4)}
                      </td>
                      <td className="py-1.5 pr-3">
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
                      <td className="py-1.5">
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
