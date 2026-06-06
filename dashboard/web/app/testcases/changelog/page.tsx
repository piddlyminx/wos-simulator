import { getTestcaseChangelog } from "@/lib/db";
import TestcaseChangelogTable from "@/components/TestcaseChangelogTable";

export const dynamic = "force-dynamic";

export default function TestcasesChangelogPage() {
  const rows = getTestcaseChangelog();

  return (
    <div>
      <h2
        className="text-lg font-bold mb-2"
        style={{ color: "var(--sidebar-active)" }}
      >
        Testcase Changelog
      </h2>
      <p className="text-sm opacity-60 mb-6 max-w-3xl">
        Cross-run lifecycle for every testcase file. Retired rows are files
        that were present in an earlier run but missing from the most recent
        one. &quot;Last modified&quot; is the most recent run where the file&apos;s
        sha256 changed.
      </p>

      {rows.length === 0 ? (
        <div
          className="rounded p-6 text-sm opacity-60"
          style={{ border: "1px solid var(--border-color)" }}
        >
          No testcase file history recorded. Backfill historical runs to populate{" "}
          <code className="font-mono">run_testcase_files</code>.
        </div>
      ) : (
        <TestcaseChangelogTable rows={rows} />
      )}
    </div>
  );
}
