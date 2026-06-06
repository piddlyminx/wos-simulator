import assert from "node:assert/strict";
import { test } from "node:test";

import { Pool } from "./pools";
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

test("active scores sort by win rate, average margin, then team id descending", () => {
  const pool = new Pool([team(1), team(2), team(3)]);
  pool.getScore(1).matches = 2;
  pool.getScore(1).wins = 1;
  pool.getScore(1).margin = 20;
  pool.getScore(2).matches = 2;
  pool.getScore(2).wins = 1;
  pool.getScore(2).margin = 20;
  pool.getScore(3).matches = 2;
  pool.getScore(3).wins = 2;
  pool.getScore(3).margin = 1;

  assert.deepEqual(pool.teamsActiveOrdered.map((item) => item.id), [3, 2, 1]);
});

test("freezeBottomTeams inserts later better freezes before earlier worse freezes", () => {
  const pool = new Pool([team(1), team(2), team(3), team(4)]);
  pool.getScore(1).matches = 1;
  pool.getScore(1).margin = 40;
  pool.getScore(2).matches = 1;
  pool.getScore(2).margin = 30;
  pool.getScore(3).matches = 1;
  pool.getScore(3).margin = 20;
  pool.getScore(4).matches = 1;
  pool.getScore(4).margin = 10;

  pool.freezeBottomTeams(0.25);
  pool.getScore(3).margin = -100;
  pool.freezeBottomTeams(0.25);

  assert.deepEqual(pool.teamsFinalOrdered.map((item) => item.id), [3, 4]);
});

test("freezeBottomCount freezes the requested number of lowest active teams", () => {
  const pool = new Pool([team(1), team(2), team(3), team(4)]);
  pool.getScore(1).matches = 2;
  pool.getScore(1).wins = 2;
  pool.getScore(2).matches = 2;
  pool.getScore(2).wins = 1;
  pool.getScore(3).matches = 2;
  pool.getScore(3).wins = 0;
  pool.getScore(4).matches = 2;
  pool.getScore(4).wins = 0;
  pool.getScore(4).margin = -10;

  pool.freezeBottomCount(2);

  assert.deepEqual(pool.teamsActiveOrdered.map((item) => item.id), [1, 2]);
  assert.deepEqual(pool.teamsFinalOrdered.map((item) => item.id), [3, 4]);
});

test("freezeLossesAtLeast freezes loss threshold matches plus any extra bottom-ranked teams", () => {
  const pool = new Pool([team(1), team(2), team(3), team(4)]);
  pool.getScore(1).matches = 5;
  pool.getScore(1).wins = 3;
  pool.getScore(2).matches = 4;
  pool.getScore(2).wins = 1;
  pool.getScore(3).matches = 6;
  pool.getScore(3).wins = 1;
  pool.getScore(4).matches = 3;
  pool.getScore(4).wins = 3;

  pool.freezeLossesAtLeast(3, 3);

  assert.deepEqual(pool.teamsActiveOrdered.map((item) => item.id), [4]);
  assert.deepEqual(pool.teamsFinalOrdered.map((item) => item.id), [1, 2, 3]);
});

test("finalizeRemaining preserves active teams above frozen teams", () => {
  const pool = new Pool([team(1), team(2), team(3)]);
  pool.getScore(1).matches = 1;
  pool.getScore(1).margin = 10;
  pool.getScore(2).matches = 1;
  pool.getScore(2).margin = 20;
  pool.getScore(3).matches = 1;
  pool.getScore(3).margin = 30;

  pool.freezeBottomTeams(0.34);
  pool.finalizeRemaining();

  assert.deepEqual(pool.finalScoresOrdered.map((score) => score.team.id), [3, 2, 1]);
});
