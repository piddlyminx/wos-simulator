import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import ParityDistributionCharts from "@/components/ParityDistributionCharts";
import type { ParityDistributionCase, ParityMetric } from "@/lib/parity-reports";

const metric: ParityMetric = {
  n_candidate: 5,
  mu_candidate: 102,
  sigma_candidate: 3,
  n_reference: 2,
  mu_reference: 100,
  sigma_reference: 1,
  bias_raw: 2,
  bias_pct: 0.2,
  sem: 1.3,
  stat_type: "cdf_support",
  stat: 2,
  p: 0.001,
  q: null,
  passes: false,
};

function chartCase(
  testcaseId: string,
  passes: boolean,
): ParityDistributionCase {
  return {
    file: `testcases/${testcaseId}.json`,
    testcaseId,
    idx: 0,
    passes,
    sampleCount: 5,
    simulatorSamples: [96, 99, 101, 103, 111],
    gameSamples: [100, 100],
    game: { ...metric, p: passes ? 0.5 : 0.001, passes },
  };
}

test("distribution charts use dashboard-native cards and show failures first", () => {
  const html = renderToStaticMarkup(
    createElement(ParityDistributionCharts, {
      cases: [
        chartCase("passing_case", true),
        chartCase("failing_case", false),
      ],
    }),
  );

  assert.ok(html.indexOf("failing_case") < html.indexOf("passing_case"));
  assert.match(html, /Simulator samples/);
  assert.match(html, /Game outcomes/);
  assert.match(html, /raw p-value is below 0\.004/);
  assert.match(html, /no multiple-testing adjustment is applied/);
  assert.match(html, /Outcome distribution for failing_case/);
  assert.match(html, /var\(--sidebar-bg\)/);
  assert.match(html, /#89b4fa/);
  assert.match(html, /#f38ba8/);
  assert.match(html, /100 ×2/);
  assert.doesNotMatch(html, /<iframe/);
  assert.doesNotMatch(html, /background:\s*white/i);
});

test("distribution charts centre integers in bins and keep edge labels visible", () => {
  const edgeCase = chartCase("edge_case", false);
  edgeCase.gameSamples = [120];
  const html = renderToStaticMarkup(
    createElement(ParityDistributionCharts, { cases: [edgeCase] }),
  );

  assert.match(html, /95\.5–96\.5: 1 samples/);
  assert.match(html, /text-anchor="end"[^>]*>120<\/text>/);
  assert.match(html, /text-anchor="start"[^>]*>96<\/text>/);
  assert.match(html, /text-anchor="end"[^>]*>120<\/text>/);
});

test("distribution charts reclassify legacy saved verdicts using the current raw p cutoff", () => {
  const legacyCase = chartCase("stored_old_failure", false);
  legacyCase.game = { ...metric, p: 0.03, passes: false };
  const html = renderToStaticMarkup(
    createElement(ParityDistributionCharts, { cases: [legacyCase] }),
  );

  assert.match(html, />PASS<\/span>[\s\S]*stored_old_failure/);
  assert.ok(html.indexOf("Other chance-enabled testcases") < html.indexOf("stored_old_failure"));
});
