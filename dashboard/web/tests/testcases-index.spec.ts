import { expect, test } from "@playwright/test";

test("/testcases lists testcase rows rather than file rows", async ({ page }) => {
  const response = await page.goto("/testcases");
  expect(response?.status()).toBe(200);

  await expect(page.locator('[data-testid="testcases-index-table"]')).toContainText("Case");

  const filter = page.locator('[data-testid="testcases-index-path-filter"]');
  await filter.fill("greg_mia_combo");

  const visibleRows = page.locator('[data-testid="testcases-index-table"] tbody tr');
  await expect(visibleRows).toHaveCount(2);
  await expect(visibleRows.nth(0)).toContainText("greg_mia_combo");
  await expect(visibleRows.nth(1)).toContainText("greg_mia_combo");
});
