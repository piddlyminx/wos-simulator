import Link from "next/link";
import { getRuns, getRunTrend } from "@/lib/db";
import type { Run } from "@/types/dashboard";
import RunsTrendChart from "@/components/RunsTrendChart";

export const dynamic = "force-dynamic";

function formatDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function PassBadge({ passes }: { passes: boolean }) {
  return (
    <span
      className="inline-block px-2 py-0.5 rounded text-xs font-mono font-bold"
      style={{
        backgroundColor: passes ? "#a6e3a1" : "#f38ba8",
        color: "#1e1e2e",
      }}
    >
      {passes ? "PASS" : "FAIL"}
    </span>
  );
}

export default function RunsPage() {
  const runs: Run[] = getRuns(50);
  const trendData = getRunTrend(50);

  return (
    <div>
      <h2
        className="text-lg font-bold mb-4"
        style={{ color: "var(--sidebar-active)" }}
      >
        Simulator Runs
      </h2>

      <RunsTrendChart data={trendData} />

      {runs.length === 0 ? (
        <div
          className="rounded p-6 text-sm opacity-60"
          style={{ border: "1px solid var(--border-color)" }}
        >
          No runs found. The database may not exist yet — run{" "}
          <code className="font-mono">check_testcases.py</code> to populate it.
        </div>
      ) : (
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
                <th className="pb-2 pr-4">Started</th>
                <th className="pb-2 pr-4">Git SHA</th>
                <th className="pb-2 pr-4">Avg Error %</th>
                <th className="pb-2 pr-4">BH Sig</th>
                <th className="pb-2 pr-4">Dirty</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                let summary: { all_pass?: boolean } = {};
                try {
                  summary = JSON.parse(run.summary_json ?? "{}");
                } catch {
                  // ignore
                }
                return (
                  <tr
                    key={run.id}
                    className="transition-colors"
                    style={{ borderBottom: "1px solid var(--border-color)" }}
                  >
                    <td className="py-2 pr-4 font-mono text-xs">
                      <Link
                        href={"/runs/" + run.id}
                        style={{ color: "var(--sidebar-active)" }}
                        className="hover:underline"
                      >
                        {formatDate(run.started_at)}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs opacity-70">
                      {run.git_sha?.slice(0, 8) ?? "—"}
                    </td>
                    <td className="py-2 pr-4 font-mono">
                      {run.overall_avg_error_pct != null
                        ? `${run.overall_avg_error_pct.toFixed(2)}%`
                        : "—"}
                    </td>
                    <td className="py-2 pr-4 font-mono">
                      {run.bh_sig_count ?? "—"}
                    </td>
                    <td className="py-2 pr-4">
                      {run.dirty ? (
                        <span className="text-xs opacity-70">dirty</span>
                      ) : (
                        <span className="text-xs opacity-40">clean</span>
                      )}
                    </td>
                    <td className="py-2">
                      <PassBadge passes={summary.all_pass ?? false} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
