import zlib from "zlib";
import Link from "next/link";
import {
  getRun,
  getRunTestcases,
  getBlob,
  getPreviousRun,
  getRunTestcaseKeys,
} from "@/lib/db";
import TestcaseTable from "@/components/TestcaseTable";

export const dynamic = "force-dynamic";

function formatDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
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
        className="text-xl font-bold font-mono"
        style={{ color: "var(--sidebar-active)" }}
      >
        {value}
      </span>
    </div>
  );
}

function DiffLine({ line }: { line: string }) {
  let color = "inherit";
  if (line.startsWith("+")) color = "#a6e3a1";
  else if (line.startsWith("-")) color = "#f38ba8";
  else if (line.startsWith("@@")) color = "#89dceb";

  return (
    <div style={{ color }} className="font-mono text-xs leading-relaxed">
      {line}
    </div>
  );
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function RunDetailPage({ params }: PageProps) {
  const { id } = await params;
  const run = getRun(id);

  if (!run) {
    return (
      <div>
        <Link
          href="/runs"
          className="text-xs opacity-50 hover:opacity-100 mb-4 inline-block"
          style={{ color: "var(--sidebar-active)" }}
        >
          &larr; Back to Runs
        </Link>
        <div
          className="rounded p-6 text-sm opacity-60 mt-4"
          style={{ border: "1px solid var(--border-color)" }}
        >
          Run <code className="font-mono">{id}</code> not found.
        </div>
      </div>
    );
  }

  const testcases = getRunTestcases(id);
  const totalTestcases = testcases.length;
  const passingTestcases = testcases.filter((t) => t.passes === 1).length;

  // Diff blob decompression
  let patchText: string | null = null;
  if (run.dirty === 1 && run.patch_blob_id) {
    try {
      const blob = getBlob(run.patch_blob_id);
      if (blob?.content_gzip) {
        patchText = zlib.gunzipSync(blob.content_gzip).toString("utf8");
      }
    } catch (err) {
      console.error("[wos-dashboard] Failed to decompress patch blob:", err);
    }
  }

  // Testcase set diff vs previous run
  const previousRun = getPreviousRun(id);
  let addedKeys: { file: string; testcase_id: string; idx: number }[] = [];
  let removedKeys: { file: string; testcase_id: string; idx: number }[] = [];

  if (previousRun) {
    const currentKeys = getRunTestcaseKeys(id);
    const previousKeys = getRunTestcaseKeys(previousRun.id);

    const toStr = (k: { file: string; testcase_id: string; idx: number }) =>
      `${k.file}::${k.testcase_id}::${k.idx}`;

    const currentSet = new Set(currentKeys.map(toStr));
    const previousSet = new Set(previousKeys.map(toStr));

    addedKeys = currentKeys.filter((k) => !previousSet.has(toStr(k)));
    removedKeys = previousKeys.filter((k) => !currentSet.has(toStr(k)));
  }

  return (
    <div>
      <Link
        href="/runs"
        className="text-xs opacity-50 hover:opacity-100 mb-4 inline-block"
        style={{ color: "var(--sidebar-active)" }}
      >
        &larr; Back to Runs
      </Link>

      <h2
        className="text-lg font-bold mb-1"
        style={{ color: "var(--sidebar-active)" }}
      >
        Run Detail
      </h2>
      <p className="text-xs font-mono opacity-40 mb-6">{run.id}</p>

      {/* Stat cards */}
      <div className="flex flex-wrap gap-4 mb-8">
        <StatCard label="Started" value={formatDate(run.started_at)} />
        <StatCard
          label="Git SHA"
          value={run.git_sha?.slice(0, 8) ?? "—"}
        />
        <StatCard
          label="State"
          value={run.dirty === 1 ? "dirty" : "clean"}
        />
        <StatCard
          label="Avg Error %"
          value={
            run.overall_avg_error_pct != null
              ? `${run.overall_avg_error_pct.toFixed(2)}%`
              : "—"
          }
        />
        <StatCard
          label="BH Sig Count"
          value={String(run.bh_sig_count ?? "—")}
        />
        <StatCard label="Total Cases" value={String(totalTestcases)} />
        <StatCard label="Passing" value={String(passingTestcases)} />
      </div>

      {/* Testcase set diff vs previous run */}
      {previousRun && (addedKeys.length > 0 || removedKeys.length > 0) && (
        <div
          className="rounded p-4 mb-6 text-sm"
          style={{
            border: "1px solid var(--border-color)",
            backgroundColor: "var(--sidebar-bg)",
          }}
        >
          <h3 className="font-bold mb-2 text-xs uppercase tracking-wider opacity-60">
            Testcase Set Diff vs Previous Run
          </h3>
          {addedKeys.length > 0 && (
            <div className="mb-2">
              <span
                className="text-xs font-bold"
                style={{ color: "#a6e3a1" }}
              >
                + Added ({addedKeys.length})
              </span>
              <ul className="mt-1 font-mono text-xs opacity-70">
                {addedKeys.slice(0, 20).map((k, i) => (
                  <li key={i}>
                    {k.file} :: {k.testcase_id} :: {k.idx}
                  </li>
                ))}
                {addedKeys.length > 20 && (
                  <li className="opacity-50">
                    … and {addedKeys.length - 20} more
                  </li>
                )}
              </ul>
            </div>
          )}
          {removedKeys.length > 0 && (
            <div>
              <span
                className="text-xs font-bold"
                style={{ color: "#f38ba8" }}
              >
                - Removed ({removedKeys.length})
              </span>
              <ul className="mt-1 font-mono text-xs opacity-70">
                {removedKeys.slice(0, 20).map((k, i) => (
                  <li key={i}>
                    {k.file} :: {k.testcase_id} :: {k.idx}
                  </li>
                ))}
                {removedKeys.length > 20 && (
                  <li className="opacity-50">
                    … and {removedKeys.length - 20} more
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Diff viewer */}
      {patchText && (
        <div
          className="rounded p-4 mb-8 overflow-x-auto"
          style={{
            border: "1px solid var(--border-color)",
            backgroundColor: "var(--sidebar-bg)",
          }}
        >
          <h3 className="font-bold mb-3 text-xs uppercase tracking-wider opacity-60">
            Dirty State Patch
          </h3>
          <pre className="text-xs leading-relaxed overflow-x-auto whitespace-pre">
            {patchText.split("\n").map((line, i) => (
              <DiffLine key={i} line={line} />
            ))}
          </pre>
        </div>
      )}

      {/* Testcase table */}
      <div>
        <h3
          className="font-bold mb-4 text-sm"
          style={{ color: "var(--sidebar-active)" }}
        >
          Testcases
        </h3>
        <TestcaseTable testcases={testcases} />
      </div>
    </div>
  );
}
