import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { getActiveTestcaseKeys, getLiveHeroCoverage } from "./live-coverage";

test("live coverage recursively reads active testcase JSON", () => {
  const root = mkdtempSync(path.join(tmpdir(), "live-coverage-"));
  const nested = path.join(root, "gatot_verified");
  mkdirSync(nested);
  writeFileSync(
    path.join(nested, "gatot.json"),
    JSON.stringify([
      {
        attacker: { heroes: { Gatot: { skill_1: 1, skill_3: 3 } } },
        defender: { heroes: {} },
        game_report_result: [{ attacker: 10, defender: 0 }]
      },
      {
        attacker: { heroes: { Gatot: { skill_1: 1 } } },
        defender: { heroes: {} },
        game_report_result: [
          { attacker: 9, defender: 0 },
          { attacker: 8, defender: 0 }
        ]
      }
    ])
  );
  writeFileSync(
    path.join(nested, "ignored.json.disabled"),
    JSON.stringify([{ attacker: { heroes: { Gatot: { skill_2: 2 } } } }])
  );

  try {
    const rows = getLiveHeroCoverage(
      [
        { hero: "Gatot", skillId: "1" },
        { hero: "Gatot", skillId: "2" },
        { hero: "Gatot", skillId: "3" },
      ],
      root
    );
    assert.deepEqual(
      rows.map(({ testcaseCount, battleOutcomeCount, covered }) => ({
        testcaseCount,
        battleOutcomeCount,
        covered,
      })),
      [
        { testcaseCount: 2, battleOutcomeCount: 3, covered: true },
        { testcaseCount: 0, battleOutcomeCount: 0, covered: false },
        { testcaseCount: 1, battleOutcomeCount: 1, covered: true },
      ]
    );
    assert.deepEqual(
      getActiveTestcaseKeys(root).map(({ testcase_id, idx }) => ({
        testcase_id,
        idx,
      })),
      [
        { testcase_id: "0", idx: 0 },
        { testcase_id: "1", idx: 1 },
      ],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
