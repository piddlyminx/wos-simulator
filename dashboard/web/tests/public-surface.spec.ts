import { expect, test } from "@playwright/test";

test.describe("public simulate surface", () => {
  test.skip(
    process.env.PUBLIC_SURFACE !== "simulate",
    "PUBLIC_SURFACE=simulate is required for public-surface tests",
  );

  test("/ redirects to /simulate and hides private dashboard nav", async ({
    page,
  }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBeLessThan(400);
    await expect(page).toHaveURL(/\/simulate$/);
    await expect(page.getByRole("link", { name: "Battle Sim" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Bear Sim" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Runs" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Coverage" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Heroes" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Testcases" })).toHaveCount(0);
    await expect(page.getByText("Accuracy Dashboard")).toHaveCount(0);
  });

  test("/bear remains public", async ({ page }) => {
    const response = await page.goto("/bear");
    expect(response?.status()).toBe(200);
    await expect(page.getByTestId("bear-start-card")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Player army" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Bear Sim" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Runs" })).toHaveCount(0);
  });

  test("private QA routes and check-testcases API are blocked", async ({
    request,
  }) => {
    for (const path of [
      "/runs",
      "/coverage",
      "/heroes",
      "/testcases",
      "/testcases/changelog",
      "/compare/a/b",
      "/api/check-testcases",
    ]) {
      const response = await request.get(path);
      expect(response.status(), `${path} should be blocked`).toBe(404);
    }
  });

  test("simulate APIs remain public and OCR size guard rejects oversized uploads", async ({
    request,
  }) => {
    const runs = await request.get("/api/simulate/runs?limit=1");
    expect(runs.status()).toBe(200);

    const oversized = await request.post("/api/ocr-report", {
      data: { image_base64: "A".repeat(12 * 1024 * 1024) },
    });
    expect(oversized.status()).toBe(413);
  });
});
