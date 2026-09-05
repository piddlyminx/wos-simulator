import assert from "node:assert/strict";
import test from "node:test";
import {
  deployModeForSavedKind,
  deployRunHref,
} from "./deploy-route";

test("deploy mode follows the saved-run family", () => {
  assert.equal(deployModeForSavedKind("simulate"), "battle");
  assert.equal(deployModeForSavedKind("optimize_ratio"), "battle");
  assert.equal(deployModeForSavedKind("ratio_explorer"), "battle");
  assert.equal(deployModeForSavedKind("bear_simulate"), "bear");
  assert.equal(deployModeForSavedKind("bear_optimize_ratio"), "bear");
});

test("deploy run links retain mode and safely encode run ids", () => {
  assert.equal(
    deployRunHref("battle run/1", "simulate"),
    "/simualate-wosui?mode=battle&run=battle+run%2F1",
  );
  assert.equal(
    deployRunHref("bear run/1", "bear_simulate"),
    "/simualate-wosui?mode=bear&run=bear+run%2F1",
  );
});
