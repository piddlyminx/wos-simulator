import MetricCard from "@/components/MetricCard";
import type { ParitySummary } from "@/lib/parity-reports";

export default function ParityReportSummary({
  summary,
}: {
  summary: ParitySummary;
}) {
  return (
    <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      <MetricCard label="Files" value={String(summary.filesFound)} />
      <MetricCard label="Testcases" value={String(summary.testcasesFound)} />
      <MetricCard label="Executed" value={String(summary.executedCases)} />
      <MetricCard
        label="Warnings"
        value={String(summary.warnings)}
        color={summary.warnings > 0 ? "#f9e2af" : undefined}
      />
      <MetricCard
        label="Errors"
        value={String(summary.errors)}
        color={summary.errors > 0 ? "#f38ba8" : undefined}
      />
      <MetricCard label="Compared Baseline" value={String(summary.comparedToBaseline)} />
      <MetricCard
        label="Compared Game"
        value={String(summary.comparedToGame)}
      />
      <MetricCard
        label="Simulator vs Baseline Fail"
        value={String(summary.simulatorVsBaselineFailures)}
        color={summary.simulatorVsBaselineFailures > 0 ? "#f38ba8" : "#a6e3a1"}
      />
      <MetricCard
        label="Simulator vs Game Fail"
        value={String(summary.simulatorVsGameFailures)}
        color={summary.simulatorVsGameFailures > 0 ? "#f38ba8" : "#a6e3a1"}
      />
    </div>
  );
}
