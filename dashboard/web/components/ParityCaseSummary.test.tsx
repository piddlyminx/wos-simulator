import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import ParityCaseSummary, {
  buildSimulatorSampleMetadata,
} from "./ParityCaseSummary";
import ParityReportTable from "./ParityReportTable";
import type { ParityCaseReport, ParityComparisonRow } from "@/lib/parity-reports";

function summaryRow(): ParityComparisonRow {
  return {
    key: "testcases/example.json#0",
    file: "testcases/example.json",
    testcaseId: "example",
    idx: 0,
    detailArtifact: "run/cases/000001.json",
    deterministic: false,
    sampleCount: 100,
    simulatorScoreDelta: 42,
    game: {
      n_candidate: 100,
      mu_candidate: 10,
      sigma_candidate: 3,
      n_reference: 100,
      mu_reference: 10,
      sigma_reference: 2,
      bias_raw: 0,
      bias_pct: 0,
      sem: 0.3,
      stat_type: "t",
      stat: null,
      p: null,
      q: null,
      passes: false,
    },
    baseline: null,
  };
}

test("simulator sample metadata omits single stored sample score delta", () => {
  const metadata = buildSimulatorSampleMetadata({
    row: summaryRow(),
    caseReport: {
      file: "testcases/example.json",
      testcaseId: "example",
      index: 0,
      deterministic: false,
      sampleCount: 100,
      simulatorStats: { n: 100, mu: 10, sigma: 3, sem: 0.3 },
      simulatorScoreDelta: 42,
    },
  });

  assert.equal("simulatorScoreDelta" in metadata, false);
  assert.deepEqual(metadata.simulatorStats, { n: 100, mu: 10, sigma: 3, sem: 0.3 });
});

test("summary-only case page keeps comparison data and hides artifact-only sections", () => {
  const html = renderToStaticMarkup(<ParityCaseSummary row={summaryRow()} />);

  assert.match(html, /Simulator Sample Metadata/);
  assert.match(html, /Detailed battle artifact not available/);
  assert.doesNotMatch(html, />Visibility</);
  assert.doesNotMatch(html, /Final Stored Result/);
  assert.doesNotMatch(html, /Stored run attacks/);
});

test("case page renders artifact sections when detail exists", () => {
  const caseReport: ParityCaseReport = {
    file: "testcases/example.json",
    testcaseId: "example",
    index: 0,
    visibility: { attacker: {}, defender: {} },
    result: { winner: "attacker", rounds: 2, remaining: {}, attacks: [] },
  };
  const html = renderToStaticMarkup(
    <ParityCaseSummary row={summaryRow()} caseReport={caseReport} />,
  );

  assert.match(html, />Visibility</);
  assert.match(html, /Final Stored Result/);
  assert.match(html, /Stored run attacks \(0\)/);
  assert.doesNotMatch(html, /Detailed battle artifact not available/);
});

test("summary-only parity rows still link to their case page", () => {
  const html = renderToStaticMarkup(
    <ParityReportTable reportId="run.json" rows={[summaryRow()]} />,
  );

  assert.match(html, /href="\/parity\/run.json\/case\?/);
  assert.match(html, />example<\/a>/);
});
