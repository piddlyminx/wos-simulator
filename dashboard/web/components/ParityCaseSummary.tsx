import type {
  ParityCaseReport,
  ParityComparisonRow,
  ParityMetric,
} from "@/lib/parity-reports";

function fmt(value: number | null | undefined, digits = 2): string {
  return Number.isFinite(value) ? value!.toFixed(digits) : "-";
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre
      className="overflow-x-auto rounded p-3 text-xs"
      style={{
        backgroundColor: "var(--sidebar-bg)",
        border: "1px solid var(--border-color)",
      }}
    >
      {JSON.stringify(value ?? null, null, 2)}
    </pre>
  );
}

export default function ParityCaseSummary({
  row,
  caseReport,
}: {
  row: ParityComparisonRow;
  caseReport?: ParityCaseReport;
}) {
  const attacks = caseReport?.result?.attacks ?? [];
  const v3 = row.game ?? row.v1;
  const v3Mu = v3?.mu_candidate ?? caseReport?.v3Stats?.mu;
  const deterministic = row.deterministic ?? caseReport?.deterministic;
  const sampleCount = row.sampleCount ?? caseReport?.sampleCount;
  return (
    <div className="space-y-6">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Summary label="v3 mu" value={fmt(v3Mu)} />
        <Summary label="v1 mu" value={fmt(row.v1?.mu_reference)} />
        <Summary label="game mu" value={fmt(row.game?.mu_reference)} />
        <Summary label="v3 vs v1 stat" value={fmt(row.v1?.stat)} />
        <Summary label="v3 vs game stat" value={fmt(row.game?.stat)} />
        <Summary label="v3 vs v1 bias%" value={fmt(row.v1?.bias_pct)} />
        <Summary label="v3 vs game bias%" value={fmt(row.game?.bias_pct)} />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-bold">V3 Sample Metadata</h3>
        <JsonBlock
          value={{
            deterministic,
            sampleCount,
            game: row.game,
            v1: row.v1,
            v3Stats: caseReport?.v3Stats ?? metricToV3Stats(v3),
            v3ScoreDelta: caseReport?.v3ScoreDelta ?? row.v3ScoreDelta,
          }}
        />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-bold">Visibility</h3>
        <JsonBlock value={caseReport?.visibility} />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-bold">Final Stored Result</h3>
        <JsonBlock
          value={{
            winner: caseReport?.result?.winner,
            rounds: caseReport?.result?.rounds,
            remaining: caseReport?.result?.remaining,
          }}
        />
      </section>

      {(caseReport?.diagnostics?.length || caseReport?.error) && (
        <section>
          <h3 className="mb-2 text-sm font-bold">Diagnostics</h3>
          <JsonBlock
            value={{
              error: caseReport?.error,
              diagnostics: caseReport?.diagnostics,
            }}
          />
        </section>
      )}

      <details>
        <summary className="cursor-pointer text-sm font-bold">
          Stored run attacks ({attacks.length})
        </summary>
        <p className="my-2 text-xs opacity-60">
          This is the single detailed result stored in the report, not every
          repeat used to compute v3Stats.
        </p>
        <JsonBlock value={attacks} />
      </details>
    </div>
  );
}

function metricToV3Stats(metric: ParityMetric | null) {
  if (!metric) return undefined;
  return {
    n: metric.n_candidate,
    mu: metric.mu_candidate,
    sigma: metric.sigma_candidate,
    sem: metric.sem,
  };
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded p-3"
      style={{
        backgroundColor: "var(--sidebar-bg)",
        border: "1px solid var(--border-color)",
      }}
    >
      <div className="text-[11px] uppercase tracking-wider opacity-50">
        {label}
      </div>
      <div
        className="font-mono text-lg font-bold"
        style={{ color: "var(--sidebar-active)" }}
      >
        {value}
      </div>
    </div>
  );
}
