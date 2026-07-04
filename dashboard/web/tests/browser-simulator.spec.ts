import { expect, test } from "@playwright/test";

test("server compute routes are removed", async ({ request }) => {
  await expect((await request.post("/api/simulate")).status()).toBe(404);
  await expect((await request.post("/api/simulate/optimize-ratio")).status()).toBe(404);
});

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
  await page.getByTestId("optimize-options-toggle").click();
  await page.getByRole("spinbutton", { name: /replicates/i }).fill("1");
  await page.getByRole("button", { name: /^Simulate$/i }).click();
  const chart = page.getByTestId("simulate-outcome-chart");
  await expect(chart).toBeVisible();
  const outcomePoint = page.getByRole("button", { name: /pin outcome bucket/i }).first();
  await expect(outcomePoint).toBeVisible();
  await outcomePoint.click();
  await expect(page.getByTestId("simulate-pinned-tooltip")).toBeVisible();
  await chart.click({ position: { x: 20, y: 20 } });
  await expect(page.getByTestId("simulate-pinned-tooltip")).toBeHidden();
  await outcomePoint.click();
  await expect(page.getByTestId("simulate-pinned-tooltip")).toBeVisible();
  await page.getByRole("button", { name: /show example/i }).first().click();
  await expect(page.getByText("Example battle trace")).toBeVisible();
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
  await page.locator('input[aria-label="infantry troop count"]').first().fill("3");
  await page.locator('input[aria-label="lancer troop count"]').first().fill("0");
  await page.locator('input[aria-label="marksman troop count"]').first().fill("0");
  await page.getByRole("tab", { name: "Optimise ratio" }).click();
  await expect(page.locator("body")).toContainText(/up to .* battles/i);
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

test("/simulate uses browser worker for explore ratios and saves afterward", async ({ page }) => {
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
      const payload = route.request().postDataJSON();
      expect(payload.kind).toBe("ratio_explorer");
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          saved_run_id: "browser-explore",
          saved_at: "2026-05-22T00:00:00.000Z",
          saved_kind: "ratio_explorer",
          share_url: "/simulate?run=browser-explore",
        }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/simulate");
  for (const label of ["infantry", "lancer", "marksman"]) {
    await page.locator(`input[aria-label="${label} troop count"]`).nth(0).fill("1");
    await page.locator(`input[aria-label="${label} troop count"]`).nth(1).fill("1");
  }
  await page.getByRole("tab", { name: "Explore ratios" }).click();
  await page.getByTestId("optimize-options-toggle").click();
  const options = page.getByTestId("explore-ratios-options-panel");
  await options.getByLabel("Points / edge").selectOption("6");
  await options.getByLabel("Ratio reps").fill("1");
  await options.getByLabel("Workers").fill("1");

  await page.locator(".sim-mode-primary-button").click();
  await expect(page.getByTestId("surface-results")).toBeVisible();
  await expect(page.locator(".sim-mode-primary-button")).toHaveText("Explore ratios");
  await expect(page).toHaveURL(/\/simulate\?run=browser-explore$/);
  expect(forbidden).toEqual([]);
});
