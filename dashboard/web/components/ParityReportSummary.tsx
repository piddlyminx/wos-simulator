import MetricCard from "@/components/MetricCard";
import type { ParitySummary } from "@/lib/parity-reports";

export default function ParityReportSummary({
  summary,
}: {
  summary: ParitySummary;
}) {
  return (
    <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Selected" value={String(summary.selectedCases)} />
      <MetricCard label="Executed" value={String(summary.executedCases)} />
      <MetricCard label="Matched" value={String(summary.matchedRows)} />
      <MetricCard
        label="Unmatched"
        value={String(summary.unmatchedRows)}
        color={summary.unmatchedRows > 0 ? "#f9e2af" : undefined}
      />
      <MetricCard
        label="V3 vs V1 Fail"
        value={String(summary.v3VsV1Failures)}
        color={summary.v3VsV1Failures > 0 ? "#f38ba8" : "#a6e3a1"}
      />
      <MetricCard
        label="V3 vs Game Fail"
        value={String(summary.v3VsGameFailures)}
        color={summary.v3VsGameFailures > 0 ? "#f38ba8" : "#a6e3a1"}
      />
      <MetricCard
        label="Parse Errors"
        value={String(summary.parseErrors)}
        color={summary.parseErrors > 0 ? "#f38ba8" : undefined}
      />
      <MetricCard
        label="Diagnostics"
        value={String(summary.diagnostics)}
        color={summary.diagnostics > 0 ? "#f9e2af" : undefined}
      />
    </div>
  );
}
