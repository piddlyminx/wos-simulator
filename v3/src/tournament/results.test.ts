import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Pool } from "./pools.js";
import { deriveResultsLabel, loadAllRankedTeamsFromCsv, writeResultsCsv } from "./results.js";
import type { Team } from "./types.js";

function team(id: number): Team {
  return {
    id,
    mains: ["Wu Ming", "Mia", "Bradley"],
    joiners: ["Jessie", "Seo-yoon", "Lumak", "Ling"],
    ratioLabel: "50-20-30",
    troops: { infantry_t10: 50, lancer_t10: 20, marksman_t10: 30 }
  };
}

test("deriveResultsLabel strips ds prefix and timestamp suffix", () => {
  assert.equal(deriveResultsLabel("50-20-30"), "50-20-30");
  assert.equal(deriveResultsLabel("ds_mixed_20260510-160417"), "mixed");
  assert.equal(deriveResultsLabel("plain_dir"), "plain_dir");
});

test("writeResultsCsv preserves schema and formatting", () => {
  const root = mkdtempSync(join(tmpdir(), "dual-swiss-"));
  try {
    const teams = [team(1), team(2)];
    const attackPool = new Pool(teams);
    const defensePool = new Pool(teams);
    for (const pool of [attackPool, defensePool]) {
      pool.getScore(1).wins = 1;
      pool.getScore(1).matches = 2;
      pool.getScore(1).margin = 7;
      pool.getScore(2).wins = 2;
      pool.getScore(2).matches = 2;
      pool.getScore(2).margin = 9;
      pool.finalizeRemaining();
    }

    writeResultsCsv(join(root, "swiss"), attackPool, defensePool, 2);
    const text = readFileSync(join(root, "swiss_off.csv"), "utf8").trim();
    assert.equal(
      text.split("\n")[0],
      "rank,win_rate,avg_margin,matches,formation,hero_1,hero_2,hero_3,joiner_1,joiner_2,joiner_3,joiner_4"
    );
    assert.match(text, /1,1\.0000,4\.50,2,50-20-30,Wu Ming,Mia,Bradley,Jessie,Seo-yoon,Lumak,Ling/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadAllRankedTeamsFromCsv rebuilds troops from formation and row ids", () => {
  const root = mkdtempSync(join(tmpdir(), "dual-swiss-"));
  try {
    const file = join(root, "swiss_off.csv");
    const csv = [
      "rank,win_rate,avg_margin,matches,formation,hero_1,hero_2,hero_3,joiner_1,joiner_2,joiner_3,joiner_4",
      "1,1.0000,10.00,2,60-40-0,Wu Ming,Mia,Bradley,Jessie,Seo-yoon,Lumak,Ling"
    ].join("\n");
    writeFileSync(file, `${csv}\n`);
    const teams = loadAllRankedTeamsFromCsv(file, 100);
    assert.equal(teams[0].id, 0);
    assert.deepEqual(teams[0].troops, { infantry_t10: 60, lancer_t10: 40, marksman_t10: 0 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
