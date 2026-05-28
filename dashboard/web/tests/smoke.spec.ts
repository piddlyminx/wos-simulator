import { test, expect, Page } from "@playwright/test";
import Database from "better-sqlite3";
import path from "path";

const DIRTY_RUN_ID = "aea74765-66e1-4f7c-b721-3565f98319ee";

const DB_PATH =
  process.env.DB_PATH ??
  path.resolve(__dirname, "../../../test_results/dashboard.sqlite");

function twoMostRecentRunIds(): { a: string; b: string } {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const rows = db
      .prepare(`SELECT id FROM runs ORDER BY started_at DESC LIMIT 2`)
      .all() as { id: string }[];
    if (rows.length < 2) {
      throw new Error(
        `Need at least 2 runs in ${DB_PATH} for compare smoke tests; found ${rows.length}`,
      );
    }
    // a = older (baseline), b = newer (current)
    return { a: rows[1].id, b: rows[0].id };
  } finally {
    db.close();
  }
}

async function assertNoConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

const SAVED_SIMULATION_ID = "run-share-wos-357";
const SAVED_SIMULATION_REQUEST = {
  attacker: {
    troops: { infantry: 1111, lancer: 222, marksman: 333 },
    troop_types: {
      infantry: "infantry_t7",
      lancer: "lancer_t8",
      marksman: "marksman_t9",
    },
    heroes: {
      infantry: { name: "Logan", skills: [5, 5, 5, 5] },
      lancer: { name: "Mia", skills: [5, 4, 3, 0] },
      marksman: { name: "Alonso", skills: [5, 5, 5, 5] },
    },
    joiners: [{ name: "Jessie", skill_1: 5 }],
    stat_profile_name: "Attacker archived profile",
    stats: {
      inf: [110, 111, 112, 113],
      lanc: [120, 121, 122, 123],
      mark: [130, 131, 132, 133],
    },
  },
  defender: {
    troops: { infantry: 444, lancer: 555, marksman: 666 },
    troop_types: {
      infantry: "infantry_t6",
      lancer: "lancer_t6",
      marksman: "marksman_t6",
    },
    heroes: {
      infantry: { name: "Flint", skills: [5, 5, 5, 5] },
      lancer: { name: "Philly", skills: [5, 5, 5, 0] },
      marksman: { name: "Wayne", skills: [5, 5, 5, 0] },
    },
    joiners: [{ name: "Patrick", skill_1: 5 }],
    stat_profile_name: "Defender archived profile",
    stats: {
      inf: [140, 141, 142, 143],
      lanc: [150, 151, 152, 153],
      mark: [160, 161, 162, 163],
    },
  },
  replicates: 222,
  rally_mode: true,
} as const;

const SAVED_SIMULATION_RESULT = {
  replicates: 222,
  summary: {
    mean: 81.5,
    std: 21.4,
    best: { value: 140, winner: "attacker" },
    worst: { value: -45, winner: "defender" },
    attacker_win_rate: 0.71,
    avg_skill_activations: 8.6,
    avg_skill_kills: 133.2,
    avg_attacker_activations: 4.7,
    avg_defender_activations: 3.9,
    avg_attacker_kills: 77.1,
    avg_defender_kills: 56.1,
  },
  outcomes: [120, 75, 90, -10],
  per_side_skills: {
    attacker: [{ name: "Battle Cry", avg_activations: 2.1, avg_kills: 19.4 }],
    defender: [{ name: "Shield Wall", avg_activations: 1.4, avg_kills: 11.2 }],
  },
} as const;

const DRAW_SIMULATION_ID = "run-share-all-draws";
const DRAW_SIMULATION_REQUEST = {
  ...SAVED_SIMULATION_REQUEST,
  attacker: {
    ...SAVED_SIMULATION_REQUEST.attacker,
    troops: { infantry: 1000, lancer: 1000, marksman: 1000 },
  },
  defender: {
    ...SAVED_SIMULATION_REQUEST.defender,
    troops: { infantry: 1000, lancer: 1000, marksman: 1000 },
  },
  replicates: 1000,
} as const;

const DRAW_SIMULATION_RESULT = {
  ...SAVED_SIMULATION_RESULT,
  replicates: 1000,
  summary: {
    ...SAVED_SIMULATION_RESULT.summary,
    mean: 0,
    std: 0,
    best: { value: 0, winner: "draw" },
    worst: { value: 0, winner: "draw" },
    attacker_win_rate: 0,
  },
  outcomes: Array.from({ length: 1000 }, () => 0),
} as const;

test.describe("Dashboard smoke tests", () => {
  test("/ — home page renders all five cards with drill-down links", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    const response = await page.goto("/");
    expect(response?.status()).toBe(200);

    const cardIds = [
      "card-latest-run",
      "card-regressions",
      "card-coverage",
      "card-testcase-changes",
      "card-recent-commits",
    ];
    for (const id of cardIds) {
      await expect(page.locator(`[data-testid="${id}"]`)).toBeVisible();
      const cardLinks = await page
        .locator(`[data-testid="${id}"] a[href]`)
        .count();
      expect(cardLinks).toBeGreaterThan(0);
    }

    // Five-way headline labels (WOS-186 Skipped included)
    const latest = page.locator('[data-testid="card-latest-run"]');
    for (const label of [
      "Improved",
      "Regressed",
      "Added",
      "Retired",
      "Skipped",
    ]) {
      await expect(latest).toContainText(label);
    }

    // Sidebar nav link exists
    await expect(page.locator('nav a[href="/"]')).toBeVisible();

    expect(errors).toHaveLength(0);
  });

  test("/runs — lists at least one run", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    const response = await page.goto("/runs");
    expect(response?.status()).toBe(200);
    expect(response?.headers()["content-length"]).not.toBe("0");

    // Wait for the table to appear (inside accordion which defaults open)
    await page.waitForSelector('[data-testid="runs-table"] tbody tr', {
      timeout: 10_000,
    });
    const rows = await page
      .locator('[data-testid="runs-table"] tbody tr')
      .count();
    expect(rows).toBeGreaterThan(0);

    expect(errors).toHaveLength(0);
  });

  test("/runs — check-now controls are visible and the filter expands", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    const response = await page.goto("/runs");
    expect(response?.status()).toBe(200);

    await expect(
      page.locator('[data-testid="check-now-controls"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="check-now-button"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="check-now-filter-input"]'),
    ).toHaveCount(0);

    await page.locator('[data-testid="check-now-filter-toggle"]').click();
    const input = page.locator('[data-testid="check-now-filter-input"]');
    await expect(input).toBeVisible();
    await input.fill("alonso solo");
    await expect(input).toHaveValue("alonso solo");

    expect(errors).toHaveLength(0);
  });

  test("/runs — testcase variance chart bridges missing middle-run data with a dashed line", async ({
    page,
  }) => {
    // WOS-189: run-index x-axis + dotted-bridge for interior coverage gaps.
    // Real fixture data includes >100 testcases missing from at least one
    // run in the last 50, so top-variance selection will reliably include
    // at least one gappy series when the chart renders.
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    const response = await page.goto("/runs");
    expect(response?.status()).toBe(200);

    // Chart SVG should render. Recharts emits <path class="recharts-line-curve">
    // for each Line — one per solid series plus one per dashed bridge.
    await page.waitForSelector(".recharts-line-curve", { timeout: 10_000 });

    // At least one solid line (actual data) present.
    const solidPaths = await page
      .locator("path.recharts-line-curve:not([stroke-dasharray])")
      .count();
    expect(solidPaths).toBeGreaterThan(0);

    // At least one dashed bridge path present (interpolated gap).
    const dashedPaths = await page
      .locator("path.recharts-line-curve[stroke-dasharray]")
      .count();
    expect(dashedPaths).toBeGreaterThan(0);

    expect(errors).toHaveLength(0);
  });

  test("/runs — testcase drift legend can pin a series for identification", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    const response = await page.goto("/runs");
    expect(response?.status()).toBe(200);

    await page.waitForSelector('[data-testid="testcase-drift-legend"] button', {
      timeout: 10_000,
    });
    await page.mouse.move(0, 0);

    const focus = page.locator('[data-testid="testcase-drift-focus"]');
    await expect(focus).toBeVisible();

    const firstLegendItem = page
      .locator('[data-testid="testcase-drift-legend"] button')
      .first();
    await firstLegendItem.click();
    await expect(firstLegendItem).toHaveAttribute("aria-pressed", "true");
    await expect(focus).toContainText("Pinned series: #1");
    await expect(focus).toContainText("Click again to clear.");

    await firstLegendItem.click();
    await page.mouse.move(0, 0);
    await expect(firstLegendItem).toHaveAttribute("aria-pressed", "false");
    await expect(focus).toContainText(
      "Hover a legend row or chart line to isolate a testcase",
    );

    expect(errors).toHaveLength(0);
  });

  test("/runs — hovered testcase is emphasized inside the hover tooltip", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    const response = await page.goto("/runs");
    expect(response?.status()).toBe(200);

    await page.waitForSelector('[data-testid="testcase-drift-legend"] button', {
      timeout: 10_000,
    });
    const firstLegendItem = page
      .locator('[data-testid="testcase-drift-legend"] button')
      .first();
    await firstLegendItem.click();

    const chart = page.locator('[data-testid="testcase-drift-chart"]');
    const box = await chart.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(
      box!.x + box!.width * 0.25,
      box!.y + box!.height * 0.55,
    );

    const tooltip = page.locator('[data-testid="testcase-drift-tooltip"]');
    await expect(tooltip).toBeVisible();
    await expect(
      page.locator('[data-testid="testcase-drift-focus"]'),
    ).toContainText("Pinned series:");
    await expect(
      page.locator('[data-testid="testcase-drift-tooltip-row"]'),
    ).not.toHaveCount(0);
    await expect(
      page.locator('[data-testid="testcase-drift-tooltip-row-active"]'),
    ).toHaveCount(0);

    expect(errors).toHaveLength(0);
  });

  test("/runs — smoke-run toggle is off by default and prunes x-axis ticks when enabled", async ({
    page,
  }) => {
    // WOS-189 follow-up: board asked for smoke-run filtering to be opt-in,
    // with default behaviour showing every run that any visible top-N series
    // has data in. The toggle should be unchecked on first render and
    // reduce the number of x-axis ticks when turned on (fixture data has a
    // substantial number of 1-3-testcase smoke runs in the last 50).
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    const response = await page.goto("/runs");
    expect(response?.status()).toBe(200);
    await page.waitForSelector(".recharts-line-curve", { timeout: 10_000 });

    const toggle = page.locator(
      '[data-testid="hide-smoke-runs-toggle"] input[type="checkbox"]',
    );
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toBeChecked();

    const ticksBefore = await page
      .locator(".recharts-xAxis .recharts-cartesian-axis-tick")
      .count();
    expect(ticksBefore).toBeGreaterThan(0);

    await toggle.check();
    await expect(toggle).toBeChecked();
    // Give Recharts a tick to re-render.
    await page.waitForTimeout(250);
    const ticksAfter = await page
      .locator(".recharts-xAxis .recharts-cartesian-axis-tick")
      .count();
    expect(ticksAfter).toBeLessThan(ticksBefore);

    expect(errors).toHaveLength(0);
  });

  test("/coverage — renders without crash", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    const response = await page.goto("/coverage");
    expect(response?.status()).toBe(200);

    // Either shows data table cells OR the DB-misconfiguration warning (heroes table not yet seeded)
    const hasCells = (await page.locator("table tbody td").count()) > 0;
    const hasMisconfigWarning =
      (await page.locator("text=DB misconfiguration").count()) > 0;
    expect(hasCells || hasMisconfigWarning).toBe(true);
    if (hasCells) {
      for (const hero of ["Bradley", "Edith", "Gordon", "Ling"]) {
        await expect(page.locator("body")).toContainText(hero);
      }
    }

    expect(errors).toHaveLength(0);
  });

  test("/heroes — renders without crash", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    const response = await page.goto("/heroes");
    expect(response?.status()).toBe(200);

    const hasRows = (await page.locator("tbody tr").count()) > 0;
    const hasMisconfigWarning =
      (await page.locator("text=DB misconfiguration").count()) > 0;
    expect(hasRows || hasMisconfigWarning).toBe(true);
    if (hasRows) {
      await expect(page.locator("body")).toContainText("Gen 7");
      for (const hero of ["Bradley", "Edith", "Gordon", "Ling"]) {
        await expect(page.locator("body")).toContainText(hero);
      }
    }

    expect(errors).toHaveLength(0);
  });

  test("/simulate — gen 7 heroes are selectable", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    const response = await page.goto("/simulate");
    expect(response?.status()).toBe(200);

    await expect(page.locator("h2")).toContainText("Simulate Battle");

    const infantryOptions = await page
      .locator('select[aria-label="infantry hero"]')
      .first()
      .locator("option")
      .allTextContents();
    expect(infantryOptions).toContain("Edith");

    const lancerOptions = await page
      .locator('select[aria-label="lancer hero"]')
      .first()
      .locator("option")
      .allTextContents();
    expect(lancerOptions).toContain("Gordon");
    expect(lancerOptions).toContain("Ling");

    const marksmanOptions = await page
      .locator('select[aria-label="marksman hero"]')
      .first()
      .locator("option")
      .allTextContents();
    expect(marksmanOptions).toContain("Bradley");

    expect(errors).toHaveLength(0);
  });

  test("/simulate — sync hero stats is checked by default", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    const response = await page.goto("/simulate");
    expect(response?.status()).toBe(200);

    await expect(
      page.getByRole("checkbox", { name: "Update stats on hero change" }),
    ).toBeChecked();

    expect(errors).toHaveLength(0);
  });

  test("/simulate — successful runs update the URL to the saved share link", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    await page.route("**/api/simulate/runs", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      const payload = route.request().postDataJSON();
      expect(payload.kind).toBe("simulate");
      expect(payload.request.attacker.stat_profile_name).toBeNull();
      expect(payload.request.defender.stat_profile_name).toBeNull();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          saved_run_id: SAVED_SIMULATION_ID,
          saved_at: "2026-04-23T08:30:00.000Z",
          saved_kind: "simulate",
          share_url: `/simulate?run=${SAVED_SIMULATION_ID}`,
        }),
      });
    });

    const response = await page.goto("/simulate");
    expect(response?.status()).toBe(200);

    await page.getByRole("spinbutton", { name: /replicates/i }).fill("1");
    await page.getByRole("button", { name: /^Simulate$/i }).click();
    await expect(page.getByTestId("simulate-outcome-chart")).toBeVisible();
    await expect(page).toHaveURL(
      new RegExp(`/simulate\\?run=${SAVED_SIMULATION_ID}$`),
    );
    await expect(page.getByTestId("saved-run-banner")).toContainText(
      "Loaded saved simulation run",
    );
    await expect(page.getByTestId("saved-run-banner")).toContainText(
      SAVED_SIMULATION_ID,
    );

    expect(errors).toHaveLength(0);
  });

  test("/simulate — loaded stat profile names are included in run snapshots", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    await page.route("**/api/simulate/stat-presets", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          presets: [
            {
              id: "attacker-profile",
              name: "Attacker saved profile",
              created_at: "2026-04-23T08:00:00.000Z",
              updated_at: "2026-04-23T08:00:00.000Z",
              stats: {
                infantry: {
                  attack: 201,
                  defense: 202,
                  lethality: 203,
                  health: 204,
                },
                lancer: {
                  attack: 211,
                  defense: 212,
                  lethality: 213,
                  health: 214,
                },
                marksman: {
                  attack: 221,
                  defense: 222,
                  lethality: 223,
                  health: 224,
                },
              },
            },
          ],
        }),
      });
    });

    await page.route("**/api/simulate/runs", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      const payload = route.request().postDataJSON();
      expect(payload.kind).toBe("simulate");
      expect(payload.request.attacker.stat_profile_name).toBe("Attacker saved profile");
      expect(payload.request.defender.stat_profile_name).toBeNull();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          saved_run_id: "profile-snapshot-run",
          saved_at: "2026-04-23T08:31:00.000Z",
          saved_kind: "simulate",
          share_url: "/simulate?run=profile-snapshot-run",
        }),
      });
    });

    const response = await page.goto("/simulate");
    expect(response?.status()).toBe(200);

    await page.getByLabel("attacker player profile").click();
    const dialog = page.getByTestId("stat-profile-modal");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("attacker stat profile").selectOption("attacker-profile");
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator("body")).toContainText("Attacker saved profile");

    await page.getByRole("spinbutton", { name: /replicates/i }).fill("1");
    await page.getByRole("button", { name: /^Simulate$/i }).click();
    await expect(page.getByTestId("simulate-outcome-chart")).toBeVisible();

    expect(errors).toHaveLength(0);
  });

  test("/simulate — visiting a saved run URL hydrates inputs and results", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    await page.route(`**/api/simulate/runs/${SAVED_SIMULATION_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          version: 1,
          id: SAVED_SIMULATION_ID,
          kind: "simulate",
          created_at: "2026-04-23T08:30:00.000Z",
          share_url: `/simulate?run=${SAVED_SIMULATION_ID}`,
          request: SAVED_SIMULATION_REQUEST,
          result: SAVED_SIMULATION_RESULT,
        }),
      });
    });

    const response = await page.goto(`/simulate?run=${SAVED_SIMULATION_ID}`);
    expect(response?.status()).toBe(200);

    await expect(page.getByTestId("saved-run-banner")).toContainText(
      "Loaded saved simulation run",
    );
    await expect(
      page.locator('input[aria-label="infantry troop count"]').first(),
    ).toHaveValue("1111");
    await expect(page.getByLabel("Rally mode").first()).toBeChecked();
    await expect(
      page.locator('select[aria-label="infantry hero"]').first(),
    ).toHaveValue("Logan");
    await expect(page.locator("body")).toContainText(
      "Attacker archived profile",
    );
    await expect(page.locator("body")).toContainText(
      "Defender archived profile",
    );
    await expect(
      page.locator("h3").filter({ hasText: /Results \(222 replicates\)/ }),
    ).toBeVisible();
    await expect(page.locator("body")).toContainText("82 (attacker)");
    const chart = page.getByTestId("simulate-outcome-chart");
    await expect(chart).toHaveAttribute("data-axis-limit", "1666");
    await expect(chart).toHaveAttribute("data-axis-reversed", "true");

    await page
      .getByRole("button", { name: "Swap attacker and defender" })
      .click();
    await expect(chart).toHaveAttribute("data-axis-reversed", "false");

    expect(errors).toHaveLength(0);
  });

  test("/simulate — all-draw outcome distribution peaks at zero", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    await page.route(`**/api/simulate/runs/${DRAW_SIMULATION_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          version: 1,
          id: DRAW_SIMULATION_ID,
          kind: "simulate",
          created_at: "2026-05-24T15:52:00.000Z",
          share_url: `/simulate?run=${DRAW_SIMULATION_ID}`,
          request: DRAW_SIMULATION_REQUEST,
          result: DRAW_SIMULATION_RESULT,
        }),
      });
    });

    const response = await page.goto(`/simulate?run=${DRAW_SIMULATION_ID}`);
    expect(response?.status()).toBe(200);

    await expect(page.locator("body")).toContainText("0 (draw)");
    const chart = page.getByTestId("simulate-outcome-chart");
    await expect(chart).toHaveAttribute("data-axis-limit", "3000");
    await expect(chart).toHaveAttribute("data-peak-bucket", "0");

    expect(errors).toHaveLength(0);
  });

  test("/simulate — active skill 4 bonuses show effective stat previews", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    const response = await page.goto("/simulate");
    expect(response?.status()).toBe(200);

    await page.getByLabel("Rally mode").first().check();
    await page
      .locator('select[aria-label="marksman hero"]')
      .first()
      .selectOption("Alonso");
    await expect(
      page.locator('select[aria-label="marksman skill 4"]').first(),
    ).toHaveValue("5");

    const preview = page.locator(
      '[data-testid="stat-preview-attacker-infantry-lethality"]',
    );
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("[130]");
    await expect(preview).toContainText("+15.0%");

    expect(errors).toHaveLength(0);
  });

  test("/simulate — manual stat toggles combine with skill 4 and opponent debuffs", async ({
    page,
  }) => {
    const errors = await assertNoConsoleErrors(page);

    const response = await page.goto("/simulate");
    expect(response?.status()).toBe(200);

    await page.getByLabel("Rally mode").first().check();
    await page
      .locator('select[aria-label="marksman hero"]')
      .first()
      .selectOption("Alonso");
    await page.locator('[data-testid="city-modifier-details-attacker"]').click();
    await page
      .locator('[data-testid="stat-modifier-attacker-lethality-10"]')
      .click();

    const lethalityPreview = page.locator(
      '[data-testid="stat-preview-attacker-infantry-lethality"]',
    );
    await expect(lethalityPreview).toBeVisible();
    await expect(lethalityPreview).toContainText("[150]");
    await expect(lethalityPreview).toContainText("+25.0%");

    await page
      .locator('[data-testid="stat-modifier-attacker-attack-10"]')
      .click();
    await page.locator('[data-testid="city-modifier-details-defender"]').click();
    await page
      .locator('[data-testid="stat-modifier-defender-enemy_attack-20"]')
      .click();
    const attackInput = page.getByLabel("Infantry Attack").first();
    await expect(attackInput).toHaveValue("100");

    const attackPreview = page.locator(
      '[data-testid="stat-preview-attacker-infantry-attack"]',
    );
    await expect(attackPreview).toContainText("[83.3]");
    await expect(attackPreview).toContainText("+10.0%");
    await expect(attackPreview).toContainText("-20.0%");

    expect(errors).toHaveLength(0);
  });

  test("/simulate — city presets and pet buffs update stat previews", async ({
    page,
  }) => {
    const errors = await assertNoConsoleErrors(page);

    const response = await page.goto("/simulate");
    expect(response?.status()).toBe(200);

    await page.locator('[data-testid="city-modifier-attacker-10"]').click();
    await expect(
      page.locator('[data-testid="stat-preview-attacker-infantry-attack"]'),
    ).toContainText("+10.0%");

    await page.locator('[data-testid="pet-modifier-defender-toggle"]').click();
    await expect(
      page.locator('[data-testid="stat-preview-attacker-infantry-defense"]'),
    ).toContainText("-10.0%");

    await page.locator('[data-testid="pet-modifier-details-defender"]').click();
    await expect(
      page.locator('[data-testid="pet-modifier-defender-enemy_defense"]'),
    ).toHaveAttribute("max", "10");
    await expect(
      page.locator('[data-testid="pet-modifier-defender-enemy_lethality"]'),
    ).toHaveAttribute("max", "5");
    await expect(
      page.locator('[data-testid="pet-modifier-defender-enemy_health"]'),
    ).toHaveAttribute("max", "5");
    await page
      .locator('[data-testid="pet-modifier-defender-enemy_defense"]')
      .fill("10");
    await expect(
      page.locator('[data-testid="stat-preview-attacker-infantry-defense"]'),
    ).toContainText("-10.0%");

    expect(errors).toHaveLength(0);
  });

  test("/simulate — stat bonus inputs accept typed decimals", async ({
    page,
  }) => {
    const errors = await assertNoConsoleErrors(page);

    const response = await page.goto("/simulate");
    expect(response?.status()).toBe(200);

    const input = page.getByLabel("Infantry Attack").first();
    await input.fill("");
    await input.pressSequentially("100.");
    await expect(input).toHaveValue("100.");

    await input.pressSequentially("5");
    await expect(input).toHaveValue("100.5");

    await input.blur();
    await expect(input).toHaveValue("100.5");
    expect(errors).toHaveLength(0);
  });

  test("/simulate — desktop troop-count tab order moves across counts first", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    const response = await page.goto("/simulate");
    expect(response?.status()).toBe(200);

    const infantryCount = page
      .locator('input[aria-label="infantry troop count"]')
      .first();
    const lancerCount = page
      .locator('input[aria-label="lancer troop count"]')
      .first();
    const marksmanCount = page
      .locator('input[aria-label="marksman troop count"]')
      .first();

    await infantryCount.focus();
    await expect(infantryCount).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(lancerCount).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(marksmanCount).toBeFocused();

    await page.keyboard.press("Shift+Tab");
    await expect(lancerCount).toBeFocused();

    expect(errors).toHaveLength(0);
  });

  test("/simulate — optimise options stay collapsed by default and replace sim results", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    await page.route("**/api/simulate/runs", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      const payload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          saved_run_id: `${payload.kind}-replace-test`,
          saved_at: "2026-04-23T08:32:00.000Z",
          saved_kind: payload.kind,
          share_url: `/simulate?run=${payload.kind}-replace-test`,
        }),
      });
    });

    const response = await page.goto("/simulate");
    expect(response?.status()).toBe(200);

    await expect(
      page.locator('[data-testid="optimize-options-panel"]'),
    ).toHaveCount(0);
    await page.getByTestId("optimize-options-toggle").click();
    await expect(
      page.locator('[data-testid="optimize-options-panel"]'),
    ).toBeVisible();
    await expect(page.locator("body")).toContainText(
      "1,119 comps · 30/10/100 reps · up to 16,770 battles",
    );

    await page.locator('input[aria-label="infantry troop count"]').first().fill("1");
    await page.locator('input[aria-label="lancer troop count"]').first().fill("1");
    await page.locator('input[aria-label="marksman troop count"]').first().fill("1");
    await page.getByRole("button", { name: /^grid$/i }).click();
    await page.getByLabel("Ratio reps").fill("1");
    await page.getByLabel("Grid step").fill("1");
    await page.getByRole("button", { name: /^Optimise ratio$/i }).click();
    await expect(
      page.getByRole("heading", { name: "Ratio Optimisation" }),
    ).toBeVisible();
    await expect(
      page.locator("h3").filter({ hasText: /Results \(/ }),
    ).toHaveCount(0);

    await page.getByRole("spinbutton", { name: /replicates/i }).fill("1");
    await page.getByRole("button", { name: /^Simulate$/i }).click();
    await expect(page.getByTestId("simulate-outcome-chart")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Ratio Optimisation" }),
    ).toHaveCount(0);

    expect(errors).toHaveLength(0);
  });

  test("/simulate — optimise ratio renders compact selectable results and applies the selected mix", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    await page.route("**/api/simulate/runs", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      const payload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          saved_run_id: "optimize-apply-test",
          saved_at: "2026-04-23T08:33:00.000Z",
          saved_kind: payload.kind,
          share_url: "/simulate?run=optimize-apply-test",
        }),
      });
    });

    const response = await page.goto("/simulate");
    expect(response?.status()).toBe(200);

    await page.locator('input[aria-label="infantry troop count"]').first().fill("3");
    await page.locator('input[aria-label="lancer troop count"]').first().fill("0");
    await page.locator('input[aria-label="marksman troop count"]').first().fill("0");
    await page.getByTestId("optimize-options-toggle").click();
    await page.getByRole("button", { name: /^grid$/i }).click();
    await page.getByLabel("Ratio reps").fill("1");
    await page.getByLabel("Grid step").fill("1");
    await page.getByRole("button", { name: /Optimise ratio/i }).click();
    await expect(page.locator("body")).toContainText("Ratio Optimisation");
    await expect(page.locator("body")).toContainText("Top 10 ratios");
    await expect(page.locator("body")).toContainText("3D win-rate samples");
    await expect(page.locator("body")).toContainText("Only tested ratios are drawn");
    await expect(page.locator("body")).not.toContainText("Avg optimized survivors");
    await expect(page.locator("body")).toContainText("30%–70%");

    const ratioTable = page.locator("table").filter({ hasText: "Winrate" });
    await expect(ratioTable.locator("thead th")).toHaveText([
      "#",
      "Winrate",
      "Margin",
      "Ratio",
      "Troops",
    ]);

    const selectedRow = ratioTable.locator("tbody tr").nth(1);
    await selectedRow.click();
    await expect(selectedRow).toHaveAttribute("aria-selected", "true");
    const selectedCounts = (await selectedRow.locator("td").nth(4).innerText())
      .split("/")
      .map(Number);

    await page.getByRole("button", { name: /Use selected attacker ratio/i }).click();
    const appliedCounts = await Promise.all([
      page.locator('input[aria-label="infantry troop count"]').first().inputValue(),
      page.locator('input[aria-label="lancer troop count"]').first().inputValue(),
      page.locator('input[aria-label="marksman troop count"]').first().inputValue(),
    ]);
    expect(appliedCounts.map(Number)).toEqual(selectedCounts);
    expect(appliedCounts.map(Number).reduce((sum, value) => sum + value, 0)).toBe(3);

    expect(errors).toHaveLength(0);
  });

  test("/simulate upload — selected skill 4 level carries back to main form", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    await page.route("**/api/ocr-report", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          attacker: {
            troops: { infantry: 123, lancer: 234, marksman: 345 },
            stats: {
              infantry: {
                attack: 100,
                defense: 100,
                lethality: 100,
                health: 100,
              },
              lancer: {
                attack: 100,
                defense: 100,
                lethality: 100,
                health: 100,
              },
              marksman: {
                attack: 100,
                defense: 100,
                lethality: 100,
                health: 100,
              },
            },
          },
          defender: {
            troops: { infantry: 456, lancer: 567, marksman: 678 },
            stats: {
              infantry: {
                attack: 100,
                defense: 100,
                lethality: 100,
                health: 100,
              },
              lancer: {
                attack: 100,
                defense: 100,
                lethality: 100,
                health: 100,
              },
              marksman: {
                attack: 100,
                defense: 100,
                lethality: 100,
                health: 100,
              },
            },
          },
          warnings: [],
        }),
      });
    });

    const response = await page.goto("/simulate");
    expect(response?.status()).toBe(200);

    await page.getByRole("button", { name: /Upload report/i }).click();
    const dialog = page.getByRole("dialog", { name: "Upload battle report" });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel("Rally mode").check();
    await dialog.getByLabel("Attacker heroes marksman").selectOption("Alonso");
    await dialog
      .getByLabel("Attacker heroes marksman skill 4 level")
      .selectOption("0");

    await dialog.locator('input[type="file"]').setInputFiles({
      name: "report.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WnS2GAAAAAASUVORK5CYII=",
        "base64",
      ),
    });

    await dialog.getByRole("button", { name: /Parse and apply/i }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByLabel("Rally mode").first()).toBeChecked();
    await expect(
      page.locator('select[aria-label="marksman hero"]').first(),
    ).toHaveValue("Alonso");
    await expect(
      page.locator('select[aria-label="marksman skill 4"]').first(),
    ).toHaveValue("0");

    expect(errors).toHaveLength(0);
  });

  test("/simulate upload — zero troop counts clear previous values", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    await page.route("**/api/ocr-report", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          attacker: {
            troops: { infantry: 321, lancer: 0, marksman: 0 },
            stats: { infantry: {}, lancer: {}, marksman: {} },
          },
          defender: {
            troops: { infantry: 654, lancer: 987, marksman: 123 },
            stats: { infantry: {}, lancer: {}, marksman: {} },
          },
          warnings: [],
        }),
      });
    });

    const response = await page.goto("/simulate");
    expect(response?.status()).toBe(200);

    await page.getByRole("button", { name: /Upload report/i }).click();
    const dialog = page.getByRole("dialog", { name: "Upload battle report" });
    await expect(dialog).toBeVisible();

    await dialog.locator('input[type="file"]').setInputFiles({
      name: "report.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WnS2GAAAAAASUVORK5CYII=",
        "base64",
      ),
    });

    await dialog.getByRole("button", { name: /Parse and apply/i }).click();
    await expect(dialog).toBeHidden();

    await expect(
      page.locator('input[aria-label="infantry troop count"]').first(),
    ).toHaveValue("321");
    await expect(
      page.locator('input[aria-label="lancer troop count"]').first(),
    ).toHaveValue("0");
    await expect(
      page.locator('input[aria-label="marksman troop count"]').first(),
    ).toHaveValue("0");

    expect(errors).toHaveLength(0);
  });

  test("/heroes/Alonso — renders hero detail", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    const response = await page.goto("/heroes/Alonso");
    expect(response?.status()).toBe(200);

    await expect(page.locator("body")).toContainText("Alonso");

    expect(errors).toHaveLength(0);
  });

  test("/heroes/Alonso — timeline and skill history visible", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    const response = await page.goto("/heroes/Alonso");
    expect(response?.status()).toBe(200);

    // Coverage timeline section heading
    await expect(
      page.locator("h3").filter({ hasText: "Coverage Timeline" }),
    ).toBeVisible();
    // Per-skill table with coverage column header
    await expect(page.locator("body")).toContainText("Covered");
    // No console errors
    expect(errors).toHaveLength(0);
  });

  test("/runs/[id] dirty — shows Dirty State Patch", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    const response = await page.goto(`/runs/${DIRTY_RUN_ID}`);
    expect(response?.status()).toBe(200);

    await expect(page.locator("body")).toContainText("Dirty State Patch");

    expect(errors).toHaveLength(0);
  });

  test("/compare/[a]/[b] — renders headline + delta sections", async ({
    page,
  }) => {
    const { a, b } = twoMostRecentRunIds();

    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    const response = await page.goto(`/compare/${a}/${b}`);
    expect(response?.status()).toBe(200);

    // Headline strip stat-card labels
    await expect(page.locator("body")).toContainText("Avg Error A");
    await expect(page.locator("body")).toContainText("Avg Error B");
    // Section 2 heading
    await expect(page.locator("body")).toContainText("Testcase Delta");

    expect(errors).toHaveLength(0);
  });

  test("/testcases/changelog — renders cross-run table", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    const response = await page.goto("/testcases/changelog");
    expect(response?.status()).toBe(200);

    await expect(page.locator("body")).toContainText("Testcase Changelog");

    // Table must have at least one row from real data.
    await page.waitForSelector('[data-testid="changelog-table"] tbody tr', {
      timeout: 10_000,
    });
    const rows = await page
      .locator('[data-testid="changelog-table"] tbody tr')
      .count();
    expect(rows).toBeGreaterThan(0);

    // Retired filter narrows the set deterministically.
    const totalBefore = rows;
    await page.locator('[data-testid="changelog-filter-retired"]').check();
    await page.waitForFunction(
      (n) =>
        document.querySelectorAll('[data-testid="changelog-table"] tbody tr')
          .length !== n,
      totalBefore,
      { timeout: 5_000 },
    );
    const retiredRows = await page
      .locator('[data-testid="changelog-table"] tbody tr')
      .count();
    expect(retiredRows).toBeLessThanOrEqual(totalBefore);

    // Nav link from layout sidebar is present.
    const navLink = page.locator('nav a[href="/testcases/changelog"]');
    await expect(navLink).toBeVisible();

    expect(errors).toHaveLength(0);
  });

  test("/runs/[id]/compare/prev — redirects to compare page", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    // page.goto follows redirects by default; final response is the compare page.
    const response = await page.goto(`/runs/${DIRTY_RUN_ID}/compare/prev`);
    expect(response?.status()).toBe(200);

    // Confirm we landed on /compare/<prev>/<DIRTY_RUN_ID>
    expect(page.url()).toMatch(new RegExp(`/compare/[^/]+/${DIRTY_RUN_ID}$`));

    // Compare page renders its headline labels
    await expect(page.locator("body")).toContainText("Compare Runs");
    await expect(page.locator("body")).toContainText("Testcase Delta");

    expect(errors).toHaveLength(0);
  });
});
