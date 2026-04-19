import {
  getHeroes,
  getLatestRunId,
  getDistinctSkillIds,
  getCoverageMatrix,
  getPreviousRun,
  getRunTestcaseKeys,
  getMissingTables,
  getCoverageTrend,
  getHeroCoverageDeltas,
} from "@/lib/db";
import type { CoverageSnapshot } from "@/types/dashboard";
import CoverageTrendChart from "@/components/CoverageTrendChart";

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

export default function CoveragePage() {
  const missingTables = getMissingTables();
  const heroes = getHeroes();
  const latestRunId = getLatestRunId();

  if (!latestRunId) {
    return (
      <div>
        <h2
          className="text-lg font-bold mb-4"
          style={{ color: "var(--sidebar-active)" }}
        >
          Coverage (Latest Run)
        </h2>
        {missingTables.length > 0 && (
          <div
            className="rounded p-3 mb-4 text-sm font-mono"
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
        )}
        <div
          className="rounded p-6 text-sm opacity-60"
          style={{ border: "1px solid var(--border-color)" }}
        >
          No coverage data found. The database may not exist yet — run{" "}
          <code className="font-mono">check_testcases.py</code> to populate it.
        </div>
      </div>
    );
  }

  const skillIds = getDistinctSkillIds(latestRunId);
  const matrixRows = getCoverageMatrix(latestRunId);
  const coverageTrend = getCoverageTrend(50);
  const previousRun = getPreviousRun(latestRunId);
  const heroCoverageDeltas = previousRun
    ? getHeroCoverageDeltas(latestRunId, previousRun.id)
    : [];
  const heroDeltaMap = new Map(
    heroCoverageDeltas.map((d) => [d.hero, d])
  );

  // Build lookup: hero -> skill_id -> CoverageSnapshot
  const lookup = new Map<string, Map<string, CoverageSnapshot>>();
  for (const row of matrixRows) {
    if (!lookup.has(row.hero)) {
      lookup.set(row.hero, new Map());
    }
    lookup.get(row.hero)!.set(row.skill_id, row);
  }

  // Only show heroes that have at least one coverage entry AND exist in the heroes table
  const heroesWithData = heroes.filter((h) => lookup.has(h.name));

  // Coverage stats scoped to heroes present in the heroes table.
  // This avoids a misleading % when coverage_snapshots has data but the heroes
  // table is missing or empty (heroesWithData would be []).
  const heroSet = new Set(heroesWithData.map((h) => h.name));
  const filteredRows = matrixRows.filter((r) => heroSet.has(r.hero));
  const totalCells = filteredRows.length;
  const coveredCells = filteredRows.filter((r) => r.covered_bool === 1).length;
  const coveragePct =
    totalCells > 0 ? Math.round((coveredCells / totalCells) * 100) : null;

  // Gap warning: compare testcase count per hero vs previous run
  let showGapWarning = false;
  if (previousRun) {
    const currentKeys = getRunTestcaseKeys(latestRunId);
    const previousKeys = getRunTestcaseKeys(previousRun.id);

    // Count testcases per hero (by file prefix)
    const countByHero = (
      keys: { file: string; testcase_id: string; idx: number }[]
    ) => {
      const counts = new Map<string, number>();
      for (const k of keys) {
        // Use hero names from the heroes list to match against file path
        for (const h of heroes) {
          if (k.file.toLowerCase().includes(h.name.toLowerCase())) {
            counts.set(h.name, (counts.get(h.name) ?? 0) + 1);
            break;
          }
        }
      }
      return counts;
    };

    const currentCounts = countByHero(currentKeys);
    const previousCounts = countByHero(previousKeys);

    for (const [hero, count] of currentCounts) {
      if (previousCounts.get(hero) !== count) {
        showGapWarning = true;
        break;
      }
    }
    if (!showGapWarning) {
      for (const [hero, count] of previousCounts) {
        if (currentCounts.get(hero) !== count) {
          showGapWarning = true;
          break;
        }
      }
    }
  }

  return (
    <div>
      <h2
        className="text-lg font-bold mb-4"
        style={{ color: "var(--sidebar-active)" }}
      >
        Coverage (Latest Run)
      </h2>

      {missingTables.length > 0 && (
        <div
          className="rounded p-3 mb-4 text-sm font-mono"
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
      )}

      {showGapWarning && (
        <div
          className="rounded p-3 mb-4 text-sm font-mono"
          style={{
            border: "1px solid #f9e2af",
            backgroundColor: "rgba(249,226,175,0.08)",
            color: "#f9e2af",
          }}
        >
          Warning: testcase set changed since previous run
        </div>
      )}

      <CoverageTrendChart data={coverageTrend} />

      {matrixRows.length === 0 ? (
        <div
          className="rounded p-6 text-sm opacity-60"
          style={{ border: "1px solid var(--border-color)" }}
        >
          No coverage data found. Run{" "}
          <code className="font-mono">check_testcases.py</code> to populate it.
        </div>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap gap-4">
            <StatCard label="Total Skills" value={String(skillIds.length)} />
            <StatCard label="Covered" value={String(coveredCells)} />
            <StatCard
              label="Coverage"
              value={coveragePct != null ? `${coveragePct}%` : "—"}
            />
            <StatCard label="Heroes" value={String(heroesWithData.length)} />
          </div>

          {/* Legend */}
          <div className="flex gap-4 mb-3 text-xs opacity-60">
            <span className="flex items-center gap-1">
              <span
                className="inline-block w-3 h-3 rounded-sm"
                style={{ backgroundColor: "#a6e3a1" }}
              />
              Covered
            </span>
            <span className="flex items-center gap-1">
              <span
                className="inline-block w-3 h-3 rounded-sm"
                style={{ backgroundColor: "#f38ba8" }}
              />
              Not covered
            </span>
            <span className="flex items-center gap-1">
              <span
                className="inline-block w-3 h-3 rounded-sm"
                style={{ backgroundColor: "var(--border-color)" }}
              />
              No data
            </span>
          </div>

          {/* Matrix */}
          <div className="overflow-x-auto">
            <table
              className="border-collapse text-xs font-mono"
              style={{ borderColor: "var(--border-color)" }}
            >
              <thead>
                <tr>
                  {/* Hero name column header */}
                  <th
                    className="pb-2 pr-2 text-left text-xs uppercase tracking-wider opacity-50 sticky left-0"
                    style={{ backgroundColor: "var(--main-bg)" }}
                  >
                    Hero
                  </th>
                  <th
                    className="pb-2 pr-2 text-left text-xs uppercase tracking-wider opacity-50"
                    style={{ minWidth: 32 }}
                  >
                    Gen
                  </th>
                  {skillIds.map((sid) => (
                    <th
                      key={sid}
                      title={sid}
                      className="pb-2 px-0.5 text-center opacity-40"
                      style={{
                        minWidth: 24,
                        maxWidth: 32,
                        writingMode: "vertical-rl",
                        transform: "rotate(180deg)",
                        height: 80,
                        verticalAlign: "bottom",
                      }}
                    >
                      {sid}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heroesWithData.map((hero) => {
                  const heroMap = lookup.get(hero.name)!;
                  const delta = heroDeltaMap.get(hero.name);
                  return (
                    <tr
                      key={hero.name}
                      style={{ borderBottom: "1px solid var(--border-color)" }}
                    >
                      <td
                        className="py-1 pr-3 sticky left-0 font-mono text-xs"
                        style={{ backgroundColor: "var(--main-bg)" }}
                      >
                        <span className="flex items-center gap-1">
                          {hero.name}
                          {delta && (
                            <span
                              className="text-xs font-mono px-1 rounded"
                              style={{
                                fontSize: 9,
                                backgroundColor:
                                  delta.delta_skills > 0
                                    ? "rgba(166,227,161,0.2)"
                                    : delta.delta_skills < 0
                                    ? "rgba(243,139,168,0.2)"
                                    : "rgba(249,226,175,0.2)",
                                color:
                                  delta.delta_skills > 0
                                    ? "#a6e3a1"
                                    : delta.delta_skills < 0
                                    ? "#f38ba8"
                                    : "#f9e2af",
                                border: "1px solid currentColor",
                                lineHeight: "1.4",
                              }}
                              title={`Δ vs prev run: ${delta.delta_skills > 0 ? "+" : ""}${delta.delta_skills} skill${Math.abs(delta.delta_skills) !== 1 ? "s" : ""}, ${delta.delta_testcases > 0 ? "+" : ""}${delta.delta_testcases} tc`}
                            >
                              {delta.delta_skills > 0 ? "+" : ""}
                              {delta.delta_skills}s
                              {delta.delta_testcases !== 0
                                ? ` ${delta.delta_testcases > 0 ? "+" : ""}${delta.delta_testcases}tc`
                                : ""}
                            </span>
                          )}
                        </span>
                      </td>
                      <td
                        className="py-1 pr-3 text-xs opacity-50"
                        style={{ minWidth: 32 }}
                      >
                        {hero.generation}
                      </td>
                      {skillIds.map((sid) => {
                        const snap = heroMap.get(sid);
                        if (!snap) {
                          return (
                            <td key={sid} className="py-1 px-0.5 text-center">
                              <span
                                className="inline-block w-4 h-4 rounded-sm"
                                style={{
                                  backgroundColor: "var(--border-color)",
                                  opacity: 0.3,
                                }}
                                title={`${hero.name} / ${sid}: no data`}
                              />
                            </td>
                          );
                        }
                        const covered = snap.covered_bool === 1;
                        return (
                          <td key={sid} className="py-1 px-0.5 text-center">
                            <span
                              className="inline-block w-4 h-4 rounded-sm"
                              style={{
                                backgroundColor: covered
                                  ? "#a6e3a1"
                                  : "#f38ba8",
                              }}
                              title={`${hero.name} / ${sid}: ${covered ? "covered" : "not covered"} (${snap.testcase_count} tc, ${snap.battle_outcome_count} battles)`}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
