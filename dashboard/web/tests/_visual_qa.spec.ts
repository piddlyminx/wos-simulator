import { test } from "@playwright/test";
import path from "path";

// Screenshots for WOS-202 visual QA. Not a real assertion — produces images
// under test-results/wos-202/ for the engineer to review. Filename is
// prefixed with an underscore so smoke runs can exclude it with a glob.

const OUT = path.join(__dirname, "..", "test-results", "wos-202");

const VIEWPORTS = [
  { name: "iphone-se-375", width: 375, height: 667 },
  { name: "iphone-14-pro-393", width: 393, height: 852 },
  { name: "pixel-6-412", width: 412, height: 915 },
  { name: "desktop-1280", width: 1280, height: 800 },
];

const ROUTES = ["/simulate"];

for (const vp of VIEWPORTS) {
  for (const route of ROUTES) {
    test(`screenshot ${route} @ ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      const file = path.join(
        OUT,
        `${vp.name}${route.replace(/\//g, "-")}-closed.png`,
      );
      await page.screenshot({ path: file, fullPage: true });
      if (vp.width < 768 && route === "/simulate") {
        // Open the drawer on mobile viewports too
        await page.getByRole("button", { name: /Open menu/i }).click();
        await page.waitForSelector("[role='dialog'][aria-label='Site navigation']");
        const drawerFile = path.join(
          OUT,
          `${vp.name}${route.replace(/\//g, "-")}-drawer.png`,
        );
        await page.screenshot({ path: drawerFile });
        // Close drawer, open upload modal
        await page.keyboard.press("Escape");
        await page
          .getByRole("button", { name: /Upload report/i })
          .click();
        await page.waitForSelector(
          "[role='dialog'][aria-label='Upload battle report']",
        );
        const modalFile = path.join(
          OUT,
          `${vp.name}${route.replace(/\//g, "-")}-upload-modal.png`,
        );
        await page.screenshot({ path: modalFile, fullPage: true });
      }
    });
  }
}
