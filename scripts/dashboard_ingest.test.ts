import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { openDashboardDb, snapshotCoverage } from "./dashboard_ingest";

test("snapshot coverage counts testcase entries per active skill recursively", () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "dashboard-coverage-"));
  const heroDir = path.join(repoRoot, "simulator", "config", "hero_definitions");
  const testcaseDir = path.join(repoRoot, "testcases", "nested");
  mkdirSync(heroDir, { recursive: true });
  mkdirSync(testcaseDir, { recursive: true });
  writeFileSync(
    path.join(heroDir, "TestHero.json"),
    JSON.stringify({
      skills: {
        one: { name: "One" },
        two: { name: "Two" },
        three: { name: "Three" }
      }
    })
  );
  writeFileSync(
    path.join(testcaseDir, "cases.json"),
    JSON.stringify([
      {
        attacker: { heroes: { TestHero: { skill_1: 1, skill_3: 1 } } },
        game_report_result: [{ attacker: 1, defender: 0 }]
      },
      {
        defender: { heroes: { TestHero: { skill_1: 1 } } },
        game_report_result: [
          { attacker: 1, defender: 0 },
          { attacker: 1, defender: 0 }
        ]
      }
    ])
  );

  const db = openDashboardDb(":memory:");
  try {
    const runId = "coverage-test";
    db.prepare(`
      INSERT INTO runs (
        id, finished_at, git_sha, dirty,
        cli_args_json, thresholds_json, summary_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(runId, "2026-01-01T00:00:00", "abc123", 0, "{}", "{}", "{}");

    snapshotCoverage(runId, db, repoRoot);
    const rows = db.prepare(`
      SELECT skill_num, testcase_count, battle_outcome_count, covered_bool
      FROM coverage_snapshots
      WHERE run_id = ? AND hero = 'TestHero'
      ORDER BY skill_num
    `).all(runId);

    assert.deepEqual(rows, [
      { skill_num: 1, testcase_count: 2, battle_outcome_count: 3, covered_bool: 1 },
      { skill_num: 2, testcase_count: 0, battle_outcome_count: 0, covered_bool: 0 },
      { skill_num: 3, testcase_count: 1, battle_outcome_count: 1, covered_bool: 1 }
    ]);
  } finally {
    db.close();
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
