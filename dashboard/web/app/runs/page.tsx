import { getRunsWithDelta, getRunTrendWithBH, getTestcaseBiasTrend } from "@/lib/db";
import RunsHeadlineChart from "@/components/RunsHeadlineChart";
import RunsAccordionTable from "@/components/RunsAccordionTable";
import TestcaseDriftChart from "@/components/TestcaseDriftChart";
import CheckNowControls from "@/components/CheckNowControls";

export const dynamic = "force-dynamic";

export default function RunsPage() {
  const runs = getRunsWithDelta(50);
  const trendData = getRunTrendWithBH(50);
  const trendRows = getTestcaseBiasTrend(50);

  return (
    <div>
      <h2
        className="text-lg font-bold mb-4"
        style={{ color: "var(--sidebar-active)" }}
      >
        Simulator Runs
      </h2>

      <CheckNowControls />

      <RunsHeadlineChart data={trendData} />

      <TestcaseDriftChart rows={trendRows} />

      {runs.length === 0 ? (
        <div
          className="rounded p-6 text-sm opacity-60"
          style={{ border: "1px solid var(--border-color)" }}
        >
          No historical runs found. Use the button above to generate a current
          simulator run report, or backfill the database for older run history.
        </div>
      ) : (
        <RunsAccordionTable runs={runs} defaultOpen={true} />
      )}
    </div>
  );
}
