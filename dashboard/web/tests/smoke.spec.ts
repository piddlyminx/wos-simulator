import { test, expect, Page } from '@playwright/test';

const DIRTY_RUN_ID = 'aea74765-66e1-4f7c-b721-3565f98319ee';

async function assertNoConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push(err.message));
  return errors;
}

test.describe('Dashboard smoke tests', () => {
  test('/runs — lists at least one run', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));

    const response = await page.goto('/runs');
    expect(response?.status()).toBe(200);
    expect(response?.headers()['content-length']).not.toBe('0');

    // Wait for the table to appear
    await page.waitForSelector('tbody tr', { timeout: 10_000 });
    const rows = await page.locator('tbody tr').count();
    expect(rows).toBeGreaterThan(0);

    expect(errors).toHaveLength(0);
  });

  test('/coverage — renders without crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));

    const response = await page.goto('/coverage');
    expect(response?.status()).toBe(200);

    // Either shows data table cells OR the DB-misconfiguration warning (heroes table not yet seeded)
    const hasCells = await page.locator('table tbody td').count() > 0;
    const hasMisconfigWarning = await page.locator('text=DB misconfiguration').count() > 0;
    expect(hasCells || hasMisconfigWarning).toBe(true);

    expect(errors).toHaveLength(0);
  });

  test('/heroes — renders without crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));

    const response = await page.goto('/heroes');
    expect(response?.status()).toBe(200);

    const hasRows = await page.locator('tbody tr').count() > 0;
    const hasMisconfigWarning = await page.locator('text=DB misconfiguration').count() > 0;
    expect(hasRows || hasMisconfigWarning).toBe(true);

    expect(errors).toHaveLength(0);
  });

  test('/heroes/Alonso — renders hero detail', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));

    const response = await page.goto('/heroes/Alonso');
    expect(response?.status()).toBe(200);

    await expect(page.locator('body')).toContainText('Alonso');

    expect(errors).toHaveLength(0);
  });

  test('/runs/[id] dirty — shows Dirty State Patch', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));

    const response = await page.goto(`/runs/${DIRTY_RUN_ID}`);
    expect(response?.status()).toBe(200);

    await expect(page.locator('body')).toContainText('Dirty State Patch');

    expect(errors).toHaveLength(0);
  });
});
