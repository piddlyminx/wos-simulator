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
