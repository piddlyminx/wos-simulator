import {
  getHeroes,
  getLatestRunId,
  getDistinctSkillIds,
  getCoverageMatrix,
  getPreviousRun,
  getRunTestcaseKeys,
} from "@/lib/db";
import type { CoverageSnapshot } from "@/types/dashboard";

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

  // Build lookup: hero -> skill_id -> CoverageSnapshot
  const lookup = new Map<string, Map<string, CoverageSnapshot>>();
  for (const row of matrixRows) {
    if (!lookup.has(row.hero)) {
      lookup.set(row.hero, new Map());
    }
    lookup.get(row.hero)!.set(row.skill_id, row);
  }

  // Summary stats
  const totalCells = matrixRows.length;
  const coveredCells = matrixRows.filter((r) => r.covered_bool === 1).length;
  const coveragePct =
    totalCells > 0 ? Math.round((coveredCells / totalCells) * 100) : null;

  // Gap warning: compare testcase count per hero vs previous run
  let showGapWarning = false;
  const previousRun = getPreviousRun(latestRunId);
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

  // Only show heroes that have at least one coverage entry
  const heroesWithData = heroes.filter((h) => lookup.has(h.name));

  return (
    <div>
      <h2
        className="text-lg font-bold mb-4"
        style={{ color: "var(--sidebar-active)" }}
      >
        Coverage (Latest Run)
      </h2>

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
                    Tier
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
                  return (
                    <tr
                      key={hero.name}
                      style={{ borderBottom: "1px solid var(--border-color)" }}
                    >
                      <td
                        className="py-1 pr-3 sticky left-0 font-mono text-xs"
                        style={{ backgroundColor: "var(--main-bg)" }}
                      >
                        {hero.name}
                      </td>
                      <td
                        className="py-1 pr-3 text-xs opacity-50"
                        style={{ minWidth: 32 }}
                      >
                        {hero.tier}
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
