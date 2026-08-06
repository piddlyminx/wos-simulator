import Link from "next/link";

import CoverageTrendChart from "@/components/CoverageTrendChart";
import { ExperimentalBadge } from "@/components/ExperimentalBadge";
import MetricCard from "@/components/MetricCard";
import {
  getCoverageTrend,
  getLatestRunId,
  getRunTestcaseKeys,
} from "@/lib/db";
import {
  HEROES,
  sortHeroesByGenerationAndTroop,
} from "@/lib/heroes-catalogue";
import {
  getActiveTestcaseKeys,
  getLiveHeroCoverage,
} from "@/lib/live-coverage";

export const dynamic = "force-dynamic";

function testcaseKey({
  file,
  testcase_id,
  idx,
}: {
  file: string;
  testcase_id: string;
  idx: number;
}): string {
  return `${file}\u0000${testcase_id}\u0000${idx}`;
}

function setsDiffer(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return true;
  return [...left].some((key) => !right.has(key));
}

export default function HeroesPage() {
  const heroes = sortHeroesByGenerationAndTroop(HEROES);
  const coverage = getLiveHeroCoverage(
    heroes.flatMap((hero) =>
      hero.skills.map((skill) => ({ hero: hero.name, skillId: skill.id })),
    ),
  );
  const coverageByHeroAndSkill = new Map(
    coverage.map((cell) => [`${cell.hero}\u0000${cell.skillId}`, cell]),
  );
  const skillIds = [...new Set(coverage.map((cell) => cell.skillId))].sort(
    (a, b) => Number(a) - Number(b),
  );
  const coveredSkills = coverage.filter((cell) => cell.covered).length;
  const coveragePct =
    coverage.length > 0
      ? Math.round((coveredSkills / coverage.length) * 100)
      : null;

  const latestRunId = getLatestRunId();
  const savedKeys = new Set(
    latestRunId
      ? getRunTestcaseKeys(latestRunId).map(testcaseKey)
      : [],
  );
  const activeKeys = new Set(getActiveTestcaseKeys().map(testcaseKey));
  const testcaseSetChanged =
    latestRunId != null && setsDiffer(activeKeys, savedKeys);
  const coverageTrend = getCoverageTrend(50);

  return (
    <div>
      <h2
        className="text-lg font-bold mb-1"
        style={{ color: "var(--sidebar-active)" }}
      >
        Heroes
      </h2>
      <p className="mb-4 text-xs opacity-60">
        Heroes and skills come from the simulator configuration bundled at
        build time. Current coverage is read from active testcase JSON; the
        trend is retained from saved runs.
      </p>

      {testcaseSetChanged && (
        <div
          className="rounded p-3 mb-4 text-sm font-mono"
          style={{
            border: "1px solid #f9e2af",
            backgroundColor: "rgba(249,226,175,0.08)",
            color: "#f9e2af",
          }}
        >
          Warning: active testcase set differs from the latest saved run
        </div>
      )}

      {coverageTrend.length > 0 && (
        <div className="mb-6">
          <CoverageTrendChart data={coverageTrend} />
        </div>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Total Skills"
          value={String(coverage.length)}
          valueClassName="text-xl sm:text-2xl"
        />
        <MetricCard
          label="Covered"
          value={String(coveredSkills)}
          valueClassName="text-xl sm:text-2xl"
        />
        <MetricCard
          label="Coverage"
          value={coveragePct == null ? "—" : `${coveragePct}%`}
          valueClassName="text-xl sm:text-2xl"
        />
        <MetricCard
          label="Heroes"
          value={String(heroes.length)}
          valueClassName="text-xl sm:text-2xl"
        />
      </div>

      <div className="flex flex-wrap gap-4 mb-3 text-xs opacity-60">
        <span className="flex items-center gap-1">
          <span
            className="inline-block w-3 h-3 rounded-sm"
            style={{ backgroundColor: "#a6e3a1" }}
          />
          Covered <span className="opacity-70">(number = testcases)</span>
        </span>
        <span className="flex items-center gap-1">
          <span
            className="inline-block w-3 h-3 rounded-sm"
            style={{ backgroundColor: "#f38ba8" }}
          />
          Not covered
        </span>
      </div>

      <div className="overflow-x-auto">
        <table
          className="w-full border-collapse text-xs font-mono"
          style={{ borderColor: "var(--border-color)" }}
        >
          <thead>
            <tr
              className="text-left uppercase tracking-wider opacity-60"
              style={{ borderBottom: "1px solid var(--border-color)" }}
            >
              <th
                className="pb-2 pr-4 sticky left-0"
                style={{ backgroundColor: "var(--main-bg)" }}
              >
                Name
              </th>
              <th className="pb-2 pr-4">Gen</th>
              <th className="pb-2 pr-4">Type</th>
              {skillIds.map((skillId) => (
                <th key={skillId} className="pb-2 px-1 text-center">
                  S{skillId}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {heroes.flatMap((hero, heroIndex) => {
              const generationChanged =
                heroIndex === 0 ||
                hero.generation !== heroes[heroIndex - 1]?.generation;
              const rows = [];
              if (generationChanged) {
                rows.push(
                  <tr key={`generation-${hero.generation ?? "unknown"}`}>
                    <td
                      colSpan={3 + skillIds.length}
                      className="pt-4 pb-1 uppercase tracking-widest opacity-40"
                    >
                      {hero.generation ?? "Unknown generation"}
                    </td>
                  </tr>,
                );
              }
              rows.push(
                <tr
                  key={hero.name}
                  style={{ borderBottom: "1px solid var(--border-color)" }}
                >
                  <td
                    className="py-2 pr-4 sticky left-0"
                    style={{ backgroundColor: "var(--main-bg)" }}
                  >
                    <div className="flex items-center gap-1.5">
                      <Link
                        href={`/heroes/${encodeURIComponent(hero.name)}`}
                        className="hover:underline"
                        style={{ color: "var(--sidebar-active)" }}
                      >
                        {hero.name}
                      </Link>
                      {hero.experimental && <ExperimentalBadge />}
                    </div>
                  </td>
                  <td className="py-2 pr-4 opacity-60">
                    {hero.generation ?? "—"}
                  </td>
                  <td className="py-2 pr-4 opacity-60 capitalize">
                    {hero.troopType ?? "—"}
                  </td>
                  {skillIds.map((skillId) => {
                    const skill = hero.skills.find(
                      (candidate) => candidate.id === skillId,
                    );
                    if (!skill) {
                      return <td key={skillId} className="py-2 px-1" />;
                    }
                    const cell = coverageByHeroAndSkill.get(
                      `${hero.name}\u0000${skillId}`,
                    );
                    const covered = cell?.covered === true;
                    return (
                      <td key={skillId} className="py-2 px-1 text-center">
                        <span
                          className="inline-flex min-w-6 h-5 items-center justify-center rounded-sm px-1 text-[10px] font-bold"
                          style={{
                            backgroundColor: covered ? "#a6e3a1" : "#f38ba8",
                            color: covered ? "#1e1e2e" : "transparent",
                          }}
                          title={`${hero.name} / ${skill.name}: ${covered ? "covered" : "not covered"} (${cell?.testcaseCount ?? 0} tc, ${cell?.battleOutcomeCount ?? 0} battles)`}
                          aria-label={`${hero.name} skill ${skillId}: ${covered ? `${cell?.testcaseCount ?? 0} testcases` : "not covered"}`}
                        >
                          {covered ? cell?.testcaseCount : null}
                        </span>
                      </td>
                    );
                  })}
                </tr>,
              );
              return rows;
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
