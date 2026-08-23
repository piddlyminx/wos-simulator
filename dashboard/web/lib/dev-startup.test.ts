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
  const nextConfig = readFileSync(join(webRoot, "next.config.ts"), "utf8");
  const playwrightConfig = readFileSync(
    join(webRoot, "playwright.config.ts"),
    "utf8",
  );
  const devCompose = readFileSync(join(webRoot, "..", "..", "docker-compose.yml"), "utf8");
  const prodCompose = readFileSync(
    join(webRoot, "..", "..", "docker-compose.prod.yml"),
    "utf8",
  );
  const devDockerfile = readFileSync(join(webRoot, "Dockerfile"), "utf8");

  assert.match(packageJson.scripts?.dev ?? "", /NEXT_DIST_DIR=\.next-dev/);
  assert.match(packageJson.scripts?.dev ?? "", /dev-startup\.sh/);
  assert.match(
    packageJson.scripts?.["dev-user"] ?? "",
    /NEXT_DIST_DIR=\.next-user/,
  );
  assert.match(
    packageJson.scripts?.["dev:playwright"] ?? "",
    /NEXT_DIST_DIR=\.next-playwright/,
  );
  assert.match(packageJson.scripts?.["dev:docker"] ?? "", /next dev --webpack/);
  assert.match(packageJson.scripts?.build ?? "", /next build --webpack/);
  assert.equal(packageJson.scripts?.playwright, "playwright test");
  assert.equal(packageJson.scripts?.smoke, "npm run build && npm run playwright");
  assert.match(playwrightConfig, /npm run dev:playwright/);
  assert.doesNotMatch(playwrightConfig, /command: `npm run dev --/);
  assert.match(startupScript, /uv sync/);
  assert.match(startupScript, /exec next "\$@"/);
  assert.match(devCompose, /- \.\/dashboard:\/repo\/dashboard:ro/);
  assert.match(devCompose, /- \/repo\/dashboard\/web\/node_modules/);
  assert.match(devCompose, /- \/repo\/dashboard\/web\/\.next/);
  assert.doesNotMatch(devCompose, /wos_next_cache/);
  assert.doesNotMatch(devCompose, /docker-entrypoint\.sh/);
  assert.doesNotMatch(devCompose, /wos_node_modules/);
  assert.match(devCompose, /target: dev/);
  assert.match(prodCompose, /dockerfile: dashboard\/web\/Dockerfile/);
  assert.match(prodCompose, /target: prod/);
  assert.doesNotMatch(prodCompose, /Dockerfile\.prod/);
  assert.match(devDockerfile, /WORKDIR \/repo/);
  assert.match(devDockerfile, /WORKDIR \/repo\/dashboard\/web/);
  assert.match(devDockerfile, /NODE_PATH=\/repo\/node_modules/);
  assert.doesNotMatch(devDockerfile, /docker-entrypoint\.sh/);
  assert.match(devDockerfile, /FROM deps AS dev/);
  assert.match(devDockerfile, /FROM deps AS prod-build/);
  assert.match(devDockerfile, /FROM prod-build AS prod/);
  assert.match(nextConfig, /outputFileTracingExcludes/);
  assert.match(nextConfig, /\.\/next\.config\.ts/);
  assert.match(nextConfig, /\.\/tests\/\*\*/);
});
