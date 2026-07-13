import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BasicInfoRecorder,
  createRecorder,
  FullTraceRecorder,
  NULL_RECORDER,
  NullRecorder
} from "./recorder";

const unusedResolved = () => {
  throw new Error("recorder selection test does not resolve a battle");
};

test("createRecorder selects one explicit recorder implementation per simulation mode", () => {
  const fast = createRecorder("fast", [], unusedResolved);
  const standard = createRecorder("standard", [], unusedResolved);
  const trace = createRecorder("trace", [], unusedResolved);

  assert.equal(fast, NULL_RECORDER);
  assert.ok(fast instanceof NullRecorder);
  assert.ok(standard instanceof BasicInfoRecorder);
  assert.equal(standard instanceof FullTraceRecorder, false);
  assert.ok(trace instanceof FullTraceRecorder);
  assert.deepEqual(fast.skillReport, { attacker: [], defender: [] });
  assert.deepEqual(standard.skillReport, { attacker: [], defender: [] });
  assert.deepEqual(trace.skillReport, { attacker: [], defender: [] });
});
