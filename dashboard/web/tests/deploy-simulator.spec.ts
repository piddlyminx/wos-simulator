import { expect, test, type Page } from "@playwright/test";

const VIEWPORTS = [
  { name: "mobile", width: 375, height: 667 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
  { name: "wide", width: 2048, height: 1152 },
] as const;

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

test("/deploy unifies the complete Battle and Bear workspaces", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const response = await page.goto("/deploy");
  expect(response?.status()).toBe(200);

  await expect(page.getByRole("heading", { name: "Deploy" })).toBeVisible();
  await expect(page.getByTestId("simulate-start-card")).toBeVisible();
  await expect(page.getByTestId("side-section-attacker-troops")).toBeVisible();
  await expect(page.getByTestId("side-section-defender-troops")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Simulate" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Optimise" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Explore" })).toBeVisible();
  await expect(page.getByTestId("sim-panel-results")).toBeHidden();
  await expect(page.getByTestId("sim-action-dock")).toHaveCSS("position", "sticky");

  await page.getByRole("tab", { name: /Bear Rally score/ }).click();
  await expect(page).toHaveURL(/\/deploy\?mode=bear$/);
  await expect(page.getByRole("heading", { name: "Deploy" })).toBeVisible();
  await expect(page.getByTestId("bear-start-card")).toBeVisible();
  await expect(page.getByTestId("side-section-attacker-troops")).toBeVisible();
  await expect(page.getByTestId("bear-runbar")).toBeVisible();
  await expect(page.getByTestId("bear-optimize-panel")).toBeVisible();
});

test("/deploy uses game-like army controls without losing simulator inputs", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/deploy?mode=battle");

  const infantryCount = page.getByLabel("infantry troop count").first();
  const lancerCount = page.getByLabel("lancer troop count").first();
  const marksmanCount = page.getByLabel("marksman troop count").first();

  await page.getByRole("button", { name: "10 / 45 / 45" }).first().click();
  await expect(infantryCount).toHaveValue("15000");
  await expect(lancerCount).toHaveValue("67500");
  await expect(marksmanCount).toHaveValue("67500");

  await page.getByRole("button", { name: "Choose infantry hero, currently none" }).first().click();
  await expect(page.getByRole("dialog", { name: "Select Infantry hero" })).toBeVisible();
  await page.getByLabel("Search heroes").fill("Gatot");
  await expect(page.getByRole("button", { name: /Gatot/ }).locator("img")).toBeVisible();
  await expect(page.getByRole("button", { name: /Gregory/ })).toHaveCount(0);
  await page.getByRole("button", { name: /Gatot/ }).click();
  await page.getByRole("button", { name: "Assign" }).click();
  await expect(page.getByRole("button", { name: "Choose infantry hero, currently Gatot" })).toBeVisible();

  await page.getByRole("button", { name: /Stats Base \+ effective/ }).first().click();
  await expect(page.getByRole("dialog", { name: "Attacker stats" })).toBeVisible();
  await page.getByLabel("Infantry Attack").fill("321.5");
  await page.getByRole("button", { name: "Done" }).click();

  await page.getByLabel("Rally mode").check();
  await expect(page.getByRole("button", { name: /Joiners 0\/4 assigned/ }).first()).toBeVisible();
  await page.getByRole("button", { name: /Joiners 0\/4 assigned/ }).first().click();
  await page.getByLabel("attacker joiner 1").selectOption("Jessie");
  await page.getByRole("button", { name: "Done" }).click();
});

test("/deploy keeps setup tools and advanced Battle modes reachable", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/deploy?mode=battle");

  await page.getByRole("button", { name: "Upload report" }).click();
  await expect(page.getByRole("dialog", { name: "Upload battle report" })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByTestId("recent-runs-toggle").click();
  await expect(page.getByTestId("recent-runs-modal")).toBeVisible();
  await page.getByRole("button", { name: /Close recent runs/i }).click();

  await page.getByLabel("attacker player profile").click();
  await expect(page.getByTestId("stat-profile-modal")).toBeVisible();
  await page.getByRole("button", { name: "Close profile modal" }).click();

  await page.getByRole("tab", { name: "Optimise" }).click();
  await page.getByTestId("optimize-options-toggle").click();
  await expect(page.getByTestId("optimize-options-panel")).toBeVisible();

  await page.getByRole("tab", { name: "Explore" }).click();
  const exploreOptions = page.getByTestId("optimize-options-toggle");
  if ((await exploreOptions.getAttribute("aria-expanded")) !== "true") {
    await exploreOptions.click();
  }
  await expect(page.getByTestId("explore-ratios-options-panel")).toBeVisible();
});

test("/deploy keeps recent-run navigation in the alternative interface", async ({ page }) => {
  await page.route("**/api/simulate/runs?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        runs: [
          {
            id: "deploy-recent-battle",
            kind: "simulate",
            created_at: "2026-08-19T12:00:00.000Z",
            kept: false,
            share_url: "/simulate?run=deploy-recent-battle",
            title: "Recent deployment",
          },
        ],
        has_more: false,
      }),
    });
  });

  await page.goto("/deploy?mode=battle");
  await page.getByTestId("recent-runs-toggle").click();
  await page.getByRole("button", { name: /Recent deployment/ }).click();
  await expect(page).toHaveURL(
    /\/deploy\?mode=battle&run=deploy-recent-battle$/,
  );
});

test("/deploy separates this browser's runs from the global archive", async ({ page }) => {
  let releaseAllRuns: (() => void) | undefined;
  const allRunsCanRespond = new Promise<void>((resolve) => {
    releaseAllRuns = resolve;
  });
  await page.route("**/api/simulate/runs?*", async (route) => {
    const scope = new URL(route.request().url()).searchParams.get("scope");
    if (scope === "all") await allRunsCanRespond;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        runs: [
          {
            id: `${scope}-deployment`,
            kind: "simulate",
            created_at: "2026-08-19T12:00:00.000Z",
            kept: scope === "starred",
            share_url: `/simulate?run=${scope}-deployment`,
            title:
              scope === "mine"
                ? "My deployment"
                : scope === "starred"
                  ? "Starred deployment"
                  : "Global deployment",
          },
        ],
        has_more: false,
      }),
    });
  });

  await page.goto("/deploy?mode=battle");
  await page.getByTestId("recent-runs-toggle").click();
  const modal = page.getByTestId("recent-runs-modal");
  await expect(modal.getByRole("button", { name: "My runs" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(modal.getByText("My deployment")).toBeVisible();
  await expect(modal.getByRole("button", { name: "Clean up" })).toHaveCount(0);
  await expect(
    modal.getByRole("button", { name: "Star saved run mine-deployment" }),
  ).toHaveAttribute("aria-pressed", "false");

  await modal.getByRole("button", { name: "Starred" }).click();
  await expect(modal.getByText("Starred deployment")).toBeVisible();
  await expect(
    modal.getByRole("button", { name: "Unstar saved run starred-deployment" }),
  ).toHaveAttribute("aria-pressed", "true");

  await modal.getByRole("button", { name: "All runs" }).click();
  await expect(modal.getByRole("button", { name: "All runs" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const allRunsResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/simulate/runs" && url.searchParams.get("scope") === "all";
  });
  await modal.getByRole("button", { name: "My runs" }).click();
  await expect(modal.getByText("My deployment")).toBeVisible();
  releaseAllRuns?.();
  await allRunsResponse;
  await expect(modal.getByText("Global deployment")).toHaveCount(0);
  await expect(modal.getByText("My deployment")).toBeVisible();
});

test("/deploy keeps a populated recent-runs modal stable while refreshing", async ({ page }) => {
  let requestCount = 0;
  let markRefreshStarted: (() => void) | undefined;
  let releaseRefresh: (() => void) | undefined;
  const refreshStarted = new Promise<void>((resolve) => {
    markRefreshStarted = resolve;
  });
  const refreshCanRespond = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  const runs = Array.from({ length: 10 }, (_, index) => ({
    id: `stable-modal-run-${index}`,
    kind: "simulate",
    created_at: "2026-08-19T12:00:00.000Z",
    kept: false,
    share_url: `/simulate?run=stable-modal-run-${index}`,
    title: `Stable modal run ${index + 1}`,
  }));

  await page.route("**/api/simulate/runs?*", async (route) => {
    requestCount += 1;
    if (requestCount === 2) {
      markRefreshStarted?.();
      await refreshCanRespond;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ runs, has_more: false }),
    });
  });

  await page.goto("/deploy?mode=battle");
  await page.getByTestId("recent-runs-toggle").click();
  const modal = page.getByTestId("recent-runs-modal");
  const panel = modal.locator(".sim-modal");
  await expect(modal.getByText("Stable modal run 1", { exact: true })).toBeVisible();
  const loadedHeight = (await panel.boundingBox())?.height;

  await modal.getByRole("button", { name: "Close recent runs" }).click();
  await page.getByTestId("recent-runs-toggle").click();
  await refreshStarted;
  await expect(modal.getByRole("button", { name: "Refreshing…" })).toBeVisible();
  await expect(modal.getByText("Stable modal run 1", { exact: true })).toBeVisible();
  const refreshingHeight = (await panel.boundingBox())?.height;
  const refreshResponse = page.waitForResponse((response) =>
    response.url().includes("/api/simulate/runs?"),
  );
  releaseRefresh?.();
  await refreshResponse;

  expect(loadedHeight).toBeDefined();
  expect(refreshingHeight).toBeDefined();
  expect(Math.abs((refreshingHeight ?? 0) - (loadedHeight ?? 0))).toBeLessThanOrEqual(1);
});

test("/deploy changes recent-run scopes in one visual transition", async ({ page }) => {
  let markAllRunsStarted: (() => void) | undefined;
  let releaseAllRuns: (() => void) | undefined;
  const allRunsStarted = new Promise<void>((resolve) => {
    markAllRunsStarted = resolve;
  });
  const allRunsCanRespond = new Promise<void>((resolve) => {
    releaseAllRuns = resolve;
  });
  const mineRuns = Array.from({ length: 10 }, (_, index) => ({
    id: `scope-transition-mine-${index}`,
    kind: "simulate",
    created_at: "2026-08-19T12:00:00.000Z",
    kept: false,
    share_url: `/simulate?run=scope-transition-mine-${index}`,
    title: `Scope transition mine ${index + 1}`,
  }));
  const allRuns = [{
    id: "scope-transition-all",
    kind: "simulate",
    created_at: "2026-08-19T12:00:00.000Z",
    kept: false,
    share_url: "/simulate?run=scope-transition-all",
    title: "Scope transition all",
  }];

  await page.route("**/api/simulate/runs?*", async (route) => {
    const scope = new URL(route.request().url()).searchParams.get("scope");
    if (scope === "all") {
      markAllRunsStarted?.();
      await allRunsCanRespond;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        runs: scope === "all" ? allRuns : mineRuns,
        has_more: false,
      }),
    });
  });

  await page.goto("/deploy?mode=battle");
  await page.getByTestId("recent-runs-toggle").click();
  const modal = page.getByTestId("recent-runs-modal");
  const panel = modal.locator(".sim-modal");
  await expect(modal.getByText("Scope transition mine 1", { exact: true })).toBeVisible();
  const mineHeight = (await panel.boundingBox())?.height;

  await modal.getByRole("button", { name: "All runs" }).click();
  await allRunsStarted;
  await expect(modal.getByText("Loading all runs…", { exact: true })).toBeVisible();
  await expect(modal.getByText("Scope transition mine 1", { exact: true })).toBeHidden();
  const loadingHeight = (await panel.boundingBox())?.height;

  expect(mineHeight).toBeDefined();
  expect(loadingHeight).toBeDefined();
  expect(Math.abs((loadingHeight ?? 0) - (mineHeight ?? 0))).toBeLessThanOrEqual(1);

  releaseAllRuns?.();
  await expect(modal.getByText("Scope transition all", { exact: true })).toBeVisible();
});

for (const viewport of VIEWPORTS) {
  test(`/deploy fits the ${viewport.name} viewport`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const response = await page.goto("/deploy?mode=battle");
    expect(response?.status()).toBe(200);
    await expect(page.getByTestId("deploy-simulator")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByRole("tab", { name: /Bear Rally score/ }).click();
    await expect(page.getByTestId("bear-start-card")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
}
