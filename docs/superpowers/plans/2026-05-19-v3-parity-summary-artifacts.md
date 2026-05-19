# V3 Parity Summary Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `npm --prefix v3 run testcases` print and save a compact v3 parity summary while writing full per-case battle diagnostics as referenced artifacts.

**Architecture:** Add one reusable v3 comparison module that mirrors `check_testcases.py` statistics, then have the testcase runner produce a summary-shaped report keyed by `file#idx`. The CLI writes full case detail artifacts beside the summary report, and the Next.js parity page loads summary rows first and case artifacts on demand.

**Tech Stack:** TypeScript ESM, Node `node:test`, Next.js dashboard helper tests via Playwright test runner.

---

## File Structure

- Create `v3/src/parityMetrics.ts`: shared comparison metric types and functions matching `check_testcases.py` rules for v3-vs-game and v3-vs-v1.
- Modify `v3/src/calibration.ts`: keep loading the v1 snapshot, but expose full v1 snapshot fields needed by generic comparison metrics.
- Modify `v3/src/testcases.ts`: change the report model from inline `cases[]` plus `comparison.table[]` to `counts`, `warnings`, `errors`, and `testcases` keyed by `file#idx`; retain full detail data in memory for the CLI writer.
- Modify `v3/src/cli.ts`: write compact summary JSON to stdout and summary file; write detail artifacts under the sibling artifact directory.
- Modify `v3/src/testcases.test.ts`: replace old inline-report tests with summary/artifact-focused tests.
- Modify `dashboard/web/lib/parity-reports.ts`: load the new summary shape, convert `testcases` into table rows, and resolve `detailArtifact` for case pages.
- Modify `dashboard/web/components/ParityReportSummary.tsx`, `dashboard/web/components/ParityReportTable.tsx`, and `dashboard/web/components/ParityCaseSummary.tsx`: display the new `game`/`v1` comparison object shape.
- Modify `dashboard/web/tests/parity-reports.spec.ts`: replace old report fixtures with summary-plus-artifact fixtures.
- Optionally delete generated old reports under `v3/testcase_results/v3_parity*.json` after the implementation is verified.

---

### Task 1: Add Reusable Parity Metrics

**Files:**
- Create: `v3/src/parityMetrics.ts`
- Modify: `v3/src/calibration.ts`
- Test: `v3/src/testcases.test.ts`

- [ ] **Step 1: Add failing tests for metric shape and v1 snapshot loading**

Append these tests to `v3/src/testcases.test.ts`:

```ts
import { compareOutcomeDistribution, applyBenjaminiHochberg, type ParityComparisonMetrics } from "./parityMetrics.js";

test("compareOutcomeDistribution matches check_testcases deterministic zero-bias shape", () => {
  const metrics = compareOutcomeDistribution({
    candidate: { n: 1, mu: -186, sigma: 0 },
    reference: { n: 1, mu: -186, sigma: 0 },
    initialTroops: 1200,
    deterministic: true,
    thresholds: { max_diff_ratio_deterministic: 0.01, z_threshold: 2, min_bias_pct: 0.5 }
  });

  assert.deepEqual(metrics, {
    n_candidate: 1,
    mu_candidate: -186,
    sigma_candidate: 0,
    n_reference: 1,
    mu_reference: -186,
    sigma_reference: 0,
    bias_raw: 0,
    bias_pct: 0,
    sem: 0,
    stat_type: "deterministic",
    stat: null,
    p: null,
    q: null,
    passes: true
  } satisfies ParityComparisonMetrics);
});

test("compareOutcomeDistribution reports single-observation stochastic references as low evidence", () => {
  const metrics = compareOutcomeDistribution({
    candidate: { n: 5, mu: 10, sigma: 2 },
    reference: { n: 1, mu: 8, sigma: 0 },
    initialTroops: 100,
    deterministic: false,
    thresholds: { max_diff_ratio_deterministic: 0.01, z_threshold: 2, min_bias_pct: 0.5 }
  });

  assert.equal(metrics.stat_type, "single_obs");
  assert.equal(metrics.passes, true);
  assert.equal(metrics.bias_raw, 2);
  assert.equal(metrics.bias_pct, 2);
});

test("applyBenjaminiHochberg fills q values on p-valued comparisons", () => {
  const rows = [
    { p: 0.01, q: null },
    { p: 0.03, q: null },
    { p: null, q: null }
  ];

  applyBenjaminiHochberg(rows);

  assert.equal(rows[0].q, 0.02);
  assert.equal(rows[1].q, 0.03);
  assert.equal(rows[2].q, null);
});

test("calibration lookup exposes full v1 snapshot metrics", () => {
  const comparison = loadCalibrationComparison();
  const row = readCalibrationCase(comparison, "testcases/emulator_verified/simple_001_nc.json", "simple_001");

  assert.equal(row?.biasRaw, 0);
  assert.equal(row?.sem, 0);
  assert.equal(row?.p, null);
  assert.equal(row?.q, null);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm --prefix v3 test -- --test-name-pattern "compareOutcomeDistribution|Benjamini|full v1"
```

Expected: FAIL because `v3/src/parityMetrics.ts` does not exist and `CalibrationCaseComparison` does not expose `biasRaw`, `sem`, `p`, or `q`.

- [ ] **Step 3: Create `v3/src/parityMetrics.ts`**

Create the file with this implementation:

```ts
export interface OutcomeDistribution {
  n: number;
  mu: number;
  sigma: number;
}

export interface ParityThresholds {
  z_threshold?: number;
  min_bias_pct?: number;
  max_diff_ratio?: number;
  max_diff_ratio_deterministic?: number;
}

export interface ParityComparisonMetrics {
  n_candidate: number;
  mu_candidate: number;
  sigma_candidate: number;
  n_reference: number;
  mu_reference: number;
  sigma_reference: number;
  bias_raw: number;
  bias_pct: number;
  sem: number;
  stat_type: "deterministic" | "zero_var" | "single_obs" | "t";
  stat: number | null;
  p: number | null;
  q: number | null;
  passes: boolean;
}

export function compareOutcomeDistribution(options: {
  candidate: OutcomeDistribution;
  reference: OutcomeDistribution;
  initialTroops: number;
  deterministic: boolean;
  thresholds?: ParityThresholds;
}): ParityComparisonMetrics {
  const thresholds = options.thresholds ?? {};
  const initialTroops = options.initialTroops || 1;
  const biasRaw = round(options.candidate.mu - options.reference.mu, 2);
  const biasPct = round((biasRaw / initialTroops) * 100, 2);
  const zThreshold = thresholds.z_threshold ?? 2;
  const minBiasPct = thresholds.min_bias_pct ?? 0.5;
  const deterministicLimit = (thresholds.max_diff_ratio_deterministic ?? 0.01) * 100;

  let sem = 0;
  let stat: number | null = null;
  let p: number | null = null;
  let statType: ParityComparisonMetrics["stat_type"];
  let passes: boolean;

  if (options.deterministic) {
    statType = "deterministic";
    passes = Math.abs(biasPct) <= deterministicLimit;
  } else if (options.candidate.sigma === 0) {
    statType = "zero_var";
    passes = Math.abs(biasPct) <= deterministicLimit;
  } else if (options.reference.n <= 1) {
    statType = "single_obs";
    sem = round(options.candidate.sigma, 2);
    passes = true;
  } else {
    statType = "t";
    sem = options.candidate.sigma * Math.sqrt(1 / Math.max(options.candidate.n, 1) + 1 / options.reference.n);
    stat = sem === 0 ? null : round(biasRaw / sem, 4);
    p = stat === null ? null : round(2 * (1 - normalCdf(Math.abs(stat))), 6);
    passes = stat === null || Math.abs(stat) <= zThreshold || Math.abs(biasPct) <= minBiasPct;
  }

  return {
    n_candidate: options.candidate.n,
    mu_candidate: round(options.candidate.mu, 2),
    sigma_candidate: round(options.candidate.sigma, 2),
    n_reference: options.reference.n,
    mu_reference: round(options.reference.mu, 2),
    sigma_reference: round(options.reference.sigma, 2),
    bias_raw: biasRaw,
    bias_pct: biasPct,
    sem: round(sem, 2),
    stat_type: statType,
    stat,
    p,
    q: null,
    passes
  };
}

export function applyBenjaminiHochberg(rows: Array<{ p: number | null; q: number | null }>): void {
  const ranked = rows
    .filter((row): row is { p: number; q: number | null } => row.p !== null)
    .sort((a, b) => a.p - b.p);
  const m = ranked.length;
  let runningMin = 1;
  for (let index = m - 1; index >= 0; index -= 1) {
    const rawQ = ranked[index].p * m / (index + 1);
    runningMin = Math.min(runningMin, rawQ);
    ranked[index].q = round(Math.min(1, runningMin), 6);
  }
}

function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return sign * y;
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}
```

- [ ] **Step 4: Extend `CalibrationCaseComparison`**

In `v3/src/calibration.ts`, add fields to the interface:

```ts
  biasRaw?: number;
  sem?: number;
  p?: number | null;
  q?: number | null;
```

Then update `normalizeCalibrationCase` to populate them:

```ts
    biasRaw: numberOrUndefined(object.bias_raw),
    sem: numberOrUndefined(object.sem),
    p: nullableNumber(object.p),
    q: nullableNumber(object.q),
```

Add this helper near `numberOrUndefined`:

```ts
function nullableNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  return numberOrUndefined(value);
}
```

- [ ] **Step 5: Run tests to verify pass**

Run:

```bash
npm --prefix v3 test -- --test-name-pattern "compareOutcomeDistribution|Benjamini|full v1"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add v3/src/parityMetrics.ts v3/src/calibration.ts v3/src/testcases.test.ts
git commit -m "Add v3 parity comparison metrics"
```

---

### Task 2: Reshape Testcase Runner Report

**Files:**
- Modify: `v3/src/testcases.ts`
- Modify: `v3/src/testcases.test.ts`

- [ ] **Step 1: Replace runner report tests with summary-shape assertions**

Update the existing `runTestcases adapts selected testcase entries...` test in `v3/src/testcases.test.ts` so it asserts the new report shape:

```ts
test("runTestcases returns compact summary entries and full detail entries separately", () => {
  const config = loadSimulatorConfig();
  const report = runTestcases({ matching: "simple_001", repeat: 5 }, config);
  const key = Object.keys(report.testcases)[0];
  const summary = report.testcases[key];
  const detail = report.details[0];

  assert.equal(report.reportKind, "v3-parity-summary");
  assert.equal(report.counts.filesFound, 1);
  assert.equal(report.counts.testcasesFound, 1);
  assert.equal(report.counts.executed, 1);
  assert.equal(report.counts.errors, 0);
  assert.equal(summary?.testcase_id, "simple_001");
  assert.equal(summary?.deterministic, false);
  assert.equal(summary?.sampleCount, 5);
  assert.equal(typeof summary?.game?.mu_candidate, "number");
  assert.equal(typeof summary?.v1?.mu_candidate, "number");
  assert.deepEqual(Object.keys(summary?.game ?? {}), Object.keys(summary?.v1 ?? {}));
  assert.equal("result" in (summary as object), false);
  assert.ok(detail?.result);
});
```

Add a missing-v1 warning test:

```ts
test("runTestcases keeps executed testcase and warns when v1 snapshot row is missing", () => {
  const config = loadSimulatorConfig();
  const report = runTestcases({ matching: "simple_001", repeat: 1, calibrationReportPath: "/tmp/does-not-exist.json" }, config);
  const summary = Object.values(report.testcases)[0];

  assert.equal(report.counts.executed, 1);
  assert.equal(summary?.game?.n_candidate, 1);
  assert.equal(summary?.v1, null);
  assert.equal(report.warnings[0]?.stage, "v1_comparison");
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm --prefix v3 test -- --test-name-pattern "compact summary|warns when v1"
```

Expected: FAIL because `runTestcases` still returns `selectedCases`, `cases`, `aggregate`, and `comparison`.

- [ ] **Step 3: Update `v3/src/testcases.ts` types**

Replace `TestcaseRunReport` with these interfaces, keeping `TestcaseCaseReport` for full detail payloads:

```ts
import { applyBenjaminiHochberg, compareOutcomeDistribution, type ParityComparisonMetrics } from "./parityMetrics.js";

export interface TestcaseRunWarning {
  file: string;
  testcase_id: string;
  idx: number;
  stage: "parse" | "adapt" | "execute" | "game_comparison" | "v1_comparison" | "artifact";
  reason: string;
}

export interface TestcaseSummaryEntry {
  file: string;
  testcase_id: string;
  idx: number;
  detailArtifact?: string;
  deterministic: boolean;
  sampleCount: number;
  game: ParityComparisonMetrics | null;
  v1: ParityComparisonMetrics | null;
}

export interface TestcaseRunReport {
  reportKind: "v3-parity-summary";
  schemaVersion: 1;
  createdAt: string;
  options: TestcaseRunOptions;
  artifactRoot?: string;
  counts: {
    filesFound: number;
    testcasesFound: number;
    executed: number;
    warnings: number;
    errors: number;
    comparedToGame: number;
    comparedToV1: number;
  };
  warnings: TestcaseRunWarning[];
  errors: TestcaseRunWarning[];
  testcases: Record<string, TestcaseSummaryEntry>;
  details: TestcaseCaseReport[];
}
```

- [ ] **Step 4: Implement summary generation in `runTestcases`**

Inside `runTestcases`, replace the old `cases`, `aggregate`, and `comparison.table` accumulation with:

```ts
const comparison = loadCalibrationComparison(options.calibrationReportPath);
const report: TestcaseRunReport = {
  reportKind: "v3-parity-summary",
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  options: { ...options },
  counts: { filesFound: files.length, testcasesFound: 0, executed: 0, warnings: 0, errors: 0, comparedToGame: 0, comparedToV1: 0 },
  warnings: [],
  errors: [],
  testcases: {},
  details: []
};
```

For each parsed entry:

```ts
report.counts.testcasesFound += 1;
const key = snapshotKey(relative(process.cwd(), file), index);
```

After simulating samples, compute distributions:

```ts
const initialTroops = totalInputTroops(input.attacker) + totalInputTroops(input.defender);
const v3Distribution = { n: stats.n, mu: stats.mu, sigma: stats.sigma };
const gameDistribution = distributionFromGameResult((entry as { game_report_result?: unknown }).game_report_result);
const calibration = readCalibrationCase(comparison, relative(process.cwd(), file), testcaseId, { index });
const game = gameDistribution
  ? compareOutcomeDistribution({ candidate: v3Distribution, reference: gameDistribution, initialTroops, deterministic: result.randomness.deterministic, thresholds: comparison.thresholds })
  : null;
const v1 = calibration?.nSim !== undefined && calibration.muSim !== undefined && calibration.sigmaSim !== undefined
  ? compareOutcomeDistribution({
      candidate: v3Distribution,
      reference: { n: calibration.nSim, mu: calibration.muSim, sigma: calibration.sigmaSim },
      initialTroops,
      deterministic: result.randomness.deterministic,
      thresholds: comparison.thresholds
    })
  : null;
```

Push warnings for missing references:

```ts
if (!game) report.warnings.push({ file: relative(process.cwd(), file), testcase_id: testcaseId, idx: index, stage: "game_comparison", reason: "Missing game_report_result" });
if (!v1) report.warnings.push({ file: relative(process.cwd(), file), testcase_id: testcaseId, idx: index, stage: "v1_comparison", reason: "No matching v1 snapshot row" });
```

Store summary and detail:

```ts
report.testcases[key] = {
  file: relative(process.cwd(), file),
  testcase_id: testcaseId,
  idx: index,
  deterministic: result.randomness.deterministic,
  sampleCount,
  game,
  v1
};
```

Push the full detail payload with the existing per-case detail local:

```ts
report.details.push(detailReport);
```

After all cases, apply q-values:

```ts
applyBenjaminiHochberg(Object.values(report.testcases).flatMap((entry) => [entry.game, entry.v1].filter((value): value is ParityComparisonMetrics => !!value)));
report.counts.warnings = report.warnings.length;
report.counts.errors = report.errors.length;
report.counts.comparedToGame = Object.values(report.testcases).filter((entry) => entry.game).length;
report.counts.comparedToV1 = Object.values(report.testcases).filter((entry) => entry.v1).length;
```

- [ ] **Step 5: Add helper functions**

Add helpers near the bottom of `v3/src/testcases.ts`:

```ts
function snapshotKey(filePath: string, index: number): string {
  return `${normalizeReportPath(filePath)}#${index}`;
}

function normalizeReportPath(filePath: string): string {
  const normalized = filePath.replaceAll("\\", "/");
  const testcaseIndex = normalized.indexOf("testcases/");
  return testcaseIndex >= 0 ? normalized.slice(testcaseIndex) : normalized;
}

function distributionFromGameResult(value: unknown): { n: number; mu: number; sigma: number } | undefined {
  const outcomes = extractOutcomeScores(value);
  if (outcomes.length === 0) return undefined;
  const stats = sampleStats(outcomes);
  return { n: stats.n, mu: stats.mu, sigma: stats.sigma };
}

function extractOutcomeScores(value: unknown): number[] {
  const rows = Array.isArray(value) ? value : value ? [value] : [];
  return rows
    .map((row) => battleScoreDelta(row))
    .filter((score): score is number => score !== undefined);
}

function totalInputTroops(fighter: FighterInput): number {
  return Object.values(fighter.troops ?? {}).reduce((sum, count) => sum + Number(count || 0), 0);
}
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm --prefix v3 test -- --test-name-pattern "compact summary|warns when v1|duplicate no-hero|simple testcase"
```

Expected: PASS after updating the existing assertions that still reference `selectedCases`, `cases`, or `comparison.table`.

- [ ] **Step 7: Commit**

```bash
git add v3/src/testcases.ts v3/src/testcases.test.ts
git commit -m "Reshape v3 testcase reports as compact summaries"
```

---

### Task 3: Write Summary and Detail Artifacts from CLI

**Files:**
- Modify: `v3/src/cli.ts`
- Modify: `v3/src/testcases.ts`
- Modify: `v3/src/testcases.test.ts`

- [ ] **Step 1: Add tests for artifact-ready serialization helpers**

In `v3/src/testcases.test.ts`, import and test helpers that will be exported from `cli.ts` or `testcases.ts`. Prefer exporting from `testcases.ts` to keep CLI thin:

```ts
import { buildSummaryForOutput, assignDetailArtifactPaths } from "./testcases.js";

test("assignDetailArtifactPaths adds paths to summary entries without inlining results", () => {
  const config = loadSimulatorConfig();
  const report = runTestcases({ matching: "simple_001", repeat: 1 }, config);
  assignDetailArtifactPaths(report, "v3_parity_run");
  const entry = Object.values(report.testcases)[0];
  const output = buildSummaryForOutput(report);

  assert.equal(entry?.detailArtifact, "v3_parity_run/cases/000001.json");
  assert.equal("details" in output, false);
  assert.equal(JSON.stringify(output).includes("\"attacks\""), false);
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm --prefix v3 test -- --test-name-pattern "assignDetailArtifactPaths"
```

Expected: FAIL because the helpers do not exist.

- [ ] **Step 3: Implement serialization helpers in `v3/src/testcases.ts`**

Add:

```ts
export type TestcaseSummaryOutput = Omit<TestcaseRunReport, "details">;

export function assignDetailArtifactPaths(report: TestcaseRunReport, artifactRoot: string): void {
  report.artifactRoot = artifactRoot;
  Object.keys(report.testcases).forEach((key, index) => {
    report.testcases[key].detailArtifact = `${artifactRoot}/cases/${String(index + 1).padStart(6, "0")}.json`;
  });
}

export function buildSummaryForOutput(report: TestcaseRunReport): TestcaseSummaryOutput {
  const { details: _details, ...summary } = report;
  return summary;
}
```

- [ ] **Step 4: Update `v3/src/cli.ts` output flow**

Replace the current JSON construction/write block with:

```ts
const report = runTestcases(options.testcaseOptions, config);
if (options.noRunSnapshot) {
  console.log(JSON.stringify(buildSummaryForOutput(report), null, 2));
} else {
  const { summaryPath, artifactRoot } = writeRunSnapshot(report, options.outputDir);
  console.log(JSON.stringify(buildSummaryForOutput(report), null, 2));
  console.error(JSON.stringify({ summaryPath, artifactRoot }, null, 2));
}
const failed = report.counts.errors > 0;
process.exitCode = failed ? 1 : 0;
```

Update imports:

```ts
import { buildSummaryForOutput, assignDetailArtifactPaths, runTestcases, type TestcaseRunOptions, type TestcaseRunReport } from "./testcases.js";
```

Replace `writeRunSnapshot(json: string, outputDir: string)` with:

```ts
function writeRunSnapshot(report: TestcaseRunReport, outputDir: string): { summaryPath: string; artifactRoot: string } {
  mkdirSync(outputDir, { recursive: true });
  const summaryPath = resolve(outputDir, timestampedReportName());
  const artifactDirName = summaryPath.replace(/\.json$/, "");
  const artifactRoot = artifactDirName.slice(outputDir.length + 1);
  assignDetailArtifactPaths(report, artifactRoot);
  mkdirSync(resolve(outputDir, artifactRoot, "cases"), { recursive: true });
  report.details.forEach((detail, index) => {
    const detailPath = resolve(outputDir, artifactRoot, "cases", `${String(index + 1).padStart(6, "0")}.json`);
    writeFileSync(detailPath, `${JSON.stringify({
      reportKind: "v3-parity-case-detail",
      schemaVersion: report.schemaVersion,
      createdAt: report.createdAt,
      ...detail
    }, null, 2)}\n`);
  });
  writeFileSync(summaryPath, `${JSON.stringify(buildSummaryForOutput(report), null, 2)}\n`);
  return { summaryPath, artifactRoot };
}
```

- [ ] **Step 5: Run CLI smoke test**

Run:

```bash
npm --prefix v3 run testcases -- --matching simple_001 --repeat 1 --output-dir /tmp/v3-parity-plan-smoke > /tmp/v3-parity-plan-smoke/stdout.json 2> /tmp/v3-parity-plan-smoke/stderr.json
node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync("/tmp/v3-parity-plan-smoke/stdout.json","utf8")); if (s.details || JSON.stringify(s).includes("\"attacks\"")) process.exit(1); console.log(s.reportKind, Object.keys(s.testcases).length)'
find /tmp/v3-parity-plan-smoke -maxdepth 3 -type f | sort
```

Expected: node command prints `v3-parity-summary 1`; `find` shows one summary JSON, `stdout.json`, `stderr.json`, and `cases/000001.json`.

- [ ] **Step 6: Run v3 tests**

Run:

```bash
npm --prefix v3 test
npm --prefix v3 run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add v3/src/cli.ts v3/src/testcases.ts v3/src/testcases.test.ts
git commit -m "Write v3 parity summaries and detail artifacts"
```

---

### Task 4: Update Dashboard Loader for Summary Artifacts

**Files:**
- Modify: `dashboard/web/lib/parity-reports.ts`
- Modify: `dashboard/web/tests/parity-reports.spec.ts`

- [ ] **Step 1: Replace dashboard loader fixtures**

In `dashboard/web/tests/parity-reports.spec.ts`, replace `report(name)` with a summary-plus-artifact fixture:

```ts
function report(name: string) {
  return {
    reportKind: "v3-parity-summary",
    schemaVersion: 1,
    createdAt: "2026-05-19T20:00:00.000Z",
    options: { matching: name, repeat: 1 },
    artifactRoot: "run",
    counts: {
      filesFound: 1,
      testcasesFound: 1,
      executed: 1,
      warnings: 0,
      errors: 0,
      comparedToGame: 1,
      comparedToV1: 1
    },
    warnings: [],
    errors: [],
    testcases: {
      [`testcases/${name}.json#0`]: {
        file: `testcases/${name}.json`,
        testcase_id: name,
        idx: 0,
        detailArtifact: "run/cases/000001.json",
        deterministic: true,
        sampleCount: 1,
        game: metric(10, 9, false),
        v1: metric(10, 8, true)
      }
    }
  };
}

function metric(candidate: number, reference: number, passes: boolean) {
  return {
    n_candidate: 1,
    mu_candidate: candidate,
    sigma_candidate: 0,
    n_reference: 1,
    mu_reference: reference,
    sigma_reference: 0,
    bias_raw: candidate - reference,
    bias_pct: 1,
    sem: 0,
    stat_type: "deterministic",
    stat: null,
    p: null,
    q: null,
    passes
  };
}
```

Add helper to write detail artifact:

```ts
function writeDetail(dir: string, name: string) {
  const detailDir = path.join(dir, "run", "cases");
  fs.mkdirSync(detailDir, { recursive: true });
  fs.writeFileSync(path.join(detailDir, "000001.json"), JSON.stringify({
    reportKind: "v3-parity-case-detail",
    schemaVersion: 1,
    createdAt: "2026-05-19T20:00:00.000Z",
    file: `/repo/v3/testcases/${name}.json`,
    testcaseId: name,
    index: 0,
    deterministic: true,
    sampleCount: 1,
    result: { winner: "attacker", rounds: 2, remaining: {}, attacks: [] },
    diagnostics: []
  }, null, 2));
}
```

- [ ] **Step 2: Run dashboard tests to verify failure**

Run:

```bash
npm --prefix dashboard/web exec -- playwright test tests/parity-reports.spec.ts
```

Expected: FAIL because `isParityReportJson` still expects `cases[]` and `comparison.table[]`.

- [ ] **Step 3: Update `dashboard/web/lib/parity-reports.ts` types**

Replace `ParityReportJson`, `ParityComparisonRow`, and summary interfaces with the new shape:

```ts
export interface ParityMetric {
  n_candidate: number;
  mu_candidate: number;
  sigma_candidate: number;
  n_reference: number;
  mu_reference: number;
  sigma_reference: number;
  bias_raw: number;
  bias_pct: number;
  sem: number;
  stat_type: string;
  stat: number | null;
  p: number | null;
  q: number | null;
  passes: boolean;
}

export interface ParityComparisonRow {
  key: string;
  file: string;
  testcaseId: string;
  idx: number;
  detailArtifact?: string;
  deterministic?: boolean;
  sampleCount?: number;
  game: ParityMetric | null;
  v1: ParityMetric | null;
}

export interface ParityReportJson {
  reportKind?: string;
  schemaVersion?: number;
  createdAt?: string;
  artifactRoot?: string;
  counts?: Partial<Record<"filesFound" | "testcasesFound" | "executed" | "warnings" | "errors" | "comparedToGame" | "comparedToV1", number>>;
  warnings?: unknown[];
  errors?: unknown[];
  testcases?: Record<string, Omit<ParityComparisonRow, "key" | "testcaseId"> & { testcase_id?: string }>;
}
```

- [ ] **Step 4: Convert summary testcases to rows**

Add:

```ts
function rowsFromReport(data: ParityReportJson): ParityComparisonRow[] {
  return Object.entries(data.testcases ?? {}).map(([key, value]) => ({
    key,
    file: value.file,
    testcaseId: value.testcase_id ?? "",
    idx: value.idx,
    detailArtifact: value.detailArtifact,
    deterministic: value.deterministic,
    sampleCount: value.sampleCount,
    game: value.game,
    v1: value.v1
  }));
}
```

Update `getParityReport`:

```ts
const rows = rowsFromReport(data);
return { ...descriptor, data, rows, cases: [], summary: summarizeParityReport(data) };
```

Update compatibility check:

```ts
function isParityReportJson(value: unknown): value is ParityReportJson {
  if (!value || typeof value !== "object") return false;
  const report = value as ParityReportJson;
  return report.reportKind === "v3-parity-summary" && !!report.testcases && typeof report.testcases === "object";
}
```

- [ ] **Step 5: Resolve detail artifacts in `getParityReportCase`**

Replace inline case lookup with:

```ts
const caseReport = row.detailArtifact
  ? readCaseArtifact(dir, row.detailArtifact)
  : undefined;
return { report, row, case: caseReport };
```

Add:

```ts
function readCaseArtifact(reportDir: string, detailArtifact: string): ParityCaseReport | undefined {
  const artifactPath = path.resolve(reportDir, detailArtifact);
  const root = path.resolve(reportDir);
  if (!artifactPath.startsWith(root + path.sep)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(artifactPath, "utf8")) as ParityCaseReport;
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 6: Update summary counts**

Update `summarizeParityReport`:

```ts
export function summarizeParityReport(report: ParityReportJson): ParitySummary {
  const rows = rowsFromReport(report);
  const counts = report.counts ?? {};
  return {
    filesFound: Number(counts.filesFound ?? 0),
    testcasesFound: Number(counts.testcasesFound ?? rows.length),
    executedCases: Number(counts.executed ?? rows.length),
    warnings: Number(counts.warnings ?? report.warnings?.length ?? 0),
    errors: Number(counts.errors ?? report.errors?.length ?? 0),
    comparedToV1: Number(counts.comparedToV1 ?? rows.filter((row) => row.v1).length),
    comparedToGame: Number(counts.comparedToGame ?? rows.filter((row) => row.game).length),
    v3VsV1Failures: rows.filter((row) => row.v1?.passes === false).length,
    v3VsGameFailures: rows.filter((row) => row.game?.passes === false).length
  };
}
```

- [ ] **Step 7: Run dashboard loader tests**

Run:

```bash
npm --prefix dashboard/web exec -- playwright test tests/parity-reports.spec.ts
```

Expected: PASS after updating test assertions to use `game`/`v1` instead of `v3VsGamePasses` and `v3VsV1Passes`.

- [ ] **Step 8: Commit**

```bash
git add dashboard/web/lib/parity-reports.ts dashboard/web/tests/parity-reports.spec.ts
git commit -m "Load v3 parity summary artifact reports"
```

---

### Task 5: Update Dashboard Components for `game` and `v1` Metrics

**Files:**
- Modify: `dashboard/web/components/ParityReportSummary.tsx`
- Modify: `dashboard/web/components/ParityReportTable.tsx`
- Modify: `dashboard/web/components/ParityCaseSummary.tsx`
- Modify: `dashboard/web/app/parity/page.tsx`

- [ ] **Step 1: Update `ParityReportSummary` fields**

Replace summary cards with:

```tsx
<MetricCard label="Files" value={String(summary.filesFound)} />
<MetricCard label="Testcases" value={String(summary.testcasesFound)} />
<MetricCard label="Executed" value={String(summary.executedCases)} />
<MetricCard label="Warnings" value={String(summary.warnings)} color={summary.warnings > 0 ? "#f9e2af" : undefined} />
<MetricCard label="Errors" value={String(summary.errors)} color={summary.errors > 0 ? "#f38ba8" : undefined} />
<MetricCard label="Compared V1" value={String(summary.comparedToV1)} />
<MetricCard label="Compared Game" value={String(summary.comparedToGame)} />
<MetricCard label="V3 vs V1 Fail" value={String(summary.v3VsV1Failures)} color={summary.v3VsV1Failures > 0 ? "#f38ba8" : "#a6e3a1"} />
<MetricCard label="V3 vs Game Fail" value={String(summary.v3VsGameFailures)} color={summary.v3VsGameFailures > 0 ? "#f38ba8" : "#a6e3a1"} />
```

- [ ] **Step 2: Update `ParityReportTable` metric access**

Replace old row fields with the new nested fields:

```ts
const gameFail = row.game?.passes === false ? 1_000_000 : 0;
const v1Fail = row.v1?.passes === false ? 100_000 : 0;
```

Use:

```tsx
<td>{row.v1?.n_reference ?? "-"}</td>
<td>{fmt(row.v1?.mu_reference)}</td>
<td>{fmt(row.v1?.sigma_reference)}</td>
<td>{row.game?.n_reference ?? "-"}</td>
<td>{fmt(row.game?.mu_reference)}</td>
<td>{fmt(row.game?.sigma_reference)}</td>
<td>{row.game?.n_candidate ?? row.v1?.n_candidate ?? "-"}</td>
<td>{fmt(row.game?.mu_candidate ?? row.v1?.mu_candidate)}</td>
<td>{fmt(row.game?.sigma_candidate ?? row.v1?.sigma_candidate)}</td>
<td>{pass(row.v1?.passes)}</td>
<td>{fmt(row.v1?.bias_raw)}</td>
<td>{fmt(row.v1?.bias_pct)}</td>
<td>{fmt(row.v1?.stat ?? undefined)}</td>
<td>{pass(row.game?.passes)}</td>
<td>{fmt(row.game?.bias_raw)}</td>
<td>{fmt(row.game?.bias_pct)}</td>
<td>{fmt(row.game?.stat ?? undefined)}</td>
```

Keep sorting and filtering, but sort on `row.game?.stat`, `row.game?.bias_pct`, `row.v1?.stat`, and `row.v1?.bias_pct`.

- [ ] **Step 3: Update `ParityCaseSummary`**

Replace old summary cards with:

```tsx
<Summary label="v3 mu" value={fmt(row.game?.mu_candidate ?? row.v1?.mu_candidate)} />
<Summary label="v1 mu" value={fmt(row.v1?.mu_reference)} />
<Summary label="game mu" value={fmt(row.game?.mu_reference)} />
<Summary label="v3 vs v1 stat" value={fmt(row.v1?.stat ?? undefined)} />
<Summary label="v3 vs game stat" value={fmt(row.game?.stat ?? undefined)} />
<Summary label="v3 vs v1 bias%" value={fmt(row.v1?.bias_pct)} />
<Summary label="v3 vs game bias%" value={fmt(row.game?.bias_pct)} />
```

Update metadata JSON:

```tsx
value={{
  deterministic: caseReport?.deterministic ?? row.deterministic,
  sampleCount: caseReport?.sampleCount ?? row.sampleCount,
  game: row.game,
  v1: row.v1,
}}
```

- [ ] **Step 4: Update empty-state command copy**

In `dashboard/web/app/parity/page.tsx`, replace the command with:

```tsx
npm --prefix v3 run testcases -- --repeat 100
```

Remove the shell redirect from the displayed command because stdout is now intentionally compact and the CLI writes the summary file itself.

- [ ] **Step 5: Run dashboard tests and typecheck**

Run:

```bash
npm --prefix dashboard/web exec -- playwright test tests/parity-reports.spec.ts
npm --prefix dashboard/web exec -- tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add dashboard/web/components/ParityReportSummary.tsx dashboard/web/components/ParityReportTable.tsx dashboard/web/components/ParityCaseSummary.tsx dashboard/web/app/parity/page.tsx
git commit -m "Display v3 parity game and v1 metrics"
```

---

### Task 6: Final Verification and Cleanup

**Files:**
- Possibly delete generated files: `v3/testcase_results/v3_parity*.json`
- Possibly delete generated artifact directories under `v3/testcase_results/v3_parity_*`

- [ ] **Step 1: Remove old generated v3 parity reports**

List first:

```bash
find v3/testcase_results -maxdepth 1 \( -name 'v3_parity*.json' -o -name 'v3_parity_*' \) -print
```

Delete only generated v3 parity outputs, not `v1_resullt_2026-05-17T10-05-10Z.json`:

```bash
find v3/testcase_results -maxdepth 1 \( -name 'v3_parity*.json' -o -name 'v3_parity_*' \) -exec rm -rf {} +
```

- [ ] **Step 2: Run full v3 verification**

```bash
npm --prefix v3 test
npm --prefix v3 run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run dashboard verification**

```bash
npm --prefix dashboard/web exec -- playwright test tests/parity-reports.spec.ts
npm --prefix dashboard/web exec -- tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Run an end-to-end smoke report**

```bash
npm --prefix v3 run testcases -- --matching simple_001 --repeat 3
```

Expected:

- stdout is compact JSON with `reportKind: "v3-parity-summary"`
- stdout has `testcases` but no `details`, `result`, or `attacks`
- stderr prints `summaryPath` and `artifactRoot`
- `v3/testcase_results/<artifactRoot>/cases/000001.json` exists and contains the full result

- [ ] **Step 5: Inspect git status**

```bash
git status --short
```

Expected: only intentional source/test changes plus newly generated smoke output if it was not cleaned. Remove generated smoke output before the final commit unless the repo intentionally tracks it.

- [ ] **Step 6: Final commit**

```bash
git add v3/src dashboard/web
git commit -m "Finish v3 parity summary artifact output"
```

If all prior tasks committed their work and this task only removed generated old reports, use:

```bash
git add -u v3/testcase_results
git commit -m "Remove old inline v3 parity reports"
```

---

## Self-Review

- Spec coverage: The plan covers compact stdout summary, summary file, detail artifacts, file/testcase counts, warnings/errors, `game`/`v1` metric objects, check-testcases-style thresholds, dashboard artifact loading, and old report deletion.
- Placeholder scan: No `TBD` or placeholder implementation steps remain. The plan includes concrete commands and representative code for every changed area.
- Type consistency: `ParityComparisonMetrics` uses `n_candidate`/`mu_candidate` and `n_reference`/`mu_reference`; dashboard row types preserve `testcaseId` for component compatibility while the report JSON uses `testcase_id`.
