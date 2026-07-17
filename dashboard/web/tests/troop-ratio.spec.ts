import { expect, test, type Locator, type Page } from "@playwright/test";

async function troopCounts(page: Page, armyIndex = 0): Promise<number[]> {
  return Promise.all(
    ["infantry", "lancer", "marksman"].map(async (category) =>
      Number(
        await page
          .locator(`input[aria-label="${category} troop count"]`)
          .nth(armyIndex)
          .inputValue(),
      ),
    ),
  );
}

async function dragHorizontally(
  page: Page,
  locator: Locator,
  distance: number,
) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  const startX = (box?.x ?? 0) + (box?.width ?? 0) / 2;
  const startY = (box?.y ?? 0) + (box?.height ?? 0) / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + distance, startY);
  await page.mouse.up();
}

test("troop ratio handles and Lancer segment adjust the shared army counts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  const response = await page.goto("/simulate");
  expect(response?.status()).toBe(200);
  const skipTour = page.getByRole("button", { name: "Skip", exact: true });
  if (await skipTour.isVisible()) await skipTour.click();

  const ratio = page.getByTestId("troop-ratio-attacker");
  const track = ratio.locator(".sim-troop-ratio-track");
  const infantryRow = page.getByTestId("sim-unit-row-attacker-infantry");
  await expect(ratio).toBeVisible();
  await expect(ratio).toContainText("Infantry 33.3%");
  await expect(ratio).toContainText("Lancer 33.3%");
  await expect(ratio).toContainText("Marksman 33.3%");

  await expect(infantryRow).toBeVisible();
  expect(
    await ratio.evaluate(
      (element) => element.nextElementSibling?.getAttribute("data-testid"),
    ),
  ).toBe("sim-unit-row-attacker-infantry");

  const leftHandle = ratio.getByTestId(
    "troop-ratio-attacker-infantry-lancer-handle",
  );
  const lancerSegment = ratio.getByTestId(
    "troop-ratio-attacker-lancer-segment",
  );
  const rightHandle = ratio.getByTestId(
    "troop-ratio-attacker-lancer-marksman-handle",
  );
  await leftHandle.focus();
  await page.keyboard.press("Tab");
  await expect(lancerSegment).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(rightHandle).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("infantry troop count").first()).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(rightHandle).toBeFocused();

  const defenderHandle = page.getByTestId(
    "troop-ratio-defender-infantry-lancer-handle",
  );
  await defenderHandle.click();
  await expect(defenderHandle).toBeFocused();
  await page.keyboard.press("ArrowRight");
  expect(await troopCounts(page, 1)).toEqual([51000, 48000, 51000]);

  const trackBox = await track.boundingBox();
  expect(trackBox).not.toBeNull();
  const fivePercent = (trackBox?.width ?? 0) * 0.05;

  await dragHorizontally(
    page,
    ratio.getByTestId("troop-ratio-attacker-infantry-lancer-handle"),
    fivePercent,
  );
  expect(await troopCounts(page)).toEqual([57000, 42000, 51000]);
  await expect(ratio).toContainText("Infantry 38%");
  await expect(ratio).toContainText("Lancer 28%");

  await lancerSegment.hover();
  await expect(lancerSegment).toHaveCSS("cursor", "grab");
  await dragHorizontally(page, lancerSegment, -fivePercent);

  expect(await troopCounts(page)).toEqual([49500, 42000, 58500]);
  await expect(ratio).toContainText("Infantry 33%");
  await expect(ratio).toContainText("Lancer 28%");
  await expect(ratio).toContainText("Marksman 39%");
});

test("the shared troop ratio input is available in Bear Sim", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  const response = await page.goto("/bear");
  expect(response?.status()).toBe(200);

  const ratio = page.getByTestId("troop-ratio-attacker");
  await expect(ratio).toBeVisible();
  await expect(
    ratio.getByRole("slider", {
      name: /Player army Lancer segment; keep Lancer fixed/i,
    }),
  ).toBeVisible();
});
