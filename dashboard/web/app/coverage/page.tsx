import { getCoverageSnapshots, getHeroes } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function CoveragePage() {
  const heroes = getHeroes();
  const snapshots = getCoverageSnapshots("latest");

  const totalSkills = snapshots.length;
  const coveredSkills = snapshots.filter((s) => s.covered_bool === 1).length;
  const coveragePct =
    totalSkills > 0
      ? Math.round((coveredSkills / totalSkills) * 100)
      : null;

  return (
    <div>
      <h2
        className="text-lg font-bold mb-4"
        style={{ color: "var(--sidebar-active)" }}
      >
        Coverage (Latest Run)
      </h2>

      {snapshots.length === 0 ? (
        <div
          className="rounded p-6 text-sm opacity-60"
          style={{ border: "1px solid var(--border-color)" }}
        >
          No coverage data found. The database may not exist yet — run{" "}
          <code className="font-mono">check_testcases.py</code> to populate it.
        </div>
      ) : (
        <>
          <div className="mb-6 flex gap-6">
            <StatCard label="Total Skills" value={String(totalSkills)} />
            <StatCard label="Covered" value={String(coveredSkills)} />
            <StatCard
              label="Coverage"
              value={coveragePct != null ? `${coveragePct}%` : "—"}
            />
            <StatCard label="Heroes" value={String(heroes.length)} />
          </div>

          <div className="overflow-x-auto">
            <table
              className="w-full text-sm border-collapse"
              style={{ borderColor: "var(--border-color)" }}
            >
              <thead>
                <tr
                  className="text-left text-xs uppercase tracking-wider opacity-60"
                  style={{ borderBottom: "1px solid var(--border-color)" }}
                >
                  <th className="pb-2 pr-4">Hero</th>
                  <th className="pb-2 pr-4">Tier</th>
                  <th className="pb-2 pr-4">Skill ID</th>
                  <th className="pb-2 pr-4">Testcases</th>
                  <th className="pb-2 pr-4">Battles</th>
                  <th className="pb-2">Covered</th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map((s) => (
                  <tr
                    key={`${s.run_id}-${s.hero}-${s.skill_id}`}
                    style={{ borderBottom: "1px solid var(--border-color)" }}
                  >
                    <td className="py-2 pr-4 font-mono text-xs">{s.hero}</td>
                    <td className="py-2 pr-4 text-xs opacity-70">
                      {s.hero_tier ?? "—"}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs opacity-70">
                      {s.skill_id}
                    </td>
                    <td className="py-2 pr-4 font-mono">{s.testcase_count}</td>
                    <td className="py-2 pr-4 font-mono">
                      {s.battle_outcome_count}
                    </td>
                    <td className="py-2">
                      <span
                        className="inline-block w-2 h-2 rounded-full"
                        style={{
                          backgroundColor:
                            s.covered_bool === 1 ? "#a6e3a1" : "#f38ba8",
                        }}
                        title={s.covered_bool === 1 ? "covered" : "not covered"}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

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
