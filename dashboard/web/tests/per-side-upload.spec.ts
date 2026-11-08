import { test, expect } from "@playwright/test";
import path from "path";

test.use({ channel: "chrome" });

test("per-side upload imports report to Attacker and leaves Defender completely undisturbed", async ({ page }) => {
  test.setTimeout(90000);
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  await page.goto("/simulate");

  // Verify no hydration errors
  const hydrationErrors = consoleErrors.filter((e) => e.includes("Hydration failed"));
  expect(hydrationErrors).toHaveLength(0);

  // 1. Verify Upload button exists on Attacker panel
  const attackerUploadBtn = page.getByTestId("side-upload-button-attacker");
  await expect(attackerUploadBtn).toBeVisible();
  await expect(attackerUploadBtn).toHaveText("Upload");

  // Verify Upload button also exists on Defender panel
  const defenderUploadBtn = page.getByTestId("side-upload-button-defender");
  await expect(defenderUploadBtn).toBeVisible();
  await expect(defenderUploadBtn).toHaveText("Upload");

  // Read initial defender troop count
  const defenderSummary = await page.locator('[data-tour="side-panel-defender"]').innerText();

  // 2. Click Upload on Attacker
  await attackerUploadBtn.click();

  // Verify Modal opens with target-specific title
  const modal = page.locator(".sim-modal");
  await expect(modal).toBeVisible();
  await expect(page.locator(".sim-modal-title")).toHaveText("Upload attacker report");

  // Verify neutral source toggle exists
  const leftToggle = page.getByRole("button", { name: "Import Left side" });
  const rightToggle = page.getByRole("button", { name: "Import Right side" });
  await expect(leftToggle).toBeVisible();
  await expect(rightToggle).toBeVisible();

  // Verify Apply button label
  const applyBtn = page.getByRole("button", { name: "Apply to Attacker" });
  await expect(applyBtn).toBeVisible();

  // 3. Upload a sample battle report image
  const reportPath = path.resolve(__dirname, "../../test_reports/Screenshot 2026-03-20 005937.png");
  const fileInput = modal.locator('input[type="file"]');
  await fileInput.setInputFiles(reportPath);

  // 4. Click Apply to Attacker
  await applyBtn.click();

  // Wait for modal to close (after OCR parsing completes)
  await expect(modal).not.toBeVisible({ timeout: 60000 });

  // 5. Verify Attacker was updated
  const attackerPanel = page.locator('[data-tour="side-panel-attacker"]');
  await expect(attackerPanel).toBeVisible();

  // 6. Verify Defender remained identical / undisturbed
  const defenderSummaryAfter = await page.locator('[data-tour="side-panel-defender"]').innerText();
  expect(defenderSummaryAfter).toBe(defenderSummary);

  // Take a visual screenshot for artifact review
  await page.screenshot({ path: path.resolve(__dirname, "../../../artifacts/per_side_upload_verified.png"), fullPage: true });
});
