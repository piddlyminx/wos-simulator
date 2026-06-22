import Link from "next/link";
import ParityCaseSummary from "@/components/ParityCaseSummary";
import { getParityReportCase } from "@/lib/parity-reports";

export const dynamic = "force-dynamic";

export default async function ParityCasePage({
  params,
  searchParams,
}: {
  params: Promise<{ reportId: string }>;
  searchParams: Promise<{ file?: string; testcaseId?: string; idx?: string }>;
}) {
  const { reportId } = await params;
  const query = await searchParams;
  const idx = Number(query.idx ?? "0");
  const detail =
    query.file && query.testcaseId && Number.isFinite(idx)
      ? getParityReportCase(reportId, {
          file: query.file,
          testcaseId: query.testcaseId,
          idx,
        })
      : undefined;

  if (!detail) {
    return (
      <div>
        <Back reportId={reportId} />
        <div
          className="rounded p-6 text-sm opacity-70"
          style={{ border: "1px solid var(--border-color)" }}
        >
          Run report testcase row not found.
        </div>
      </div>
    );
  }

  return (
    <div>
      <Back reportId={reportId} />
      <h2
        className="mb-1 text-lg font-bold"
        style={{ color: "var(--sidebar-active)" }}
      >
        {detail.row.testcaseId}
      </h2>
      <p className="mb-6 font-mono text-xs opacity-50">
        {detail.row.file} :: idx {detail.row.idx}
      </p>
      <ParityCaseSummary row={detail.row} caseReport={detail.case} />
    </div>
  );
}

function Back({ reportId }: { reportId: string }) {
  return (
    <Link
      href={`/parity?report=${encodeURIComponent(reportId)}`}
      className="mb-4 inline-block text-xs opacity-60 hover:opacity-100"
      style={{ color: "var(--sidebar-active)" }}
    >
      &larr; Back to Run Reports
    </Link>
  );
}
