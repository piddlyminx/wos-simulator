import { expect, test } from "@playwright/test";

test("custom troop types use the catalogue and invalid drafts restore the tier select", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  const response = await page.goto("/simulate");
  expect(response?.status()).toBe(200);

  const skipTour = page.getByRole("button", { name: "Skip", exact: true });
  if (await skipTour.isVisible()) await skipTour.click();

  const infantryRow = page.getByTestId("sim-unit-row-attacker-infantry");
  const tierSelect = infantryRow.getByLabel("infantry troop tier");
  await expect(tierSelect.locator("option").last()).toHaveText("Other");
  await expect(tierSelect.locator('option[value="t10_fc10"]')).toHaveCount(1);
  await expect(tierSelect.locator('option[value="t6_fc10"]')).toHaveCount(0);

  await tierSelect.selectOption("__other__");
  const customTroopType = infantryRow.getByLabel(
    "infantry custom troop type",
  );
  await expect(customTroopType).toBeFocused();
  await customTroopType.fill("not_a_troop");
  await customTroopType.blur();

  await expect(tierSelect).toBeVisible();
  await expect(tierSelect).toHaveValue("t11_fc10");

  await tierSelect.selectOption("__other__");
  await expect(customTroopType).toHaveAttribute("placeholder", "t6_fc10");
  await customTroopType.fill("t6_fc10");
  await customTroopType.blur();

  await expect(customTroopType).toBeVisible();
  await expect(customTroopType).toHaveValue("t6_fc10");
});
