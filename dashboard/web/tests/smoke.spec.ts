import { test, expect, Page } from '@playwright/test';
import Database from 'better-sqlite3';
import path from 'path';

const DIRTY_RUN_ID = 'aea74765-66e1-4f7c-b721-3565f98319ee';

const DB_PATH =
  process.env.DB_PATH ??
  path.resolve(__dirname, '../../../test_results/dashboard.sqlite');

function twoMostRecentRunIds(): { a: string; b: string } {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const rows = db
      .prepare(`SELECT id FROM runs ORDER BY started_at DESC LIMIT 2`)
      .all() as { id: string }[];
    if (rows.length < 2) {
      throw new Error(
        `Need at least 2 runs in ${DB_PATH} for compare smoke tests; found ${rows.length}`,
      );
    }
    // a = older (baseline), b = newer (current)
    return { a: rows[1].id, b: rows[0].id };
  } finally {
    db.close();
  }
}

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

    // Wait for the table to appear (inside accordion which defaults open)
    await page.waitForSelector('[data-testid="runs-table"] tbody tr', { timeout: 10_000 });
    const rows = await page.locator('[data-testid="runs-table"] tbody tr').count();
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

  test('/heroes/Alonso — timeline and skill history visible', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));

    const response = await page.goto('/heroes/Alonso');
    expect(response?.status()).toBe(200);

    // Coverage timeline section heading
    await expect(page.locator('h3').filter({ hasText: 'Coverage Timeline' })).toBeVisible();
    // Per-skill table with coverage column header
    await expect(page.locator('body')).toContainText('Covered');
    // No console errors
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

  test('/compare/[a]/[b] — renders headline + delta sections', async ({ page }) => {
    const { a, b } = twoMostRecentRunIds();

    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));

    const response = await page.goto(`/compare/${a}/${b}`);
    expect(response?.status()).toBe(200);

    // Headline strip stat-card labels
    await expect(page.locator('body')).toContainText('Avg Error A');
    await expect(page.locator('body')).toContainText('Avg Error B');
    // Section 2 heading
    await expect(page.locator('body')).toContainText('Testcase Delta');

    expect(errors).toHaveLength(0);
  });

  test('/testcases/changelog — renders cross-run table', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));

    const response = await page.goto('/testcases/changelog');
    expect(response?.status()).toBe(200);

    await expect(page.locator('body')).toContainText('Testcase Changelog');

    // Table must have at least one row from real data.
    await page.waitForSelector('[data-testid="changelog-table"] tbody tr', {
      timeout: 10_000,
    });
    const rows = await page.locator('[data-testid="changelog-table"] tbody tr').count();
    expect(rows).toBeGreaterThan(0);

    // Retired filter narrows the set deterministically.
    const totalBefore = rows;
    await page.locator('[data-testid="changelog-filter-retired"]').check();
    await page.waitForFunction(
      (n) =>
        document.querySelectorAll('[data-testid="changelog-table"] tbody tr')
          .length !== n,
      totalBefore,
      { timeout: 5_000 },
    );
    const retiredRows = await page
      .locator('[data-testid="changelog-table"] tbody tr')
      .count();
    expect(retiredRows).toBeLessThanOrEqual(totalBefore);

    // Nav link from layout sidebar is present.
    const navLink = page.locator('nav a[href="/testcases/changelog"]');
    await expect(navLink).toBeVisible();

    expect(errors).toHaveLength(0);
  });

  test('/runs/[id]/compare/prev — redirects to compare page', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));

    // page.goto follows redirects by default; final response is the compare page.
    const response = await page.goto(`/runs/${DIRTY_RUN_ID}/compare/prev`);
    expect(response?.status()).toBe(200);

    // Confirm we landed on /compare/<prev>/<DIRTY_RUN_ID>
    expect(page.url()).toMatch(new RegExp(`/compare/[^/]+/${DIRTY_RUN_ID}$`));

    // Compare page renders its headline labels
    await expect(page.locator('body')).toContainText('Compare Runs');
    await expect(page.locator('body')).toContainText('Testcase Delta');

    expect(errors).toHaveLength(0);
  });
});
