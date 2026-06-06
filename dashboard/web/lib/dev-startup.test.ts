import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("dev startup syncs the repo-root uv environment before Next starts", () => {
  const packageJson = JSON.parse(
    readFileSync(join(webRoot, "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  const startupScript = readFileSync(
    join(webRoot, "scripts", "dev-startup.sh"),
    "utf8",
  );

  assert.match(packageJson.scripts?.dev ?? "", /dev-startup\.sh/);
  assert.match(startupScript, /uv sync/);
  assert.match(startupScript, /next-cache-lock\.sh/);
});
