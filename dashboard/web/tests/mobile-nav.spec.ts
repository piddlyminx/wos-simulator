import { test, expect } from "@playwright/test";

const IPHONE_SE = { width: 375, height: 667 };
const TABLET = { width: 768, height: 1024 };
const DESKTOP = { width: 1280, height: 800 };
const ROOMY_DESKTOP = { width: 1536, height: 900 };
const WIDE_DESKTOP = { width: 2048, height: 1152 };

async function expectNoVisibleElementOverflow(page: import("@playwright/test").Page) {
  const offenders = await page.evaluate(() => {
    const visible = (el: HTMLElement) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    return Array.from(
      document.querySelectorAll<HTMLElement>(
        "input, select, button, [data-testid^='side-section-'], [data-testid^='sim-unit-row-'], [data-testid='stat-bonus-summary-matrix'], [data-testid='stat-bonus-edit-matrix']",
      ),
    )
      .filter(visible)
      .flatMap((el) => {
        const parent = el.closest<HTMLElement>(
          "[data-testid^='side-section-'], .sim-role-panel, .sim-tool-panel, .sim-start-card",
        );
        if (!parent || !visible(parent)) return [];
        const rect = el.getBoundingClientRect();
        const bounds = parent.getBoundingClientRect();
        const out =
          rect.left < bounds.left - 1 ||
          rect.right > bounds.right + 1 ||
          rect.top < bounds.top - 1 ||
          rect.bottom > bounds.bottom + 1;
        return out
          ? [
              {
                testid: el.dataset.testid ?? "",
                tag: el.tagName,
                text: el.textContent?.trim().slice(0, 60) ?? "",
                rect,
                bounds,
              },
            ]
          : [];
      });
  });
  expect(offenders).toEqual([]);
}

test.describe("WOS-202 mobile nav + simulate layout", () => {
  test("primary routes stay within the mobile viewport and keep key controls readable", async ({
    page,
  }) => {
    await page.setViewportSize(IPHONE_SE);

    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    for (const route of [
      "/",
      "/runs",
      "/coverage",
      "/heroes",
      "/testcases",
      "/simulate",
    ]) {
      const response = await page.goto(route);
      expect(response?.status()).toBe(200);

      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return {
          scrollWidth: doc.scrollWidth,
          clientWidth: doc.clientWidth,
        };
      });
      expect(overflow.scrollWidth).toBeLessThanOrEqual(
        overflow.clientWidth + 1,
      );
    }

    await page.goto("/");
    const homeHeaderLayout = await page
      .locator('[data-testid="card-regressions"] header')
      .evaluate((el) => getComputedStyle(el).flexDirection);
    expect(homeHeaderLayout).toBe("column");

    await page.goto("/testcases");
    const filterInput = page.locator(
      '[data-testid="testcases-index-path-filter"]',
    );
    const filterBox = await filterInput.boundingBox();
    expect(filterBox).not.toBeNull();
    expect((filterBox?.width ?? 0) + 0.5).toBeGreaterThanOrEqual(240);

    expect(errors).toHaveLength(0);
  });

  test("mobile viewport hides sidebar and exposes hamburger drawer", async ({
    page,
  }) => {
    await page.setViewportSize(IPHONE_SE);

    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    const response = await page.goto("/simulate");
    expect(response?.status()).toBe(200);

    // Desktop sidebar is still in DOM (hidden md:flex) but must not be visible.
    await expect(
      page.locator("nav a[href='/simulate']").first(),
    ).not.toBeVisible();

    // Hamburger trigger exists and is visible.
    const trigger = page.getByRole("button", { name: /Open menu/i });
    await expect(trigger).toBeVisible();
    const triggerBox = await trigger.boundingBox();
    expect(triggerBox).not.toBeNull();
    expect(triggerBox?.x ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(16);

    // Drawer opens on tap; the simulate link inside becomes visible.
    await trigger.click();
    const drawer = page.getByRole("dialog", { name: /Site navigation/i });
    await expect(drawer).toBeVisible();
    const drawerPanel = drawer.locator("nav").first();
    const drawerPanelBox = await drawerPanel.boundingBox();
    expect(drawerPanelBox).not.toBeNull();
    expect(drawerPanelBox?.x ?? Number.POSITIVE_INFINITY).toBe(0);
    await expect(drawer.getByText("Quality Metrics")).toBeVisible();
    await expect(drawer.getByText("Simulation Running")).toBeVisible();
    await expect(drawer.getByText("Library")).toBeVisible();
    const simulateLink = drawer.locator("a[href='/simulate']");
    await expect(simulateLink).toBeVisible();
    await expect(simulateLink).toHaveText("Battle Sim");

    // Drawer closes with Escape.
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);

    expect(errors).toHaveLength(0);
  });

  test("simulate page fits mobile viewport without horizontal overflow", async ({
    page,
  }) => {
    await page.setViewportSize(IPHONE_SE);

    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    const response = await page.goto("/simulate");
    expect(response?.status()).toBe(200);

    // Title + both side panel titles rendered.
    await expect(page.locator("h2")).toContainText("Simulate Battle");
    await expect(page.getByRole("button", { name: "Upload report" })).toBeVisible();
    await expect(page.getByLabel("Rally mode").first()).toBeVisible();
    await expect(page.getByLabel("Update stats on hero change").first()).toBeVisible();
    await expect(
      page.locator(".sim-switch-input + .sim-switch").first(),
    ).toBeVisible();
    await expect(page.getByTestId("sim-workbench-tabs")).toBeVisible();
    await expect(page.getByTestId("sim-tab-attacker")).toBeVisible();
    await expect(page.getByTestId("sim-tab-defender")).toBeVisible();
    await expect(page.getByTestId("sim-tab-results")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Attacker", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Defender", exact: true }),
    ).not.toBeVisible();
    await expect(page.getByTestId("side-section-attacker-preset")).toBeVisible();
    await expect(page.locator('select[aria-label="infantry skill 1"]')).toHaveCount(0);
    await expect(page.getByTestId("side-section-attacker-joiners")).toHaveCount(0);
    await expect(page.getByTestId("simulate-runbar")).toBeVisible();
    await expect(page.getByTestId("optimize-panel")).toBeVisible();
    const dockBox = await page.getByTestId("sim-action-dock").boundingBox();
    expect(dockBox).not.toBeNull();
    expect(dockBox?.y ?? 0).toBeGreaterThanOrEqual(IPHONE_SE.height - 190);
    const setupBox = await page.getByTestId("sim-panel-setup").boundingBox();
    expect(setupBox).not.toBeNull();
    expect(setupBox?.y ?? 9999).toBeLessThanOrEqual(330);

    await page.getByLabel("Rally mode").first().check();
    await expect(page.getByTestId("side-section-attacker-joiners")).toBeVisible();
    await page
      .locator('select[aria-label="marksman hero"]')
      .first()
      .selectOption("Alonso");
    await page.getByRole("button", { name: /Stat bonuses/i }).click();
    const preview = page.locator(
      '[data-testid="stat-preview-attacker-infantry-lethality"]',
    );
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("[130]");
    await expect(preview).toContainText("+15.0%");

    await expect(page.getByTestId("simulate-runbar")).toBeVisible();
    await expect(page.getByTestId("optimize-options-toggle")).toBeVisible();
    await expect(
      page.locator('[data-testid="optimize-options-panel"]'),
    ).toHaveCount(0);

    const runbar = page.getByTestId("simulate-runbar");
    const simulateBtn = runbar.getByRole("button", { name: /^Simulate$/i });
    const optionsButton = page.getByTestId("optimize-options-toggle");
    const optionsBox = await optionsButton.boundingBox();
    const simulateBox = await simulateBtn.boundingBox();
    expect(optionsBox).not.toBeNull();
    expect(simulateBox).not.toBeNull();
    expect(
      Math.abs((optionsBox?.y ?? 0) - (simulateBox?.y ?? 0)),
    ).toBeLessThanOrEqual(16);

    // Simulate button touch-target is at least 44px tall (Apple HIG minimum).
    expect((simulateBox?.height ?? 0) + 0.5).toBeGreaterThanOrEqual(44);
    await expect(page.getByTestId("optimize-panel")).toContainText("1,000 reps");

    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return {
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
      };
    });
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    await expectNoVisibleElementOverflow(page);

    expect(errors).toHaveLength(0);
  });

  test("simulate upload report modal shows an example-backed drop target", async ({
    page,
  }) => {
    await page.setViewportSize(IPHONE_SE);
    const response = await page.goto("/simulate");
    expect(response?.status()).toBe(200);

    await page.getByRole("button", { name: "Upload report" }).click();
    const modal = page.getByRole("dialog", { name: /Upload battle report/i });
    await expect(modal).toBeVisible();
    await expect(modal.getByText("Drop report here")).toBeVisible();
    await expect(modal.getByText(/tap to choose/i)).toBeVisible();
    await expect(modal.getByText(/paste/i)).toBeVisible();
    await expect(modal.getByAltText(/Example Stat Bonuses report/i)).toBeVisible();
    await expect(modal.getByText("Buffs and debuffs").first()).toBeVisible();
    await expect(modal.getByText("Active buffs / debuffs")).toHaveCount(0);

    const cityToggle = modal.getByTestId("upload-city-modifier-details-attacker");
    const petsToggle = modal.getByTestId("upload-pet-modifier-details-attacker");
    await expect(cityToggle).toBeVisible();
    await expect(petsToggle).toBeVisible();

    const modifierStyles = await modal.evaluate((dialog) => {
      const read = (selector: string) => {
        const el = dialog.querySelector<HTMLElement>(selector);
        if (!el) return null;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return {
          textTransform: style.textTransform,
          fontSize: Number.parseFloat(style.fontSize),
          width: rect.width,
          dialogWidth: dialog.getBoundingClientRect().width,
          className: el.className,
        };
      };
      return {
        city: read('[data-testid="upload-city-modifier-details-attacker"]'),
        pets: read('[data-testid="upload-pet-modifier-details-attacker"]'),
      };
    });
    expect(modifierStyles.city).not.toBeNull();
    expect(modifierStyles.pets).not.toBeNull();
    expect(modifierStyles.city?.textTransform).not.toBe("uppercase");
    expect(modifierStyles.pets?.textTransform).not.toBe("uppercase");
    expect(modifierStyles.city?.fontSize ?? 99).toBeLessThanOrEqual(11);
    expect(modifierStyles.pets?.fontSize ?? 99).toBeLessThanOrEqual(11);
    expect(modifierStyles.city?.className ?? "").not.toContain("tracking-wider");
    expect(modifierStyles.pets?.className ?? "").not.toContain("tracking-wider");
    expect(modifierStyles.city?.width ?? 9999).toBeLessThanOrEqual(
      (modifierStyles.city?.dialogWidth ?? 0) - 24,
    );
  });

  test("/runs keeps the filtered signed-bias testcase drift chart", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    const response = await page.goto("/runs");
    expect(response?.status()).toBe(200);
    await expect(page.getByTestId("testcase-drift-chart")).toBeVisible();
    await expect(page.getByTestId("hide-smoke-runs-toggle")).toBeVisible();
  });

  test("desktop viewport shows sidebar nav and no mobile trigger", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);

    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    const response = await page.goto("/simulate");
    expect(response?.status()).toBe(200);

    // Sidebar link visible without any interaction.
    await expect(page.locator("nav a[href='/simulate']").first()).toBeVisible();
    await expect(page.locator("nav a[href='/simulate']").first()).toHaveText(
      "Battle Sim",
    );
    await expect(page.getByText("Quality Metrics")).toBeVisible();
    await expect(page.getByText("Simulation Running")).toBeVisible();
    await expect(page.getByText("Library")).toBeVisible();

    // Mobile hamburger is rendered (md:hidden) but must not be visible on desktop.
    await expect(
      page.getByRole("button", { name: /Open menu/i }),
    ).not.toBeVisible();

    await expect(page.getByTestId("simulate-start-card")).toBeVisible();
    await expect(page.getByTestId("sim-workbench-tabs")).toBeVisible();
    await expect(page.getByTestId("sim-tab-attacker")).toBeVisible();
    await expect(page.getByTestId("sim-tab-defender")).toBeVisible();
    await expect(page.getByTestId("sim-tab-results")).toBeVisible();
    await expect(page.getByTestId("simulate-runbar")).toBeVisible();
    await expect(page.getByTestId("optimize-panel")).toBeVisible();

    await expect(
      page.getByRole("button", { name: /Troops, tiers, heroes/i }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Stat bonuses/i }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Buffs and debuffs/i }).first(),
    ).toBeVisible();
    await expect(page.getByText("Extra Buffs / Debuffs")).toHaveCount(0);
    const infantryRow = page.getByTestId("sim-unit-row-attacker-infantry");
    await expect(infantryRow).toBeVisible();
    const infantryRowBox = await infantryRow.boundingBox();
    expect(infantryRowBox).not.toBeNull();
    expect(infantryRowBox?.height ?? 999).toBeLessThan(110);

    await page.getByLabel("Rally mode").first().check();
    await page
      .locator('select[aria-label="marksman hero"]')
      .first()
      .selectOption("Alonso");
    await page.getByRole("button", { name: /Stat bonuses/i }).first().click();
    const preview = page.locator(
      '[data-testid="stat-preview-attacker-infantry-lethality"]',
    );
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("[130]");
    await expect(preview).toContainText("+15.0%");

    // Stat cells keep the skill-4 preview stacked under the input, and remain
    // wide enough to show 5-digit values.
    const infantryLethalityField = page
      .locator("label")
      .filter({ has: page.getByLabel("Infantry Lethality") })
      .first();
    const statLayout = await infantryLethalityField.evaluate((el) => {
      const header = el.firstElementChild as HTMLElement | null;
      const input = el.querySelector("input") as HTMLInputElement | null;
      const preview = el.querySelector(
        '[data-testid="stat-preview-attacker-infantry-lethality"]',
      ) as HTMLElement | null;
      const textFitter = document.createElement("canvas");
      const context = textFitter.getContext("2d");
      const style = input ? getComputedStyle(input) : null;
      if (context && style) {
        context.font = `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${style.fontSize} / ${style.lineHeight} ${style.fontFamily}`;
      }
      const padding =
        style && input
          ? parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
          : 0;
      return {
        headerText: header?.textContent?.trim() ?? null,
        inputType: input?.type ?? null,
        inputWidth: input?.getBoundingClientRect().width ?? 0,
        decimalStatTextWidth: context?.measureText("1703.4").width ?? 0,
        padding,
        previewTop:
          preview && input
            ? preview.getBoundingClientRect().top -
              input.getBoundingClientRect().bottom
            : null,
      };
    });
    expect(statLayout.headerText).toBe("Leth");
    expect(statLayout.inputType).toBe("text");
    expect(statLayout.inputWidth).toBeGreaterThan(
      statLayout.decimalStatTextWidth + statLayout.padding,
    );
    expect(statLayout.previewTop).not.toBeNull();
    expect((statLayout.previewTop ?? -1) + 0.5).toBeGreaterThanOrEqual(0);

    expect(errors).toHaveLength(0);
  });

  test("simulate roomy desktop shows setup and results without workspace tabs", async ({
    page,
  }) => {
    await page.setViewportSize(ROOMY_DESKTOP);
    const response = await page.goto("/simulate");
    expect(response?.status()).toBe(200);

    await expect(page.getByTestId("sim-workbench-tabs")).toHaveCount(0);
    await expect(page.getByTestId("sim-panel-setup")).toBeVisible();
    await expect(page.getByTestId("sim-panel-results")).toHaveCount(1);
    await expect(page.getByTestId("sim-tab-attacker")).toHaveCount(0);
    await expect(page.getByTestId("sim-tab-defender")).toHaveCount(0);

    const attacker = page.getByTestId("side-section-attacker-preset");
    const defender = page.getByTestId("side-section-defender-preset");
    await expect(attacker).toBeVisible();
    await expect(defender).toBeVisible();
    const attackerBox = await attacker.boundingBox();
    const defenderBox = await defender.boundingBox();
    expect(attackerBox?.width ?? 0).toBeGreaterThanOrEqual(520);
    expect(defenderBox?.width ?? 0).toBeGreaterThanOrEqual(520);
    expect(Math.abs((attackerBox?.y ?? 0) - (defenderBox?.y ?? 0))).toBeLessThan(20);

    await expect(page.getByTestId("simulate-runbar")).toBeVisible();
    await expect(page.getByTestId("optimize-panel")).toBeVisible();
    const actionsBox = await page.getByTestId("simulate-runbar").boundingBox();
    const dockBox = await page.getByTestId("sim-action-dock").boundingBox();
    expect(actionsBox).not.toBeNull();
    expect(dockBox).not.toBeNull();
    expect(dockBox?.y ?? 0).toBeGreaterThanOrEqual(ROOMY_DESKTOP.height - 150);
    await expectNoVisibleElementOverflow(page);
  });

  test("simulate layout switches tabs at widths where role panels would be too narrow", async ({
    page,
  }) => {
    for (const width of [375, 768, 1199]) {
      await page.setViewportSize({ width, height: 900 });
      const response = await page.goto("/simulate");
      expect(response?.status()).toBe(200);

      await expect(page.getByTestId("sim-tab-attacker")).toBeVisible();
      await expect(page.getByTestId("sim-tab-defender")).toBeVisible();
      await expect(page.getByTestId("sim-tab-results")).toBeVisible();
      await expect(page.getByTestId("sim-tab-setup")).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: "Attacker", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Defender", exact: true }),
      ).not.toBeVisible();
      await expect(page.getByTestId("simulate-runbar")).toBeVisible();
      await expect(page.getByTestId("optimize-panel")).toBeVisible();
      await expectNoVisibleElementOverflow(page);
    }

    for (const width of [1200, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const response = await page.goto("/simulate");
      expect(response?.status()).toBe(200);

      await expect(page.getByTestId("sim-workbench-tabs")).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: "Attacker", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Defender", exact: true }),
      ).toBeVisible();
      await expect(page.getByTestId("simulate-runbar")).toBeVisible();
      await expect(page.getByTestId("optimize-panel")).toBeVisible();
      await expectNoVisibleElementOverflow(page);
    }
  });

  test("simulate desktop starts with compact command controls and one font system", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 950 });
    const response = await page.goto("/simulate");
    expect(response?.status()).toBe(200);

    const startCard = page.getByTestId("simulate-start-card");

    const startBox = await startCard.boundingBox();
    expect(startBox).not.toBeNull();
    await expect(page.locator(".sim-page-title")).not.toBeVisible();
    await expect(
      page.getByText(/Start from a report or role presets/i),
    ).not.toBeVisible();
    expect(startBox?.y ?? 9999).toBeLessThanOrEqual(125);
    expect(startBox?.height ?? 9999).toBeLessThanOrEqual(76);

    const uploadBox = await page
      .getByRole("button", { name: /^Upload report/i })
      .boundingBox();
    const rallyBox = await page.getByLabel("Rally mode").first().boundingBox();
    const syncBox = await page
      .getByLabel("Update stats on hero change")
      .first()
      .boundingBox();
    expect(uploadBox).not.toBeNull();
    expect(rallyBox).not.toBeNull();
    expect(syncBox).not.toBeNull();
    expect(uploadBox?.height ?? 9999).toBeLessThanOrEqual(42);
    expect(rallyBox?.height ?? 9999).toBeLessThanOrEqual(38);
    expect(syncBox?.height ?? 9999).toBeLessThanOrEqual(38);

    const fonts = await page.evaluate(() => {
      const workspace = document.querySelector(".simulate-workspace");
      const titleEl = document.querySelector(".sim-page-title");
      return {
        body: getComputedStyle(document.body).fontFamily,
        workspace: workspace ? getComputedStyle(workspace).fontFamily : null,
        title: titleEl ? getComputedStyle(titleEl).fontFamily : null,
      };
    });
    expect(fonts.workspace).toBe(fonts.body);
    expect(fonts.title).toBe(fonts.body);
  });

  test("simulate desktop stacks results below setup with a bottom action dock", async ({
    page,
  }) => {
    const desktopStack = { width: 1600, height: 950 };
    await page.setViewportSize(desktopStack);
    const response = await page.goto("/simulate");
    expect(response?.status()).toBe(200);

    const runbarBox = await page.getByTestId("simulate-runbar").boundingBox();
    const optimizeBox = await page.getByTestId("optimize-panel").boundingBox();
    const setupBox = await page.getByTestId("sim-panel-setup").boundingBox();
    const dockBox = await page.getByTestId("sim-action-dock").boundingBox();
    expect(runbarBox).not.toBeNull();
    expect(optimizeBox).not.toBeNull();
    expect(setupBox).not.toBeNull();
    expect(dockBox).not.toBeNull();
    await expect(page.getByTestId("sim-workbench-tabs")).toHaveCount(0);
    const startBox = await page.getByTestId("simulate-start-card").boundingBox();
    expect(startBox).not.toBeNull();
    expect(Math.abs((dockBox?.x ?? 0) - (startBox?.x ?? 9999))).toBeLessThanOrEqual(2);
    expect(
      Math.abs(
        ((dockBox?.x ?? 0) + (dockBox?.width ?? 0)) -
          ((startBox?.x ?? 0) + (startBox?.width ?? 0)),
      ),
    ).toBeLessThanOrEqual(2);
    expect(dockBox?.y ?? 0).toBeGreaterThan(
      (setupBox?.y ?? 0) + (setupBox?.height ?? 0),
    );
    expect(dockBox?.y ?? 0).toBeGreaterThanOrEqual(desktopStack.height - 150);
    expect((dockBox?.y ?? 0) + (dockBox?.height ?? 0)).toBeLessThanOrEqual(
      desktopStack.height,
    );
    expect(runbarBox?.y ?? 0).toBeGreaterThanOrEqual(optimizeBox?.y ?? 9999);
    expect((runbarBox?.y ?? 0) + (runbarBox?.height ?? 0)).toBeLessThanOrEqual(
      (optimizeBox?.y ?? 0) + (optimizeBox?.height ?? 0) + 1,
    );

    const optionsToggle = page.getByTestId("optimize-options-toggle");
    await optionsToggle.click();
    const replicateBox = await page.getByLabel("Replicates").boundingBox();
    expect(replicateBox).not.toBeNull();
    expect(replicateBox?.width ?? 9999).toBeLessThanOrEqual(190);
    const simulateColor = await page
      .getByTestId("simulate-runbar")
      .getByRole("button", { name: /^Simulate$/i })
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    await optionsToggle.click();
    await page.getByRole("tab", { name: "Optimise ratio" }).click();
    const optimizeColor = await page
      .getByTestId("simulate-runbar")
      .getByRole("button", { name: /^Optimise ratio$/i })
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(simulateColor).toBe(optimizeColor);
    await expect(page.getByRole("button", { name: "Grid" })).toHaveCount(0);
    await optionsToggle.click();
    await expect(page.getByRole("button", { name: "Grid" })).toBeVisible();
  });

  test("simulate action dock keeps run controls compact and exposes options help", async ({
    page,
  }) => {
    for (const width of [1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 820 });
      const response = await page.goto("/simulate");
      expect(response?.status()).toBe(200);

      const dockBox = await page.getByTestId("sim-action-dock").boundingBox();
      const tablistBox = await page
        .getByRole("tablist", { name: "Run mode" })
        .boundingBox();
      const runButtonBox = await page
        .getByTestId("simulate-runbar")
        .getByRole("button", { name: /^Simulate$/i })
        .boundingBox();
      const optionsButtonBox = await page
        .getByTestId("optimize-options-toggle")
        .boundingBox();

      expect(dockBox).not.toBeNull();
      expect(tablistBox).not.toBeNull();
      expect(runButtonBox).not.toBeNull();
      expect(optionsButtonBox).not.toBeNull();
      expect(tablistBox?.width ?? 9999).toBeLessThanOrEqual(dockBox?.width ?? 0);
      expect((optionsButtonBox?.x ?? 0) + (optionsButtonBox?.width ?? 0)).toBeLessThanOrEqual(
        (dockBox?.x ?? 0) + (dockBox?.width ?? 0) + 1,
      );
      expect((runButtonBox?.height ?? 0) + 0.5).toBeGreaterThanOrEqual(34);
      await expectNoVisibleElementOverflow(page);
    }

    await page.setViewportSize({ width: 768, height: 506 });
    await page.goto("/simulate");
    await page.getByRole("tab", { name: "Optimise ratio" }).click();
    await page.getByTestId("optimize-options-toggle").click();
    const optionsPanel = page.getByTestId("optimize-options-panel");
    await expect(optionsPanel).toBeVisible();
    await expect(optionsPanel).toContainText("Infantry search band");
    await expect(optionsPanel).toContainText("Adaptive search starts");
  });

  test("simulate desktop optimise command uses run mode tabs and chevron options", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 820 });
    const response = await page.goto("/simulate");
    expect(response?.status()).toBe(200);

    const optimizeTab = page.getByRole("tab", { name: "Optimise ratio" });
    const optimizeButton = page
      .getByTestId("simulate-runbar")
      .getByRole("button", { name: /^Optimise ratio$/i });
    const optionsToggle = page.getByTestId("optimize-options-toggle");
    await optimizeTab.click();
    const commandBox = await page.getByTestId("optimize-panel").boundingBox();
    const tabBox = await optimizeTab.boundingBox();
    const actionBox = await optimizeButton.boundingBox();
    const toggleBox = await optionsToggle.boundingBox();

    await expect(optionsToggle).toHaveAccessibleName(/Show run options/i);
    await expect(optionsToggle).not.toContainText(/Show options|Hide options/i);
    expect(commandBox).not.toBeNull();
    expect(tabBox).not.toBeNull();
    expect(actionBox).not.toBeNull();
    expect(toggleBox).not.toBeNull();
    const tabCenter = (tabBox?.y ?? 0) + (tabBox?.height ?? 0) / 2;
    const actionCenter = (actionBox?.y ?? 0) + (actionBox?.height ?? 0) / 2;
    const toggleCenter = (toggleBox?.y ?? 0) + (toggleBox?.height ?? 0) / 2;
    expect(tabCenter).toBeLessThan(actionCenter);
    expect(Math.abs(actionCenter - toggleCenter)).toBeLessThanOrEqual(2);
    expect((toggleBox?.x ?? 0) + (toggleBox?.width ?? 0)).toBeLessThanOrEqual(
      (commandBox?.x ?? 0) + (commandBox?.width ?? 0) + 1,
    );
    expect(toggleBox?.width ?? 9999).toBeLessThanOrEqual(120);

    await optionsToggle.click();
    await expect(optionsToggle).toHaveAccessibleName(/Hide run options/i);
    await expect(page.getByTestId("optimize-options-panel")).toBeVisible();
    const optionsPanel = page.getByTestId("optimize-options-panel");
    const sideToggle = optionsPanel.locator(".sim-mode-secondary-button");
    await expect(sideToggle).toContainText("Attacker");
    await sideToggle.click();
    await expect(optionsPanel.locator(".sim-mode-secondary-button")).toContainText("Defender");
  });

  test("simulate mobile action dock aligns controls into rows", async ({
    page,
  }) => {
    await page.setViewportSize(IPHONE_SE);
    const response = await page.goto("/simulate");
    expect(response?.status()).toBe(200);

    const dockBox = await page.getByTestId("sim-action-dock").boundingBox();
    const modeTabsBox = await page
      .getByRole("tablist", { name: "Run mode" })
      .boundingBox();
    const simulateBox = await page
      .getByTestId("simulate-runbar")
      .getByRole("button", { name: /^Simulate$/i })
      .boundingBox();
    const optionsBox = await page.getByTestId("optimize-options-toggle").boundingBox();
    const statusBox = await page.locator(".sim-mode-status").boundingBox();

    for (const box of [
      dockBox,
      modeTabsBox,
      simulateBox,
      optionsBox,
      statusBox,
    ]) {
      expect(box).not.toBeNull();
    }

    expect(modeTabsBox?.y ?? 9999).toBeLessThan(optionsBox?.y ?? 0);
    expect(Math.abs((simulateBox?.y ?? 0) - (optionsBox?.y ?? 9999))).toBeLessThanOrEqual(2);
    expect(statusBox?.y ?? 0).toBeGreaterThan(simulateBox?.y ?? 9999);
    expect((optionsBox?.x ?? 0) + (optionsBox?.width ?? 0)).toBeLessThanOrEqual(
      (dockBox?.x ?? 0) + (dockBox?.width ?? 0) - 10,
    );
    await expectNoVisibleElementOverflow(page);
  });

  test("simulate tablet start actions stay contained in the content column", async ({
    page,
  }) => {
    await page.setViewportSize(TABLET);
    const response = await page.goto("/simulate");
    expect(response?.status()).toBe(200);

    const startCard = page.getByTestId("simulate-start-card");
    const cardBox = await startCard.boundingBox();
    expect(cardBox).not.toBeNull();

    for (const control of [
      page.getByRole("button", { name: "Upload report" }),
      page.getByLabel("Rally mode").first(),
      page.getByLabel("Update stats on hero change").first(),
      page.getByTestId("recent-runs-toggle"),
    ]) {
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      expect(box?.x ?? 0).toBeGreaterThanOrEqual((cardBox?.x ?? 0) - 1);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
        (cardBox?.x ?? 0) + (cardBox?.width ?? 0) + 1,
      );
    }
  });

  test("simulate section controls expose clear accordion actions and unclipped option text", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 950 });
    const response = await page.goto("/simulate");
    expect(response?.status()).toBe(200);

    const attackerTroops = page.getByTestId("side-section-attacker-troops");
    const attackerBuffs = page.getByTestId("side-section-attacker-buffs");
    const troopsButton = attackerTroops.getByRole("button", {
      name: /Troops, tiers, heroes/i,
    });
    await expect(troopsButton).toContainText("Close");

    const buffsButton = attackerBuffs.getByRole("button", {
      name: /Buffs and debuffs/i,
    });
    await expect(async () => {
      if ((await buffsButton.getAttribute("aria-expanded")) !== "true") {
        await buffsButton.click();
      }
      await expect(buffsButton).toHaveAttribute("aria-expanded", "true");
    }).toPass();
    await expect(buffsButton).toContainText("Close");
    await expect(troopsButton).toContainText("Open");

    for (const testId of [
      "city-modifier-attacker-0",
      "city-modifier-attacker-10",
      "city-modifier-attacker-20",
      "pet-modifier-attacker-toggle",
    ]) {
      const clipped = await page.getByTestId(testId).evaluate((el) => {
        return el.scrollWidth > el.clientWidth + 1;
      });
      expect(clipped).toBe(false);
    }
  });

  test("simulate collapsed sections keep readable setup summaries", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 950 });
    const response = await page.goto("/simulate");
    expect(response?.status()).toBe(200);

    const statsSection = page.getByTestId("side-section-attacker-stats");
    const statsButton = statsSection.getByRole("button", {
      name: /Stat bonuses/i,
    });
    await expect(async () => {
      if ((await statsButton.getAttribute("aria-expanded")) !== "true") {
        await statsButton.click();
      }
      await expect(statsButton).toHaveAttribute("aria-expanded", "true");
    }).toPass();
    await statsSection.getByLabel("Infantry Attack").fill("1703.4");
    await statsButton.click();

    await expect(statsSection.getByTestId("stat-bonus-summary-matrix")).toBeVisible();
    await expect(
      statsSection.getByTestId("stat-bonus-summary-matrix").locator(".sim-summary-name").first(),
    ).toHaveText("I");
    await expect(statsSection).toContainText("Atk");
    await expect(statsSection).toContainText("1703.4");
    await expect(statsSection).toContainText("Def");
    await expect(statsSection).toContainText("100");

    const troopsSection = page.getByTestId("side-section-attacker-troops");
    await expect(troopsSection).toContainText("Infantry");
    await expect(troopsSection).toContainText("1,000");
    await expect(troopsSection).toContainText("t11_fc10");
    await expect(troopsSection).toContainText("None");
    await expect(troopsSection).not.toContainText("0/0/0/0");

    const buffsSection = page.getByTestId("side-section-attacker-buffs");
    await expect(buffsSection).toContainText("City 0 active");
    await expect(buffsSection).toContainText("Pets 0 active");
    await expect(buffsSection.locator(".sim-preview-pill")).toHaveCount(0);

    const summaryStyling = await page
      .locator(".sim-summary-row:not(.sim-summary-head), .sim-summary-line")
      .evaluateAll((rows) =>
        rows.map((row) => {
          const style = getComputedStyle(row as HTMLElement);
          return {
            borderTopWidth: style.borderTopWidth,
            backgroundColor: style.backgroundColor,
          };
        }),
      );
    expect(summaryStyling.length).toBeGreaterThan(0);
    expect(summaryStyling).toEqual(
      summaryStyling.map(() => ({
        borderTopWidth: "0px",
        backgroundColor: "rgba(0, 0, 0, 0)",
      })),
    );
  });

  test("simulate toast does not cover top action controls", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    const response = await page.goto("/simulate");
    expect(response?.status()).toBe(200);

    const hero = page.getByLabel("infantry hero").first();
    await hero.selectOption({ index: 1 });
    const toast = page.getByRole("status");
    await expect(toast).toBeVisible();

    const boxes = await page.evaluate(() => {
      const rect = (selector: string) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          left: r.left,
          top: r.top,
          right: r.right,
          bottom: r.bottom,
        };
      };
      const overlaps = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>) =>
        Boolean(
          a &&
            b &&
            a.left < b.right &&
            a.right > b.left &&
            a.top < b.bottom &&
            a.bottom > b.top,
        );
      return {
        toastVsStart: overlaps(rect('[role="status"]'), rect('[data-testid="simulate-start-card"]')),
        toastVsRun: overlaps(rect('[role="status"]'), rect('[data-testid="simulate-runbar"]')),
        toastVsOptimize: overlaps(rect('[role="status"]'), rect('[data-testid="optimize-panel"]')),
      };
    });
    expect(boxes.toastVsStart).toBe(false);
    expect(boxes.toastVsRun).toBe(false);
    expect(boxes.toastVsOptimize).toBe(false);
  });

  test("simulate stat summary shows effective buffed and debuffed values", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    const response = await page.goto("/simulate");
    expect(response?.status()).toBe(200);

    await page.getByRole("button", { name: /Buffs and debuffs/i }).first().click();
    await page.getByTestId("city-modifier-attacker-20").click();
    await page.getByTestId("pet-modifier-attacker-toggle").click();
    await page.getByRole("button", { name: /Buffs and debuffs/i }).first().click();

    const statsSection = page.getByTestId("side-section-attacker-stats");
    const matrix = statsSection.getByTestId("stat-bonus-summary-matrix");
    await expect(matrix).toBeVisible();
    await expect(matrix).toContainText("160");
    await expect(matrix).toContainText("(+60");
    await expect(matrix.locator(".sim-value-up").first()).toBeVisible();
    await expect(page.getByTestId("side-section-attacker-buffs")).toContainText(
      /City [1-9]/,
    );
  });

  test("simulate mobile stat summary uses compact row labels without value overlap", async ({
    page,
  }) => {
    await page.setViewportSize(IPHONE_SE);
    const response = await page.goto("/simulate");
    expect(response?.status()).toBe(200);

    await page.getByRole("button", { name: /Buffs and debuffs/i }).first().click();
    await page.getByTestId("city-modifier-attacker-20").click();
    await page.getByTestId("pet-modifier-attacker-toggle").click();
    await page.getByRole("button", { name: /Buffs and debuffs/i }).first().click();

    const matrix = page
      .getByTestId("side-section-attacker-stats")
      .getByTestId("stat-bonus-summary-matrix");
    await expect(matrix).toBeVisible();
    await expect(matrix.locator(".sim-summary-name").nth(0)).toHaveText("I");
    await expect(matrix.locator(".sim-summary-name").nth(1)).toHaveText("L");
    await expect(matrix.locator(".sim-summary-name").nth(2)).toHaveText("M");

    const overlaps = await matrix.evaluate((el) => {
      const visibleRows = Array.from(
        el.querySelectorAll<HTMLElement>(".sim-stat-summary-row"),
      ).filter((row) => row.getBoundingClientRect().width > 0);
      return visibleRows.flatMap((row) => {
        const cells = Array.from(row.children).map((cell) => {
          const rect = cell.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            text: cell.textContent?.trim() ?? "",
          };
        });
        const rowOverlaps: { left: string; right: string }[] = [];
        for (let i = 0; i < cells.length - 1; i += 1) {
          if (cells[i].right > cells[i + 1].left - 1) {
            rowOverlaps.push({
              left: cells[i].text,
              right: cells[i + 1].text,
            });
          }
        }
        return rowOverlaps;
      });
    });
    expect(overlaps).toEqual([]);
  });

  test("troop count inputs select on focus and keep rapid zero-containing typing", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    const response = await page.goto("/simulate");
    expect(response?.status()).toBe(200);

    const troopCount = page
      .locator('input[aria-label="infantry troop count"]')
      .first();
    await expect(troopCount).toHaveValue("1000");

    await troopCount.click();
    await page.keyboard.type("10");

    await expect(troopCount).toHaveValue("10");

    await page.keyboard.press("Tab");
    const lancerCount = page
      .locator('input[aria-label="lancer troop count"]')
      .first();
    await expect(lancerCount).toBeFocused();
    await page.keyboard.type("20");
    await expect(lancerCount).toHaveValue("20");
  });

  test("simulate role setup stays contained on wide desktop", async ({
    page,
  }) => {
    await page.setViewportSize(WIDE_DESKTOP);

    const response = await page.goto("/simulate");
    expect(response?.status()).toBe(200);

    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return {
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
      };
    });
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

    for (const side of ["attacker", "defender"] as const) {
      const section = page.getByTestId(`side-section-${side}-troops`);
      const sectionBox = await section.boundingBox();
      expect(sectionBox).not.toBeNull();

      for (const cat of ["infantry", "lancer", "marksman"] as const) {
        const row = page.getByTestId(`sim-unit-row-${side}-${cat}`);
        await expect(row).toBeVisible();
        const rowBox = await row.boundingBox();
        expect(rowBox).not.toBeNull();
        expect((rowBox?.x ?? 0) + (rowBox?.width ?? 0)).toBeLessThanOrEqual(
          (sectionBox?.x ?? 0) + (sectionBox?.width ?? 0) + 1,
        );
        expect(rowBox?.x ?? 0).toBeGreaterThanOrEqual((sectionBox?.x ?? 0) - 1);

        const descendantBounds = await row.evaluate((el) => {
          const rects = Array.from(
            el.querySelectorAll<HTMLElement>("input, select, label, span"),
          ).map((child) => child.getBoundingClientRect());
          return {
            left: Math.min(...rects.map((rect) => rect.left)),
            right: Math.max(...rects.map((rect) => rect.right)),
          };
        });
        expect(descendantBounds.left).toBeGreaterThanOrEqual(
          (sectionBox?.x ?? 0) - 1,
        );
        expect(descendantBounds.right).toBeLessThanOrEqual(
          (sectionBox?.x ?? 0) + (sectionBox?.width ?? 0) + 1,
        );
      }
    }
    await expectNoVisibleElementOverflow(page);
  });

  test("bear sim uses setup/results tabs and contains army rows", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    const response = await page.goto("/bear");
    expect(response?.status()).toBe(200);

    await expect(page.getByTestId("bear-start-card")).toBeVisible();
    await expect(page.getByTestId("bear-tab-setup")).toBeVisible();
    await expect(page.getByTestId("bear-tab-results")).toBeVisible();
    await expect(page.getByTestId("bear-panel-setup")).toBeVisible();
    await expect(page.getByTestId("bear-panel-results")).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Upload report" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Player army" })).toBeVisible();
    await expect(page.getByTestId("bear-runbar")).toBeVisible();
    const bearRunBox = await page.getByTestId("bear-runbar").boundingBox();
    const bearTabsBox = await page.getByTestId("bear-tab-setup").boundingBox();
    const bearDockBox = await page.getByTestId("bear-top-actions").boundingBox();
    expect(bearRunBox).not.toBeNull();
    expect(bearTabsBox).not.toBeNull();
    expect(bearDockBox).not.toBeNull();
    expect(bearRunBox?.y ?? 0).toBeGreaterThan(bearTabsBox?.y ?? 9999);
    expect(bearDockBox?.y ?? 0).toBeGreaterThanOrEqual(DESKTOP.height - 150);

    const panelBox = await page.locator(".bear-army-panel").boundingBox();
    const rowBox = await page
      .getByTestId("sim-unit-row-attacker-infantry")
      .boundingBox();
    expect(panelBox).not.toBeNull();
    expect(rowBox).not.toBeNull();
    expect(panelBox?.width ?? 9999).toBeLessThanOrEqual(880);
    expect((rowBox?.x ?? 0) + (rowBox?.width ?? 0)).toBeLessThanOrEqual(
      (panelBox?.x ?? 0) + (panelBox?.width ?? 0) + 1,
    );

    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
    });
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

    await page.getByTestId("bear-tab-results").click();
    await expect(page.getByTestId("bear-panel-setup")).not.toBeVisible();
    await expect(page.getByText("Results will appear here after running a bear sim or optimisation.")).not.toBeVisible();
    await expect(page.getByTestId("bear-runbar")).toBeVisible();
    await expect(page.getByTestId("bear-optimize-panel")).toBeVisible();
    await expectNoVisibleElementOverflow(page);
  });
});
