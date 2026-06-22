import Link from "next/link";
import ParityCaseSummary from "@/components/ParityCaseSummary";
import { getRun } from "@/lib/db";
import { findRunReportForRun, getParityReportCase } from "@/lib/parity-reports";

export const dynamic = "force-dynamic";

export default async function RunCasePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ file?: string; testcaseId?: string; idx?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const run = getRun(id);
  const report = run ? findRunReportForRun(run) : undefined;
  const idx = Number(query.idx ?? "0");
  const detail =
    report && query.file && query.testcaseId && Number.isFinite(idx)
      ? getParityReportCase(report.id, {
          file: query.file,
          testcaseId: query.testcaseId,
          idx,
        })
      : undefined;

  if (!run || !report || !detail) {
    return (
      <div>
        <Back runId={id} />
        <div
          className="rounded p-6 text-sm opacity-70"
          style={{ border: "1px solid var(--border-color)" }}
        >
          Run testcase detail not found. This run may not have a retained run
          report artifact.
        </div>
      </div>
    );
  }

  return (
    <div>
      <Back runId={id} />
      <h2
        className="mb-1 text-lg font-bold"
        style={{ color: "var(--sidebar-active)" }}
      >
        {detail.row.testcaseId}
      </h2>
      <p className="mb-1 font-mono text-xs opacity-50">
        {detail.row.file} :: idx {detail.row.idx}
      </p>
      <p className="mb-6 font-mono text-xs opacity-40">
        Run {run.id.slice(0, 8)} :: {report.fileName}
      </p>
      <ParityCaseSummary row={detail.row} caseReport={detail.case} />
    </div>
  );
}

function Back({ runId }: { runId: string }) {
  return (
    <Link
      href={`/runs/${encodeURIComponent(runId)}`}
      className="mb-4 inline-block text-xs opacity-60 hover:opacity-100"
      style={{ color: "var(--sidebar-active)" }}
    >
      &larr; Back to Run
    </Link>
  );
}
