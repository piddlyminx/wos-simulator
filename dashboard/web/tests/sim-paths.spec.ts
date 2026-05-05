import { test, expect } from "@playwright/test";
import { filterPatchText, filterToSimulatorPaths } from "../lib/diff";
import { isSimulatorPath } from "../lib/sim-paths";
import { parsePatch } from "diff";

// Acceptance criterion from WOS-188: "A fixture patch containing both
// assets/heroes/foo.json and dashboard/web/app/page.tsx round-trips through
// the filter with only the assets file remaining."
const FIXTURE_PATCH = `diff --git a/assets/heroes/foo.json b/assets/heroes/foo.json
index 1111111..2222222 100644
--- a/assets/heroes/foo.json
+++ b/assets/heroes/foo.json
@@ -1,3 +1,3 @@
 {
-  "power": 100
+  "power": 200
 }
diff --git a/dashboard/web/app/page.tsx b/dashboard/web/app/page.tsx
index 3333333..4444444 100644
--- a/dashboard/web/app/page.tsx
+++ b/dashboard/web/app/page.tsx
@@ -1,3 +1,3 @@
 export default function Page() {
-  return <div>old</div>;
+  return <div>new</div>;
 }
diff --git a/sim_custom.py b/sim_custom.py
new file mode 100644
index 0000000..5555555
--- /dev/null
+++ b/sim_custom.py
@@ -0,0 +1,2 @@
+# scratch script
+print("hi")
diff --git a/Changelog.md b/Changelog.md
index 6666666..7777777 100644
--- a/Changelog.md
+++ b/Changelog.md
@@ -1,2 +1,3 @@
 # Changelog
+- new entry
 - old entry
diff --git a/testcases/emulator_verified/x.json b/testcases/emulator_verified/x.json
index 8888888..9999999 100644
--- a/testcases/emulator_verified/x.json
+++ b/testcases/emulator_verified/x.json
@@ -1 +1 @@
-{"a":1}
+{"a":2}
`;

test.describe("WOS-188 simulator path filter", () => {
  test("isSimulatorPath classifies the allowlist correctly", () => {
    // Positive cases
    expect(isSimulatorPath("Base_classes/Fight.py")).toBe(true);
    expect(isSimulatorPath("assets/heroes/foo.json")).toBe(true);
    expect(isSimulatorPath("testcases/emulator_verified/x.json")).toBe(true);
    expect(isSimulatorPath("fighters_data/sharp.json")).toBe(true);
    expect(isSimulatorPath("battle_specs_manual/logan.json")).toBe(true);
    expect(isSimulatorPath("pyproject.toml")).toBe(true);
    expect(isSimulatorPath("check_testcases.py")).toBe(true);
    expect(isSimulatorPath("battle_main.py")).toBe(true);
    expect(isSimulatorPath("compare_results.py")).toBe(true);

    // Negative cases — everything the board flagged as noise
    expect(isSimulatorPath("dashboard/web/app/page.tsx")).toBe(false);
    expect(isSimulatorPath("dashboard/ingest.py")).toBe(false);
    expect(isSimulatorPath("sim_custom.py")).toBe(false);
    expect(isSimulatorPath("find_rng_testcase.py")).toBe(false);
    expect(isSimulatorPath("find_rng_testcase_paul.py")).toBe(false);
    expect(isSimulatorPath("test_current.py")).toBe(false);
    expect(isSimulatorPath("test_reina.py")).toBe(false);
    expect(isSimulatorPath("test_troop_grid_search.py")).toBe(false);
    expect(isSimulatorPath("troop_grid_search.py")).toBe(false);
    expect(isSimulatorPath("Changelog.md")).toBe(false);
    expect(isSimulatorPath("README.md")).toBe(false);
    expect(isSimulatorPath("CODE_REVIEW_ISSUES.md")).toBe(false);
    expect(isSimulatorPath("last_battle_report.json")).toBe(false);
    expect(isSimulatorPath("test_results/dashboard.sqlite-wal")).toBe(false);
    expect(isSimulatorPath("tests/test_state_capture.py")).toBe(false);

    // Edge cases
    expect(isSimulatorPath("")).toBe(false);
    expect(isSimulatorPath(null)).toBe(false);
    expect(isSimulatorPath(undefined)).toBe(false);
    expect(isSimulatorPath("a/assets/heroes/foo.json")).toBe(true); // git a/ prefix
    expect(isSimulatorPath("b/dashboard/web/x.tsx")).toBe(false);
  });

  test("filterToSimulatorPaths keeps only sim-relevant parsed patches", () => {
    const parsed = parsePatch(FIXTURE_PATCH);
    expect(parsed.length).toBe(5);

    const filtered = filterToSimulatorPaths(parsed);
    expect(filtered.length).toBe(2);

    const names = filtered.map(
      (p) => (p.newFileName ?? p.oldFileName ?? "").replace(/^[ab]\//, ""),
    );
    expect(names).toContain("assets/heroes/foo.json");
    expect(names).toContain("testcases/emulator_verified/x.json");
    expect(names).not.toContain("dashboard/web/app/page.tsx");
    expect(names).not.toContain("sim_custom.py");
    expect(names).not.toContain("Changelog.md");
  });

  test("filterPatchText round-trips through parse/format and keeps only sim paths", () => {
    const out = filterPatchText(FIXTURE_PATCH);
    expect(out).not.toBe("");
    expect(out).toContain("assets/heroes/foo.json");
    expect(out).toContain("testcases/emulator_verified/x.json");
    expect(out).not.toContain("dashboard/web/app/page.tsx");
    expect(out).not.toContain("sim_custom.py");
    expect(out).not.toContain("Changelog.md");
  });

  test("filterPatchText returns empty string when nothing simulator-relevant remains", () => {
    const nonSimOnly = `diff --git a/dashboard/web/app/page.tsx b/dashboard/web/app/page.tsx
index 3333333..4444444 100644
--- a/dashboard/web/app/page.tsx
+++ b/dashboard/web/app/page.tsx
@@ -1,3 +1,3 @@
 a
-b
+c
 d
`;
    expect(filterPatchText(nonSimOnly)).toBe("");
    expect(filterPatchText("")).toBe("");
  });
});
