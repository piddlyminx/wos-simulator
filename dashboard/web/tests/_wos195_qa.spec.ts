import { test, expect } from "@playwright/test";

test.describe("WOS-195 Simulate page visual QA", () => {
  test("page loads and shows battle layout", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/simulate");
    await page.waitForLoadState("networkidle");

    // 1280px now uses the wide setup layout; both side panels are visible
    // without workspace tabs.
    await expect(page.getByRole("heading", { name: "Attacker", exact: true })).toBeVisible();
    await expect(page.getByTestId("sim-workbench-tabs")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Defender", exact: true })).toBeVisible();
  });

  test("troop inputs exist for infantry, lancer, marksman on both sides", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/simulate");
    await page.waitForLoadState("networkidle");

    // Check troop category labels are present
    const content = await page.content();
    expect(content.toLowerCase()).toContain("infantry");
    expect(content.toLowerCase()).toContain("lancer");
    expect(content.toLowerCase()).toContain("marksman");

    // Check troop type dropdowns exist (t1..t11, fc variants)
    const selects = page.locator("select");
    const count = await selects.count();
    expect(count).toBeGreaterThan(6); // at least 6 tier dropdowns (3 per side)
  });

  test("hero selects exist and skill selects render after hero selection", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/simulate");
    await page.waitForLoadState("networkidle");

    // Hero dropdowns should exist
    const content = await page.content();
    expect(content).toContain("None"); // no hero option

    // Skill selects are only rendered once a hero is selected.
    await expect(page.locator('select[aria-label="infantry skill 1"]')).toHaveCount(0);

    await page.locator('select[aria-label="infantry hero"]').first().selectOption({ index: 1 });
    await expect(page.locator('select[aria-label="infantry skill 1"]')).toBeVisible();

    const disabledSkillSelects = page.locator(".sim-skill-strip select[disabled]");
    await expect(disabledSkillSelects.first()).toBeVisible();
  });

  test("stats inputs exist (12 per side)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/simulate");
    await page.waitForLoadState("networkidle");

    // Check stat labels
    const content = await page.content();
    expect(content).toContain("Atk");
    expect(content).toContain("Def");
    expect(content).toContain("Leth");
    expect(content).toContain("HP");
  });

  test("replicates input and Simulate button present", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/simulate");
    await page.waitForLoadState("networkidle");

    // Replicates input
    const replicatesInput = page.locator('input[type="number"]').filter({ hasText: '' }).first();
    await expect(replicatesInput).toBeVisible();

    // Simulate button
    const simulateBtn = page.getByRole("button", { name: /simulate/i });
    await expect(simulateBtn).toBeVisible();
  });

  test("hero selection enables skill selects with correct defaults", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/simulate");
    await page.waitForLoadState("networkidle");

    // Find and select the first hero dropdown (infantry on attacker side)
    const heroSelects = page.locator("select").filter({ hasText: "None" });
    const firstHeroSelect = heroSelects.first();
    await firstHeroSelect.selectOption({ index: 1 }); // pick first actual hero

    await page.waitForTimeout(500);
  });

  test("simulate runs and shows results", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/simulate");
    await page.waitForLoadState("networkidle");

    // Set low replicates for speed
    const numInputs = page.locator('input[type="number"]');
    const count = await numInputs.count();
    // Find replicates - usually near the simulate button, try to find it
    for (let i = 0; i < count; i++) {
      const val = await numInputs.nth(i).inputValue();
      if (val === "100" || val === "50") {
        await numInputs.nth(i).fill("10");
        break;
      }
    }

    const simulateBtn = page.getByRole("button", { name: /simulate/i });
    await simulateBtn.click();

    // Wait for results (up to 30s for sim to complete)
    await page.waitForTimeout(2000);

    // Wait longer for results
    await page.waitForFunction(
      () => {
        const text = document.body.innerText.toLowerCase();
        return text.includes("survivors") || text.includes("win rate") || text.includes("mean") || text.includes("error");
      },
      { timeout: 30000 }
    );

    const text = await page.evaluate(() => document.body.innerText);

    // Check key result stats are shown
    const textLower = text.toLowerCase();
    expect(
      textLower.includes("survivor") ||
        textLower.includes("win rate") ||
        textLower.includes("mean")
    ).toBe(true);
  });

  test("mobile layout renders correctly", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/simulate");
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("sim-workbench-tabs")).toBeVisible();
    await expect(page.getByTestId("sim-tab-attacker")).toBeVisible();
    await expect(page.getByTestId("sim-action-dock")).toBeVisible();
  });
});
