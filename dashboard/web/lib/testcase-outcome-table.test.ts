import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TestcaseOutcomeTable from "../components/TestcaseOutcomeTable";
import type { ParityComparisonRow, ParityMetric } from "./parity-reports";

const metric: ParityMetric = {
  n_candidate: 100,
  mu_candidate: -1_618,
  sigma_candidate: 12,
  n_reference: 10,
  mu_reference: 5_302,
  sigma_reference: 8,
  bias_raw: -6_920,
  bias_pct: -130.5,
  sem: 1.2,
  stat_type: "surprisal",
  stat: 0.42,
  p: 0.001,
  q: 0.002,
  passes: false,
};

const row: ParityComparisonRow = {
  key: "testcases/example.json#0",
  file: "testcases/example.json",
  testcaseId: "hero_matchup",
  idx: 0,
  armies: {
    attacker: {
      heroes: { Jessie: { skill_1: 2, skill_2: 3 } },
      joinerHeroes: { Jasser: { skill_1: 4 } },
      troops: { infantry_t6: 8_000 },
    },
    defender: {
      heroes: { Alonso: { skill_1: 1, skill_2: 2, skill_3: 3 } },
      joinerHeroes: {},
      troops: { lancer_t10_fc5: 2_000 },
    },
  },
  game: metric,
  baseline: null,
};

const passingRow: ParityComparisonRow = {
  ...row,
  key: "testcases/passing.json#0",
  file: "testcases/passing.json",
  testcaseId: "passing_matchup",
  game: {
    ...metric,
    bias_raw: 1.2,
    bias_pct: 0.03,
    passes: true,
  },
};

test("unified report table shows testcase inputs and both outcomes", () => {
  const html = renderToStaticMarkup(
    createElement(TestcaseOutcomeTable, {
      reportId: "report.json",
      rows: [row, passingRow],
    }),
  );

  assert.match(html, />Testcase</);
  assert.match(html, />Attacker</);
  assert.match(html, />Defender</);
  assert.match(html, />Game result</);
  assert.match(html, />Sim result</);
  assert.match(html, /hero_matchup/);
  assert.match(html, /Jessie/);
  assert.match(html, /Jasser/);
  assert.match(html, /Alonso/);
  assert.match(html, /Jessie 2\/3/);
  assert.match(html, /Jasser 4/);
  assert.match(html, /Alonso 1\/2\/3/);
  assert.match(html, /8,000/);
  assert.match(html, /2,000/);
  assert.match(html, /A 5,302/);
  assert.ok(html.indexOf("Jessie 2/3") < html.indexOf("Alonso 1/2/3"));
  assert.ok(html.indexOf("8,000") < html.indexOf("2,000"));
  assert.match(html, /D 1,618/);
  assert.match(html, />FAIL</);
  assert.match(html, />PASS</);
  assert.match(html, /color:#f38ba8/);
  assert.match(html, /color:#a6e3a1/);
  assert.ok(html.indexOf("-130.50%") < html.indexOf("-6920.0"));
});
