import Link from "next/link";
import { getTestcaseFileIndex } from "@/lib/db";
import TestcaseFileIndexTable from "@/components/TestcaseFileIndexTable";

export const dynamic = "force-dynamic";

export default function TestcasesIndexPage() {
  const rows = getTestcaseFileIndex();

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <h2
          className="text-lg font-bold"
          style={{ color: "var(--sidebar-active)" }}
        >
          Testcases
        </h2>
        <Link
          href="/testcases/changelog"
          className="text-xs underline hover:opacity-80"
          style={{ color: "var(--sidebar-active)" }}
        >
          Changelog →
        </Link>
      </div>
      <p className="text-sm opacity-60 mb-6 max-w-3xl">
        Every testcase file the simulator has executed. Click a row to see
        army composition, expected battle reports, historical accuracy, and
        statistical test details for that testcase.
      </p>

      {rows.length === 0 ? (
        <div
          className="rounded p-6 text-sm opacity-60"
          style={{ border: "1px solid var(--border-color)" }}
        >
          No testcase history recorded. Run{" "}
          <code className="font-mono">check_testcases.py</code> with the
          dashboard ingestion enabled to populate the DB.
        </div>
      ) : (
        <TestcaseFileIndexTable rows={rows} />
      )}
    </div>
  );
}
