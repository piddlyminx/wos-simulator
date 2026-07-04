import assert from "node:assert/strict";
import { test } from "node:test";

import { buildSimulatorSampleMetadata } from "./ParityCaseSummary";

test("simulator sample metadata omits single stored sample score delta", () => {
  const metadata = buildSimulatorSampleMetadata({
    row: {
      key: "testcases/example.json#0",
      file: "testcases/example.json",
      testcaseId: "example",
      idx: 0,
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
        passes: true,
      },
      baseline: null,
    },
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
