# Dashboard Simulator Mobile Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved health-dashboard navigation and mobile simulator overhaul while preserving the filtered testcase signed-bias line chart.

**Architecture:** Keep desktop simulator behavior mostly intact, but add a mobile-only tabbed/focused layout around the existing `SidePanel` controls. Reuse current simulator state, OCR modal, stat presets, rally mode, sync hero stats, run controls, and results rendering. Group site navigation without changing routes.

**Tech Stack:** Next.js App Router, React client components, Tailwind utility classes, Playwright tests, Recharts for existing signed-bias chart.

---

### Task 1: Tests First

**Files:**
- Modify: `dashboard/web/tests/mobile-nav.spec.ts`
- Modify: `dashboard/web/tests/smoke.spec.ts`

- [ ] Add Playwright expectations for grouped mobile nav labels: `Quality Metrics`, `Simulation Running`, and `Library`.
- [ ] Update mobile simulator expectations to require `Upload report`, `Rally mode`, `Sync hero stats`, `Attacker / Defender / Results` tabs, role preset controls, hidden joiners when rally mode is off, visible joiners when rally mode is on, and no horizontal overflow.
- [ ] Add or keep a `/runs` regression expectation for `data-testid="testcase-drift-chart"` and `data-testid="hide-smoke-runs-toggle"`.
- [ ] Run the changed tests before production edits and confirm they fail on the missing new simulator/nav behavior.

### Task 2: Group Navigation And Health Dashboard

**Files:**
- Modify: `dashboard/web/components/SiteNav.tsx`
- Modify: `dashboard/web/app/page.tsx`

- [ ] Group non-public navigation under `Quality Metrics`, `Simulation Running`, and `Library`.
- [ ] Keep mobile drawer closed by default.
- [ ] Rename the dashboard heading to `Health Dashboard`.
- [ ] Add a clear simulation entry action from the dashboard without removing existing health cards.

### Task 3: Mobile Simulator Structure

**Files:**
- Modify: `dashboard/web/app/simulate/SimulateClient.tsx`

- [ ] Add mobile tab state for `attacker`, `defender`, and `results`.
- [ ] Keep `Upload report`, `Rally mode`, and `Sync hero stats` visible above the tabs.
- [ ] Move role preset load/save controls into each side tab by preserving the existing per-side profile button and making the role context clear.
- [ ] Render only the active side panel on mobile while preserving both side panels on desktop.
- [ ] Hide joiner controls unless rally mode is enabled.
- [ ] Keep buffs/debuffs folded by default.
- [ ] Show results in the mobile `Results` tab and keep desktop results below the run controls.

### Task 4: Verification

**Files:**
- Verify: `dashboard/web/tests/mobile-nav.spec.ts`
- Verify: `dashboard/web/tests/browser-simulator.spec.ts`
- Verify: `dashboard/web/tests/smoke.spec.ts` relevant chart/simulator tests

- [ ] Run focused Playwright tests.
- [ ] Run lint or build if the focused tests pass.
- [ ] Start the dev server and use browser automation to inspect mobile and desktop layouts.
- [ ] Confirm the testcase signed-bias line chart still renders on `/runs`.
