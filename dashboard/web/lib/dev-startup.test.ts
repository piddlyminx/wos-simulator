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
  const cacheLockScript = readFileSync(
    join(webRoot, "scripts", "next-cache-lock.sh"),
    "utf8",
  );
  const dockerEntrypoint = readFileSync(
    join(webRoot, "docker-entrypoint.sh"),
    "utf8",
  );
  const nextConfig = readFileSync(join(webRoot, "next.config.ts"), "utf8");
  const devCompose = readFileSync(join(webRoot, "..", "..", "docker-compose.yml"), "utf8");
  const prodCompose = readFileSync(
    join(webRoot, "..", "..", "docker-compose.prod.yml"),
    "utf8",
  );
  const devDockerfile = readFileSync(join(webRoot, "Dockerfile"), "utf8");

  assert.match(packageJson.scripts?.dev ?? "", /dev-startup\.sh/);
  assert.match(packageJson.scripts?.["dev:docker"] ?? "", /next-cache-lock\.sh/);
  assert.match(startupScript, /uv sync/);
  assert.match(startupScript, /next-cache-lock\.sh/);
  assert.match(cacheLockScript, /flock -n 9/);
  assert.match(cacheLockScript, /\/repo\/node_modules\/\.bin\/next/);
  assert.match(dockerEntrypoint, /cd \/repo\/dashboard\/web/);
  assert.match(dockerEntrypoint, /\/repo\/dashboard\/web\/\.next/);
  assert.doesNotMatch(dockerEntrypoint, /npm ci/);
  assert.match(devCompose, /- \.\/dashboard:\/repo\/dashboard:ro/);
  assert.match(devCompose, /- wos_next_cache:\/repo\/dashboard\/web\/\.next/);
  assert.match(devCompose, /- \/repo\/dashboard\/web\/node_modules/);
  assert.doesNotMatch(devCompose, /wos_node_modules/);
  assert.match(devCompose, /target: dev/);
  assert.match(prodCompose, /dockerfile: dashboard\/web\/Dockerfile/);
  assert.match(prodCompose, /target: prod/);
  assert.doesNotMatch(prodCompose, /Dockerfile\.prod/);
  assert.match(devDockerfile, /WORKDIR \/repo/);
  assert.match(devDockerfile, /NODE_PATH=\/repo\/node_modules/);
  assert.match(devDockerfile, /FROM deps AS dev/);
  assert.match(devDockerfile, /FROM deps AS prod-build/);
  assert.match(devDockerfile, /FROM prod-build AS prod/);
  assert.match(nextConfig, /outputFileTracingExcludes/);
  assert.match(nextConfig, /\.\/next\.config\.ts/);
  assert.match(nextConfig, /\.\/tests\/\*\*/);
});
