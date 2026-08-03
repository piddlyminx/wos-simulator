import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { CoverageSnapshot } from "@/types/dashboard";
import { applyLiveTestcaseCoverage } from "./live-coverage";

function snapshot(hero: string, skillId: string): CoverageSnapshot {
  return {
    run_id: "historical-run",
    hero,
    skill_id: skillId,
    testcase_count: 99,
    battle_outcome_count: 99,
    covered_bool: 0
  };
}

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
    const rows = applyLiveTestcaseCoverage(
      [snapshot("Gatot", "1"), snapshot("Gatot", "2"), snapshot("Gatot", "3")],
      root
    );
    assert.deepEqual(
      rows.map(({ testcase_count, battle_outcome_count, covered_bool }) => ({
        testcase_count,
        battle_outcome_count,
        covered_bool
      })),
      [
        { testcase_count: 2, battle_outcome_count: 3, covered_bool: 1 },
        { testcase_count: 0, battle_outcome_count: 0, covered_bool: 0 },
        { testcase_count: 1, battle_outcome_count: 1, covered_bool: 1 }
      ]
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
