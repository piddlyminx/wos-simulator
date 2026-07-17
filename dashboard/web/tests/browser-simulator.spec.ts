import { expect, test } from "@playwright/test";

test("numeric fields can be cleared before typing a replacement", async ({
  page,
}) => {
  await page.goto("/simulate");

  const simulateReplicates = page.getByRole("spinbutton", {
    name: "Replicates",
  });
  await simulateReplicates.fill("");
  await expect(simulateReplicates).toHaveValue("");
  await simulateReplicates.pressSequentially("5000");
  await simulateReplicates.blur();
  await expect(simulateReplicates).toHaveValue("5000");

  const troopCount = page
    .locator('input[aria-label="infantry troop count"]')
    .first();
  await troopCount.fill("");
  await expect(troopCount).toHaveValue("");
  await troopCount.pressSequentially("5000");
  await troopCount.blur();
  await expect(troopCount).toHaveValue("5000");

  await page.goto("/bear");
  const bearReplicates = page.getByRole("spinbutton", { name: "Replicates" });
  await bearReplicates.fill("");
  await expect(bearReplicates).toHaveValue("");
  await bearReplicates.pressSequentially("5000");
  await bearReplicates.blur();
  await expect(bearReplicates).toHaveValue("5000");

  await page.goto("/tournament");
  const tournamentInfantryMains = page.locator("fieldset", {
    has: page.getByText("Infantry mains", { exact: true }),
  });
  await expect(tournamentInfantryMains.getByRole("checkbox", { name: "Logan" })).toBeVisible();
  const tournamentJoiners = page.locator("fieldset", {
    has: page.getByText("Joiners", { exact: true }),
  });
  await expect(tournamentJoiners.getByRole("checkbox", { name: "Sonya" })).toBeVisible();
  await expect(tournamentJoiners.getByRole("checkbox", { name: "Hendrik" })).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "Top rows" })).toHaveValue("250");
  await expect(page.getByRole("spinbutton", { name: "Rounds", exact: true })).toHaveValue("20");
  await expect(page.getByRole("spinbutton", { name: "Freeze start" })).toHaveValue("8");
  await expect(page.getByRole("spinbutton", { name: "Min pool" })).toHaveValue("500");
  await expect(page.getByRole("spinbutton", { name: "Finals top" })).toHaveValue("500");
  await expect(page.getByRole("spinbutton", { name: "Finals reps" })).toHaveValue("10");
  await expect(page.getByText('Multiple ratios can be added separated by ";" or " ".')).toBeVisible();
  const totalTroops = page.getByRole("spinbutton", { name: "Total troops" });
  await totalTroops.fill("");
  await expect(totalTroops).toHaveValue("");
  await totalTroops.pressSequentially("5000");
  await totalTroops.blur();
  await expect(totalTroops).toHaveValue("5000");
});

test("server compute routes are removed", async ({ request }) => {
  await expect((await request.post("/api/simulate")).status()).toBe(404);
  await expect((await request.post("/api/simulate/optimize-ratio")).status()).toBe(404);
});

test("/tournament saves completed results and activates the share URL", async ({ page }) => {
  await page.addInitScript(() => {
    class MockTournamentWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;

      postMessage(message: { id: number; type: string }) {
        if (message.type !== "tournament") return;
        setTimeout(() => {
          this.onmessage?.({
            data: {
              id: message.id,
              type: "tournamentResult",
              data: {
                generatedTeams: 2,
                swiss: {
                  offense: { rows: [], totalRows: 0 },
                  defense: { rows: [], totalRows: 0 },
                },
              },
            },
          } as MessageEvent);
        }, 0);
      }

      terminate() {}
    }

    window.Worker = MockTournamentWorker as unknown as typeof Worker;
  });

  let savedPayload: { kind?: string } | null = null;
  await page.route("**/api/simulate/runs", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    savedPayload = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        saved_run_id: "browser-tournament",
        saved_at: "2026-07-17T12:00:00.000Z",
        saved_kind: "tournament",
        share_url: "/tournament?run=browser-tournament",
      }),
    });
  });

  await page.goto("/tournament");
  await page.getByRole("button", { name: "Run tournament" }).click();

  await expect(page).toHaveURL(/\/tournament\?run=browser-tournament$/);
  await expect(page.getByTestId("tournament-saved-run-banner")).toContainText("browser-tournament");
  await expect(page.getByRole("button", { name: "Swiss offense" })).toBeVisible();
  expect(savedPayload).toMatchObject({ kind: "tournament" });
});

test("/tournament loads a tournament from Recent tournaments", async ({ page }) => {
  const savedTournament = {
    version: 1,
    id: "recent-tournament",
    kind: "tournament",
    created_at: "2026-07-17T11:00:00.000Z",
    share_url: "/tournament?run=recent-tournament",
    request: {
      groups: [{
        label: "Loaded batch",
        infantryMains: ["Hector"],
        lancerMains: ["Mia"],
        marksmanMains: ["Bradley"],
        joiners: ["Jessie", "Seo-yoon", "Lumak", "Ling"],
        ratios: ["60,20,20"],
        allowRepeatedJoiners: false,
        excludeMainHeroesFromJoiners: true,
      }],
      totalTroops: 4242,
      rounds: 3,
      seedRounds: 1,
      reps: 1,
      jobs: 1,
      seed: 99,
      freezeRate: 0.2,
      freezeLossesGte: null,
      startFreezeRound: 2,
      minPoolSize: 2,
      topN: 10,
      finalsTopM: 0,
      finalsReps: 1,
      finalsMaxSameMainLineup: 10,
    },
    result: {
      generatedTeams: 2,
      swiss: {
        offense: { rows: [], totalRows: 0 },
        defense: { rows: [], totalRows: 0 },
      },
    },
  };

  await page.route("**/api/simulate/runs**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/recent-tournament")) {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(savedTournament) });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        runs: [{
          id: savedTournament.id,
          kind: savedTournament.kind,
          created_at: savedTournament.created_at,
          share_url: savedTournament.share_url,
          title: "Tournament: Loaded batch (3 rounds)",
        }],
        has_more: false,
        next_offset: 1,
      }),
    });
  });

  await page.goto("/tournament");
  await page.getByRole("button", { name: "Recent tournaments" }).click();
  const recentTournamentsDialog = page.getByRole("dialog", { name: "Recent tournaments" });
  await expect(recentTournamentsDialog).toBeVisible();
  await expect(recentTournamentsDialog.locator(".sim-modal")).toHaveCSS("background-color", "rgb(30, 30, 46)");
  await page.getByRole("button", { name: /Tournament: Loaded batch/ }).click();

  await expect(page).toHaveURL(/\/tournament\?run=recent-tournament$/);
  await expect(page.getByRole("spinbutton", { name: "Total troops" })).toHaveValue("4242");
  await expect(page.getByRole("spinbutton", { name: "Rounds", exact: true })).toHaveValue("3");
  await expect(page.getByTestId("tournament-saved-run-banner")).toContainText("recent-tournament");
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
      const payload = route.request().postDataJSON();
      expect(payload.kind).toBe("optimize_ratio");
      expect(payload.request).not.toHaveProperty("replicates");
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
