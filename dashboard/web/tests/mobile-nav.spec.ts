import { test, expect } from "@playwright/test";

const IPHONE_SE = { width: 375, height: 667 };
const DESKTOP = { width: 1280, height: 800 };

test.describe("WOS-202 mobile nav + simulate layout", () => {
  test("mobile viewport hides sidebar and exposes hamburger drawer", async ({ page }) => {
    await page.setViewportSize(IPHONE_SE);

    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    const response = await page.goto("/simulate");
    expect(response?.status()).toBe(200);

    // Desktop sidebar is still in DOM (hidden md:flex) but must not be visible.
    await expect(page.locator("nav a[href='/simulate']").first()).not.toBeVisible();

    // Hamburger trigger exists and is visible.
    const trigger = page.getByRole("button", { name: /Open menu/i });
    await expect(trigger).toBeVisible();

    // Drawer opens on tap; the simulate link inside becomes visible.
    await trigger.click();
    const drawer = page.getByRole("dialog", { name: /Site navigation/i });
    await expect(drawer).toBeVisible();
    const simulateLink = drawer.locator("a[href='/simulate']");
    await expect(simulateLink).toBeVisible();

    // Drawer closes with Escape.
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);

    expect(errors).toHaveLength(0);
  });

  test("simulate page fits mobile viewport without horizontal overflow", async ({ page }) => {
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
    await expect(page.getByRole("heading", { name: "Attacker" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Defender" })).toBeVisible();

    // Simulate button touch-target is at least 44px tall (Apple HIG minimum).
    const simulateBtn = page.getByRole("button", { name: /^Simulate$/i });
    const box = await simulateBtn.boundingBox();
    expect(box).not.toBeNull();
    expect((box?.height ?? 0) + 0.5).toBeGreaterThanOrEqual(44);

    // No horizontal scroll on the body.
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return {
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
      };
    });
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

    expect(errors).toHaveLength(0);
  });

  test("desktop viewport shows sidebar nav and no mobile trigger", async ({ page }) => {
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

    // Mobile hamburger is rendered (md:hidden) but must not be visible on desktop.
    await expect(page.getByRole("button", { name: /Open menu/i })).not.toBeVisible();

    expect(errors).toHaveLength(0);
  });
});
