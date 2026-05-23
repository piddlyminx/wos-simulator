import { expect, test } from "@playwright/test";

test("/simulate uses browser worker for simulation and saves afterward", async ({ page }) => {
  const forbidden: string[] = [];
  await page.route("**/api/simulate", async (route) => {
    forbidden.push(route.request().url());
    await route.abort();
  });
  await page.route("**/api/simulate/optimize-ratio", async (route) => {
    forbidden.push(route.request().url());
    await route.abort();
  });
  await page.route("**/api/simulate/runs", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          saved_run_id: "browser-sim",
          saved_at: "2026-05-22T00:00:00.000Z",
          saved_kind: "simulate",
          share_url: "/simulate?run=browser-sim",
        }),
      });
      return;
    }
    await route.continue();
  });
  await page.goto("/simulate");
  await page.getByRole("spinbutton", { name: /replicates/i }).fill("1");
  await page.getByRole("button", { name: /^Simulate$/i }).click();
  await expect(page.getByTestId("simulate-outcome-chart")).toBeVisible();
  expect(forbidden).toEqual([]);
});

test("/simulate uses browser worker for optimise ratio and saves afterward", async ({ page }) => {
  const forbidden: string[] = [];
  await page.route("**/api/simulate", async (route) => {
    forbidden.push(route.request().url());
    await route.abort();
  });
  await page.route("**/api/simulate/optimize-ratio", async (route) => {
    forbidden.push(route.request().url());
    await route.abort();
  });
  await page.route("**/api/simulate/runs", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          saved_run_id: "browser-opt",
          saved_at: "2026-05-22T00:00:00.000Z",
          saved_kind: "optimize_ratio",
          share_url: "/simulate?run=browser-opt",
        }),
      });
      return;
    }
    await route.continue();
  });
  await page.goto("/simulate");
  await expect(page.locator("body")).toContainText(/up to .* battles/i);
  await page.locator('input[aria-label="infantry troop count"]').first().fill("3");
  await page.locator('input[aria-label="lancer troop count"]').first().fill("0");
  await page.locator('input[aria-label="marksman troop count"]').first().fill("0");
  await page.getByTestId("optimize-options-toggle").click();
  await page.getByRole("button", { name: /^grid$/i }).click();
  await page.getByLabel("Ratio reps").fill("1");
  await page.getByLabel("Grid step").fill("1");
  await page.getByRole("button", { name: /optimise ratio/i }).click();
  await expect(page.getByTestId("optimize-results")).toBeVisible();
  await expect(page.getByTestId("optimize-results")).toContainText(
    /battle simulations/i,
  );
  expect(forbidden).toEqual([]);
});
