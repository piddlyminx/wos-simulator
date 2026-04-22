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
  test('/ — home page renders all five cards with drill-down links', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));

    const response = await page.goto('/');
    expect(response?.status()).toBe(200);

    const cardIds = [
      'card-latest-run',
      'card-regressions',
      'card-coverage',
      'card-testcase-changes',
      'card-recent-commits',
    ];
    for (const id of cardIds) {
      await expect(page.locator(`[data-testid="${id}"]`)).toBeVisible();
      const cardLinks = await page
        .locator(`[data-testid="${id}"] a[href]`)
        .count();
      expect(cardLinks).toBeGreaterThan(0);
    }

    // Five-way headline labels (WOS-186 Skipped included)
    const latest = page.locator('[data-testid="card-latest-run"]');
    for (const label of ['Improved', 'Regressed', 'Added', 'Retired', 'Skipped']) {
      await expect(latest).toContainText(label);
    }

    // Sidebar nav link exists
    await expect(page.locator('nav a[href="/"]')).toBeVisible();

    expect(errors).toHaveLength(0);
  });

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

  test('/runs — check-now controls are visible and the filter expands', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));

    const response = await page.goto('/runs');
    expect(response?.status()).toBe(200);

    await expect(page.locator('[data-testid="check-now-controls"]')).toBeVisible();
    await expect(page.locator('[data-testid="check-now-button"]')).toBeVisible();
    await expect(page.locator('[data-testid="check-now-filter-input"]')).toHaveCount(0);

    await page.locator('[data-testid="check-now-filter-toggle"]').click();
    const input = page.locator('[data-testid="check-now-filter-input"]');
    await expect(input).toBeVisible();
    await input.fill('alonso solo');
    await expect(input).toHaveValue('alonso solo');

    expect(errors).toHaveLength(0);
  });

  test('/runs — testcase variance chart bridges missing middle-run data with a dashed line', async ({ page }) => {
    // WOS-189: run-index x-axis + dotted-bridge for interior coverage gaps.
    // Real fixture data includes >100 testcases missing from at least one
    // run in the last 50, so top-variance selection will reliably include
    // at least one gappy series when the chart renders.
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));

    const response = await page.goto('/runs');
    expect(response?.status()).toBe(200);

    // Chart SVG should render. Recharts emits <path class="recharts-line-curve">
    // for each Line — one per solid series plus one per dashed bridge.
    await page.waitForSelector('.recharts-line-curve', { timeout: 10_000 });

    // At least one solid line (actual data) present.
    const solidPaths = await page
      .locator('path.recharts-line-curve:not([stroke-dasharray])')
      .count();
    expect(solidPaths).toBeGreaterThan(0);

    // At least one dashed bridge path present (interpolated gap).
    const dashedPaths = await page
      .locator('path.recharts-line-curve[stroke-dasharray]')
      .count();
    expect(dashedPaths).toBeGreaterThan(0);

    expect(errors).toHaveLength(0);
  });

  test('/runs — testcase drift legend can pin a series for identification', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));

    const response = await page.goto('/runs');
    expect(response?.status()).toBe(200);

    await page.waitForSelector('[data-testid="testcase-drift-legend"] button', { timeout: 10_000 });
    await page.mouse.move(0, 0);

    const focus = page.locator('[data-testid="testcase-drift-focus"]');
    await expect(focus).toBeVisible();

    const firstLegendItem = page.locator('[data-testid="testcase-drift-legend"] button').first();
    await firstLegendItem.click();
    await expect(firstLegendItem).toHaveAttribute('aria-pressed', 'true');
    await expect(focus).toContainText('Pinned series: #1');
    await expect(focus).toContainText('Click again to clear.');

    await firstLegendItem.click();
    await page.mouse.move(0, 0);
    await expect(firstLegendItem).toHaveAttribute('aria-pressed', 'false');
    await expect(focus).toContainText('Hover a legend row or chart line to isolate a testcase');

    expect(errors).toHaveLength(0);
  });

  test('/runs — hovered testcase is emphasized inside the hover tooltip', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));

    const response = await page.goto('/runs');
    expect(response?.status()).toBe(200);

    await page.waitForSelector('[data-testid="testcase-drift-legend"] button', { timeout: 10_000 });
    const firstLegendItem = page.locator('[data-testid="testcase-drift-legend"] button').first();
    await firstLegendItem.click();

    const chart = page.locator('[data-testid="testcase-drift-chart"]');
    const box = await chart.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width * 0.25, box!.y + box!.height * 0.55);

    const tooltip = page.locator('[data-testid="testcase-drift-tooltip"]');
    await expect(tooltip).toBeVisible();
    const activeRow = page.locator('[data-testid="testcase-drift-tooltip-row-active"]');
    await expect(activeRow).toBeVisible();
    await expect(page.locator('[data-testid="testcase-drift-focus"]')).toContainText('Focused series:');
    await expect(page.locator('[data-testid="testcase-drift-tooltip-row-active"]')).toHaveCount(1);

    expect(errors).toHaveLength(0);
  });

  test('/runs — smoke-run toggle is off by default and prunes x-axis ticks when enabled', async ({ page }) => {
    // WOS-189 follow-up: board asked for smoke-run filtering to be opt-in,
    // with default behaviour showing every run that any visible top-N series
    // has data in. The toggle should be unchecked on first render and
    // reduce the number of x-axis ticks when turned on (fixture data has a
    // substantial number of 1-3-testcase smoke runs in the last 50).
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));

    const response = await page.goto('/runs');
    expect(response?.status()).toBe(200);
    await page.waitForSelector('.recharts-line-curve', { timeout: 10_000 });

    const toggle = page.locator('[data-testid="hide-smoke-runs-toggle"] input[type="checkbox"]');
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toBeChecked();

    const ticksBefore = await page.locator('.recharts-xAxis .recharts-cartesian-axis-tick').count();
    expect(ticksBefore).toBeGreaterThan(0);

    await toggle.check();
    await expect(toggle).toBeChecked();
    // Give Recharts a tick to re-render.
    await page.waitForTimeout(250);
    const ticksAfter = await page.locator('.recharts-xAxis .recharts-cartesian-axis-tick').count();
    expect(ticksAfter).toBeLessThan(ticksBefore);

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
    if (hasCells) {
      for (const hero of ['Bradley', 'Edith', 'Gordon', 'Ling']) {
        await expect(page.locator('body')).toContainText(hero);
      }
    }

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
    if (hasRows) {
      await expect(page.locator('body')).toContainText('Gen 7');
      for (const hero of ['Bradley', 'Edith', 'Gordon', 'Ling']) {
        await expect(page.locator('body')).toContainText(hero);
      }
    }

    expect(errors).toHaveLength(0);
  });

  test('/simulate — gen 7 heroes are selectable', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));

    const response = await page.goto('/simulate');
    expect(response?.status()).toBe(200);

    await expect(page.locator('h2')).toContainText('Simulate Battle');

    const infantryOptions = await page
      .locator('select[aria-label="infantry hero"]')
      .first()
      .locator('option')
      .allTextContents();
    expect(infantryOptions).toContain('Edith');

    const lancerOptions = await page
      .locator('select[aria-label="lancer hero"]')
      .first()
      .locator('option')
      .allTextContents();
    expect(lancerOptions).toContain('Gordon');
    expect(lancerOptions).toContain('Ling');

    const marksmanOptions = await page
      .locator('select[aria-label="marksman hero"]')
      .first()
      .locator('option')
      .allTextContents();
    expect(marksmanOptions).toContain('Bradley');

    expect(errors).toHaveLength(0);
  });

  test('/simulate — active skill 4 bonuses show effective stat previews', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));

    const response = await page.goto('/simulate');
    expect(response?.status()).toBe(200);

    await page.getByLabel('Rally mode').first().check();
    await page.locator('select[aria-label="marksman hero"]').first().selectOption('Alonso');
    await expect(page.locator('select[aria-label="marksman skill 4"]').first()).toHaveValue('5');

    const preview = page.locator('[data-testid="stat-preview-attacker-infantry-lethality"]');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('[115]');
    await expect(preview).toContainText('+15.0%');

    expect(errors).toHaveLength(0);
  });

  test('/simulate upload — selected skill 4 level carries back to main form', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));

    await page.route('**/api/ocr-report', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          attacker: {
            troops: { infantry: 123, lancer: 234, marksman: 345 },
            stats: {
              infantry: { attack: 100, defense: 100, lethality: 100, health: 100 },
              lancer: { attack: 100, defense: 100, lethality: 100, health: 100 },
              marksman: { attack: 100, defense: 100, lethality: 100, health: 100 },
            },
          },
          defender: {
            troops: { infantry: 456, lancer: 567, marksman: 678 },
            stats: {
              infantry: { attack: 100, defense: 100, lethality: 100, health: 100 },
              lancer: { attack: 100, defense: 100, lethality: 100, health: 100 },
              marksman: { attack: 100, defense: 100, lethality: 100, health: 100 },
            },
          },
          warnings: [],
        }),
      });
    });

    const response = await page.goto('/simulate');
    expect(response?.status()).toBe(200);

    await page.getByRole('button', { name: /Upload report/i }).click();
    const dialog = page.getByRole('dialog', { name: 'Upload battle report' });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel('Rally mode').check();
    await dialog.getByLabel('Attacker heroes marksman').selectOption('Alonso');
    await dialog.getByLabel('Attacker heroes marksman skill 4 level').selectOption('0');

    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'report.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WnS2GAAAAAASUVORK5CYII=',
        'base64',
      ),
    });

    await dialog.getByRole('button', { name: /Parse and apply/i }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByLabel('Rally mode').first()).toBeChecked();
    await expect(page.locator('select[aria-label="marksman hero"]').first()).toHaveValue('Alonso');
    await expect(page.locator('select[aria-label="marksman skill 4"]').first()).toHaveValue('0');

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
