import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Pool } from "./pools";
import { deriveResultsLabel, loadAllRankedTeamsFromCsv, writeCombinedResultsCsv, writeResultsCsv } from "./results";
import type { Team } from "./types";

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
  assert.equal(deriveResultsLabel("swiss_mixed_20260510-160417"), "mixed");
  assert.equal(deriveResultsLabel("plain_dir"), "plain_dir");
});

test("writeResultsCsv preserves schema and formatting", () => {
  const root = mkdtempSync(join(tmpdir(), "dual-swiss-"));
  try {
    const teams = [team(1), team(2)];
    const attackPool = new Pool(teams);
    const defensePool = new Pool(teams);
    for (const pool of [attackPool, defensePool]) {
      pool.getScore(1).winRateSum = 1;
      pool.getScore(1).matches = 2;
      pool.getScore(1).games = 20;
      pool.getScore(1).margin = 7;
      pool.getScore(2).winRateSum = 2;
      pool.getScore(2).matches = 2;
      pool.getScore(2).games = 20;
      pool.getScore(2).margin = 9;
      pool.finalizeRemaining();
    }

    writeResultsCsv(join(root, "swiss"), attackPool, defensePool, 2);
    const text = readFileSync(join(root, "swiss_off.csv"), "utf8").trim();
    assert.equal(
      text.split("\n")[0],
      "rank,win_rate,avg_margin,games,formation,hero_1,hero_2,hero_3,joiner_1,joiner_2,joiner_3,joiner_4"
    );
    assert.match(text, /1,1\.0000,4\.50,20,50-20-30,Wu Ming,Mia,Bradley,Jessie,Seo-yoon,Lumak,Ling/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("writeCombinedResultsCsv writes combined standings csv", () => {
  const root = mkdtempSync(join(tmpdir(), "standard-swiss-"));
  try {
    const teams = [team(1)];
    const pool = new Pool(teams);
    pool.getScore(1).winRateSum = 2;
    pool.getScore(1).matches = 2;
    pool.getScore(1).games = 20;
    pool.getScore(1).margin = 12;
    pool.getScore(1).attack = { winRateSum: 1, matches: 1, margin: 8 };
    pool.getScore(1).defense = { winRateSum: 1, matches: 1, margin: 4 };
    pool.finalizeRemaining();

    writeCombinedResultsCsv(join(root, "swiss"), pool, 1);
    const text = readFileSync(join(root, "swiss_combined.csv"), "utf8").trim();
    assert.equal(
      text.split("\n")[0],
      "rank,win_rate,avg_margin,attack_win_rate,attack_avg_margin,defense_win_rate,defense_avg_margin,games,formation,hero_1,hero_2,hero_3,joiner_1,joiner_2,joiner_3,joiner_4"
    );
    assert.match(text, /1,1\.0000,6\.00,1\.0000,8\.00,1\.0000,4\.00,20,50-20-30,Wu Ming,Mia,Bradley,Jessie,Seo-yoon,Lumak,Ling/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadAllRankedTeamsFromCsv rebuilds troops from formation and row ids", () => {
  const root = mkdtempSync(join(tmpdir(), "dual-swiss-"));
  try {
    const file = join(root, "swiss_off.csv");
    const csv = [
      "rank,win_rate,avg_margin,games,formation,hero_1,hero_2,hero_3,joiner_1,joiner_2,joiner_3,joiner_4",
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

test("CSV replay retains the first occurrence of a build before applying candidate limits", () => {
  const root = mkdtempSync(join(tmpdir(), "unique-swiss-"));
  try {
    const file = join(root, "swiss_off.csv");
    writeFileSync(file, [
      "rank,win_rate,avg_margin,games,formation,hero_1,hero_2,hero_3,joiner_1,joiner_2,joiner_3,joiner_4",
      "1,0.9,100,30,40-1-59,Magnus,Molly,Xura,Hendrik,Patrick,Mia,Norah",
      "2,0.8,90,30,40-1-59,Magnus,Molly,Xura,Norah,Mia,Patrick,Hendrik",
      "3,0.7,80,30,40-1-59,Magnus,Molly,Xura,Patrick,Mia,Norah,Norah",
      "4,0.6,70,30,49-2-49,Magnus,Molly,Xura,Hendrik,Patrick,Mia,Norah",
      ""
    ].join("\n"));
    const teams = loadAllRankedTeamsFromCsv(file, 100);
    assert.deepEqual(teams.map(entry => entry.id), [0, 2, 3]);
    assert.deepEqual(teams[0].joiners, ["Hendrik", "Patrick", "Mia", "Norah"]);
    assert.deepEqual(teams[1].joiners, ["Patrick", "Mia", "Norah", "Norah"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
