import Link from "next/link";
import { getTestcaseFileHistory, getTestcaseFileMeta } from "@/lib/db";
import {
  readTestcaseFile,
  testcaseDetailHref,
  testcaseFileFromPath,
  type RawTestcase,
  type TestcaseArmy,
  type TestcaseBattleResult,
} from "@/lib/testcase-file";
import { formatStatAdjustment, statAdjustmentTitle } from "@/lib/stat-adjustment";
import type { TestcaseFileHistoryRow } from "@/types/dashboard";
import TestcaseHistoryChart from "@/components/TestcaseHistoryChart";
import MetricCard from "@/components/MetricCard";

const stickyTh =
  "sticky top-0 z-10 bg-[var(--sidebar-bg)] px-1.5 py-1 text-left";
const compactTd = "px-1.5 py-1";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ path: string[] }>;
  searchParams: Promise<{ tc?: string }>;
}

function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return iso;
  }
}

function fileBasename(p: string): string {
  return p.replace(/^testcases\/(emulator_verified\/)?/, "").replace(/\.json$/, "");
}

function heroesSummary(heroes: TestcaseArmy["heroes"]): string {
  if (!heroes) return "—";
  const keys = Object.keys(heroes);
  if (keys.length === 0) return "(none)";
  return keys.join(", ");
}

function ArmyBlock({
  title,
  army,
  color,
}: {
  title: string;
  army: TestcaseArmy | undefined;
  color: string;
}) {
  if (!army) {
    return (
      <div
        className="rounded p-4"
        style={{
          border: "1px solid var(--border-color)",
          backgroundColor: "var(--sidebar-bg)",
        }}
      >
        <h4 className="text-xs uppercase tracking-wider opacity-60 mb-2">
          {title}
        </h4>
        <p className="text-xs opacity-50">(no army data)</p>
      </div>
    );
  }
  const heroes = army.heroes ?? {};
  const troops = army.troops ?? {};
  const stats = army.stats ?? {};
  return (
    <div
      className="rounded p-4"
      style={{
        border: "1px solid var(--border-color)",
        backgroundColor: "var(--sidebar-bg)",
      }}
    >
      <h4
        className="text-xs uppercase tracking-wider opacity-70 mb-3"
        style={{ color }}
      >
        {title}
      </h4>
      {army.name && (
        <p className="text-xs font-mono opacity-70 mb-3">{army.name}</p>
      )}

      <div className="mb-3">
        <p className="text-[10px] uppercase tracking-wider opacity-50 mb-1">
          Heroes
        </p>
        {Object.keys(heroes).length === 0 ? (
          <p className="text-xs opacity-50">(no heroes)</p>
        ) : (
          <ul className="text-xs font-mono space-y-1">
            {Object.entries(heroes).map(([name, skills]) => {
              const skillStr = Object.entries(skills ?? {})
                .map(([s, lv]) => `${s.replace(/^skill_/, "s")}=${lv}`)
                .join(" / ");
              return (
                <li key={name}>
                  <Link
                    href={`/heroes/${encodeURIComponent(name)}`}
                    className="underline hover:opacity-80"
                    style={{ color: "var(--sidebar-active)" }}
                  >
                    {name}
                  </Link>
                  {skillStr && (
                    <span className="opacity-60 ml-2">{skillStr}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="mb-3">
        <p className="text-[10px] uppercase tracking-wider opacity-50 mb-1">
          Troops
        </p>
        {Object.keys(troops).length === 0 ? (
          <p className="text-xs opacity-50">(no troops)</p>
        ) : (
          <ul className="text-xs font-mono opacity-80 space-y-0.5">
            {Object.entries(troops).map(([k, v]) => (
              <li key={k}>
                {k}: {v}
              </li>
            ))}
          </ul>
        )}
      </div>

      {Object.keys(stats).length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider opacity-50 mb-1">
            Stats
          </p>
          <div className="overflow-x-auto">
            <table className="text-[10px] font-mono opacity-80">
              <thead>
                <tr className="opacity-60">
                  <th className="pr-3 text-left">Class</th>
                  <th className="pr-3 text-right">Atk</th>
                  <th className="pr-3 text-right">Def</th>
                  <th className="pr-3 text-right">Leth</th>
                  <th className="pr-3 text-right">Hp</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(stats).map(([cls, s]) => (
                  <tr key={cls}>
                    <td className="pr-3">{cls}</td>
                    <td className="pr-3 text-right">
                      {s?.attack?.toFixed(1) ?? "—"}
                    </td>
                    <td className="pr-3 text-right">
                      {s?.defense?.toFixed(1) ?? "—"}
                    </td>
                    <td className="pr-3 text-right">
                      {s?.lethality?.toFixed(1) ?? "—"}
                    </td>
                    <td className="pr-3 text-right">
                      {s?.health?.toFixed(1) ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function BattleResultsBlock({
  title,
  results,
}: {
  title: string;
  results: TestcaseBattleResult[] | TestcaseBattleResult | undefined;
}) {
  const arr = Array.isArray(results)
    ? results
    : results
    ? [results]
    : [];
  if (arr.length === 0) {
    return (
      <div
        className="rounded p-4"
        style={{
          border: "1px solid var(--border-color)",
          backgroundColor: "var(--sidebar-bg)",
        }}
      >
        <h4 className="text-xs uppercase tracking-wider opacity-60 mb-2">
          {title}
        </h4>
        <p className="text-xs opacity-50">(no results recorded)</p>
      </div>
    );
  }
  return (
    <div
      className="rounded p-4"
      style={{
        border: "1px solid var(--border-color)",
        backgroundColor: "var(--sidebar-bg)",
      }}
    >
      <h4 className="text-xs uppercase tracking-wider opacity-70 mb-3">
        {title}
      </h4>
      <div className="overflow-x-auto">
        <table className="text-xs font-mono">
          <thead>
            <tr className="opacity-50 uppercase tracking-wider">
              <th className="pr-4 text-left">#</th>
              <th className="pr-4 text-right">Attacker losses</th>
              <th className="pr-4 text-right">Defender losses</th>
            </tr>
          </thead>
          <tbody>
            {arr.map((r, i) => (
              <tr key={i}>
                <td className="pr-4 opacity-50">{i + 1}</td>
                <td className="pr-4 text-right">{r.attacker ?? "—"}</td>
                <td className="pr-4 text-right">{r.defender ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface TabEntry {
  idx: number;
  testcase_id: string;
  description: string;
  raw: RawTestcase | null;
  history: TestcaseFileHistoryRow[];
  latest: TestcaseFileHistoryRow | null;
}

export default async function TestcaseDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { path } = await params;
  const { tc } = await searchParams;
  const file = testcaseFileFromPath(path);

  const history = getTestcaseFileHistory(file);
  const meta = getTestcaseFileMeta(file);
  const raw = readTestcaseFile(file);

  // Build the per-tab groupings. Prefer the JSON file's array ordering when the
  // file is on disk (it determines the idx used downstream); fall back to the
  // distinct (testcase_id, idx) tuples observed in history for retired files.
  const tabs: TabEntry[] = [];
  if (raw) {
    raw.forEach((tc, i) => {
      const tcId = tc.test_id ?? "";
      const rows = history.filter(
        (h) => h.testcase_id === tcId && h.idx === i
      );
      const latest = rows.length > 0 ? rows[rows.length - 1] : null;
      tabs.push({
        idx: i,
        testcase_id: tcId,
        description: tc.description ?? "",
        raw: tc,
        history: rows,
        latest,
      });
    });
  } else {
    const seen = new Map<string, TabEntry>();
    for (const h of history) {
      const key = `${h.testcase_id}::${h.idx}`;
      if (!seen.has(key)) {
        seen.set(key, {
          idx: h.idx,
          testcase_id: h.testcase_id,
          description: "",
          raw: null,
          history: [],
          latest: null,
        });
      }
      const entry = seen.get(key)!;
      entry.history.push(h);
      entry.latest = h;
    }
    for (const t of Array.from(seen.values()).sort(
      (a, b) =>
        a.testcase_id.localeCompare(b.testcase_id) || a.idx - b.idx
    )) {
      tabs.push(t);
    }
  }

  if (tabs.length === 0) {
    return (
      <div>
        <Link
          href="/testcases"
          className="text-xs opacity-50 hover:opacity-100 mb-4 inline-block"
          style={{ color: "var(--sidebar-active)" }}
        >
          &larr; Back to Testcases
        </Link>
        <h2
          className="text-lg font-bold mb-2"
          style={{ color: "var(--sidebar-active)" }}
        >
          {fileBasename(file)}
        </h2>
        <p className="text-xs font-mono opacity-40 mb-6">{file}</p>
        <div
          className="rounded p-6 text-sm opacity-60"
          style={{ border: "1px solid var(--border-color)" }}
        >
          No testcase data found on disk or in the database for{" "}
          <code className="font-mono">{file}</code>.
        </div>
      </div>
    );
  }

  const activeIdxRaw = Number(tc);
  const activeIdx = Number.isFinite(activeIdxRaw) && activeIdxRaw >= 0 && activeIdxRaw < tabs.length
    ? Math.floor(activeIdxRaw)
    : 0;
  const active = tabs[activeIdx];

  const totalRunsSeen = new Set(history.map((h) => h.run_id)).size;
  const retired = meta?.retired === 1;

  return (
    <div>
      <Link
        href="/testcases"
        className="text-xs opacity-50 hover:opacity-100 mb-4 inline-block"
        style={{ color: "var(--sidebar-active)" }}
      >
        &larr; Back to Testcases
      </Link>

      <div className="mb-1 flex flex-wrap items-center gap-2 sm:gap-3">
        <h2
          className="text-lg font-bold"
          style={{ color: "var(--sidebar-active)" }}
        >
          {fileBasename(file)}
        </h2>
        <span
          className="inline-block px-1.5 py-0.5 rounded text-xs font-bold font-mono"
          style={{
            backgroundColor: retired ? "#f38ba8" : "#a6e3a1",
            color: "#1e1e2e",
          }}
        >
          {retired ? "retired" : "active"}
        </span>
        {!raw && (
          <span className="text-xs opacity-60 font-mono">
            (file not found on disk)
          </span>
        )}
      </div>
      <p className="text-xs font-mono opacity-40 mb-6">{file}</p>

      <div className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Testcases" value={String(tabs.length)} />
        <MetricCard label="Runs Seen" value={String(totalRunsSeen)} />
        <MetricCard label="First Seen" value={shortDate(meta?.first_seen_at)} />
        <MetricCard label="Last Seen" value={shortDate(meta?.last_seen_at)} />
      </div>

      {/* Tabs — only render when file has more than one testcase */}
      {tabs.length > 1 && (
        <div
          className="flex flex-wrap gap-1 mb-4 border-b"
          style={{ borderColor: "var(--border-color)" }}
        >
          {tabs.map((t, i) => (
            <Link
              key={i}
              href={`${testcaseDetailHref(file)}?tc=${i}`}
              scroll={false}
              className="px-3 py-2 text-xs font-mono rounded-t"
              style={{
                backgroundColor:
                  i === activeIdx ? "var(--sidebar-bg)" : "transparent",
                border:
                  i === activeIdx
                    ? "1px solid var(--border-color)"
                    : "1px solid transparent",
                borderBottom:
                  i === activeIdx ? "1px solid var(--sidebar-bg)" : "none",
                color:
                  i === activeIdx
                    ? "var(--sidebar-active)"
                    : "var(--sidebar-text)",
                opacity: i === activeIdx ? 1 : 0.6,
                marginBottom: "-1px",
              }}
            >
              [{i}] {t.testcase_id || "(no id)"}
            </Link>
          ))}
        </div>
      )}

      {/* Description */}
      {active.description && (
        <p className="text-sm opacity-80 mb-6 max-w-4xl">
          {active.description}
        </p>
      )}

      {/* Latest-run statistical fields */}
      <h3
        className="font-bold mb-3 text-sm"
        style={{ color: "var(--sidebar-active)" }}
      >
        Latest-Run Stats
      </h3>
      {active.latest ? (
        <div className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Pass"
            value={active.latest.passes === 1 ? "P" : "F"}
          />
          <MetricCard label="Test" value={active.latest.stat_type || "—"} />
          <MetricCard
            label="μ sim"
            value={active.latest.mu_sim?.toFixed(4) ?? "—"}
          />
          <MetricCard
            label="μ game"
            value={active.latest.mu_game?.toFixed(4) ?? "—"}
          />
          <MetricCard
            label="bias %"
            value={
              active.latest.bias_pct != null
                ? `${active.latest.bias_pct.toFixed(2)}%`
                : "—"
            }
          />
          <MetricCard label="n sim" value={String(active.latest.n_sim ?? "—")} />
          <MetricCard
            label="n game"
            value={String(active.latest.n_game ?? "—")}
          />
          <MetricCard
            label="t"
            value={active.latest.t != null ? active.latest.t.toFixed(3) : "—"}
          />
          <MetricCard
            label="q"
            value={active.latest.q != null ? active.latest.q.toFixed(4) : "—"}
          />
          <MetricCard
            label="Waived"
            value={active.latest.waived_bool === 1 ? "yes" : "no"}
          />
        </div>
      ) : (
        <p className="text-xs opacity-50 mb-8">
          No testcase row in the latest run for this testcase.
        </p>
      )}

      {/* Bias % history */}
      {active.history.length > 1 && (
        <div
          className="rounded p-4 mb-8"
          style={{
            border: "1px solid var(--border-color)",
            backgroundColor: "var(--sidebar-bg)",
          }}
        >
          <h3 className="font-bold mb-3 text-xs uppercase tracking-wider opacity-60">
            Bias % Over Time
          </h3>
          <TestcaseHistoryChart points={active.history} />
        </div>
      )}

      {/* Army compositions + expected battle reports from the raw JSON */}
      {active.raw && (
        <>
          <h3
            className="font-bold mb-3 text-sm"
            style={{ color: "var(--sidebar-active)" }}
          >
            Armies Under Test
          </h3>
          <p className="text-xs opacity-50 mb-3">
            Attacker heroes: {heroesSummary(active.raw.attacker?.heroes)} ·
            Defender heroes: {heroesSummary(active.raw.defender?.heroes)}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            <ArmyBlock
              title="Attacker"
              army={active.raw.attacker}
              color="#f38ba8"
            />
            <ArmyBlock
              title="Defender"
              army={active.raw.defender}
              color="#89b4fa"
            />
          </div>

          <h3
            className="font-bold mb-3 text-sm"
            style={{ color: "var(--sidebar-active)" }}
          >
            Expected Battle Reports
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            <BattleResultsBlock
              title="game_report_result (ground truth)"
              results={active.raw.game_report_result}
            />
          </div>
        </>
      )}

      {/* Per-run history table */}
      <h3
        className="font-bold mb-3 text-sm"
        style={{ color: "var(--sidebar-active)" }}
      >
        Run History
      </h3>
      {active.history.length === 0 ? (
        <p className="text-xs opacity-50">
          No runs have executed this testcase yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table
            className="w-full border-collapse font-mono text-[11px] leading-tight"
            style={{ borderColor: "var(--border-color)" }}
          >
            <thead>
              <tr
                className="text-left uppercase tracking-wider"
                style={{ borderBottom: "1px solid var(--border-color)" }}
              >
                <th className={stickyTh}>Run</th>
                <th className={stickyTh}>Start</th>
                <th className={stickyTh}>Adj</th>
                <th className={stickyTh}>S n</th>
                <th className={stickyTh}>G n</th>
                <th className={stickyTh}>S μ</th>
                <th className={stickyTh}>G μ</th>
                <th className={stickyTh}>Bias%</th>
                <th className={stickyTh}>t</th>
                <th className={stickyTh}>q</th>
                <th className={stickyTh}>P</th>
                <th className={stickyTh}>W</th>
              </tr>
            </thead>
            <tbody>
              {[...active.history].reverse().map((h) => {
                const isBhSig = (h.q ?? 1) <= 0.05 && h.passes === 0;
                const isWaived = h.waived_bool === 1;
                return (
                  <tr
                    key={h.run_id}
                    style={{
                      borderBottom: "1px solid var(--border-color)",
                      opacity: isWaived ? 0.45 : 1,
                      backgroundColor: isBhSig
                        ? "rgba(243,139,168,0.08)"
                        : "transparent",
                    }}
                  >
                    <td className={compactTd}>
                      <Link
                        href={`/runs/${h.run_id}`}
                        className="underline hover:opacity-80"
                        style={{ color: "var(--sidebar-active)" }}
                      >
                        {h.run_id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className={`${compactTd} opacity-60`}>
                      {shortDate(h.started_at)}
                    </td>
                    <td
                      className={compactTd}
                      title={statAdjustmentTitle(
                        h.stat_adjustment_value,
                        h.stat_adjustment_mode,
                      )}
                    >
                      {formatStatAdjustment(h.stat_adjustment_value)}
                    </td>
                    <td className={compactTd}>{h.n_sim}</td>
                    <td className={compactTd}>{h.n_game}</td>
                    <td className={compactTd}>{h.mu_sim?.toFixed(1) ?? "—"}</td>
                    <td className={compactTd}>{h.mu_game?.toFixed(1) ?? "—"}</td>
                    <td
                      className={compactTd}
                      style={{
                        color:
                          Math.abs(h.bias_pct ?? 0) > 5 ? "#f38ba8" : "inherit",
                      }}
                    >
                      {h.bias_pct?.toFixed(2) ?? "—"}%
                    </td>
                    <td className={compactTd}>{h.t?.toFixed(2) ?? "—"}</td>
                    <td
                      className={compactTd}
                      style={{
                        color: (h.q ?? 1) <= 0.05 ? "#f38ba8" : "inherit",
                      }}
                    >
                      {h.q?.toPrecision(2) ?? "—"}
                    </td>
                    <td className={compactTd}>
                      <span
                        className="inline-block px-1.5 py-0.5 rounded text-xs font-bold"
                        style={{
                          backgroundColor:
                            h.passes === 1 ? "#a6e3a1" : "#f38ba8",
                          color: "#1e1e2e",
                        }}
                      >
                        {h.passes === 1 ? "P" : "F"}
                      </span>
                    </td>
                    <td className={compactTd}>
                      {isWaived ? (
                        <span className="opacity-60 text-xs">W</span>
                      ) : (
                        <span className="opacity-20">—</span>
                      )}
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
