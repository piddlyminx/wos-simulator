import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("battle mode benchmark prints average signed score for full and fast modes", () => {
  const cwd = fileURLToPath(new URL("..", import.meta.url));
  const result = spawnSync("npx", ["--yes", "tsx", "scripts/benchmark_tournament_battle_modes.ts", "2"], {
    cwd,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  const output = result.stdout;

  const full = output.split("\n").find((line: string) => line.startsWith("full:"));
  const fast = output.split("\n").find((line: string) => line.startsWith("fast:"));

  assert.match(full ?? "", /avg_signed_score=-?\d+\.\d{2}/);
  assert.match(fast ?? "", /avg_signed_score=-?\d+\.\d{2}/);
  assert.doesNotMatch(output, /score_checksum/);
});
