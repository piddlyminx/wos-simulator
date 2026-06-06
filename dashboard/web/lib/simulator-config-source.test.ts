import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";

test("web hero helpers do not import duplicated dashboard assets", () => {
  const libDir = path.resolve(import.meta.dirname);
  for (const file of ["heroes-catalogue.ts", "hero-base-stats.ts"]) {
    const source = readFileSync(path.join(libDir, file), "utf8");
    assert.equal(
      source.includes("../assets/"),
      false,
      `${file} should use simulator config as source of truth`,
    );
  }
});
