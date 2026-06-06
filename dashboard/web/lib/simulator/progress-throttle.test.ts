import assert from "node:assert/strict";
import { test } from "node:test";

import { createProgressThrottle } from "./progress-throttle";

test("createProgressThrottle coalesces progress updates until the scheduled flush", () => {
  const calls: Array<[number, number]> = [];
  const scheduled: Array<() => void> = [];
  const progress = createProgressThrottle((done, total) => calls.push([done, total]), (flush) => {
    scheduled.push(flush);
    return 1;
  });

  progress.update(1, 10);
  progress.update(2, 10);
  progress.update(3, 10);

  assert.deepEqual(calls, []);
  assert.equal(scheduled.length, 1);

  scheduled[0]();

  assert.deepEqual(calls, [[3, 10]]);
});

test("createProgressThrottle flushes the latest progress immediately", () => {
  const calls: Array<[number, number]> = [];
  const progress = createProgressThrottle((done, total) => calls.push([done, total]), () => 1);

  progress.update(1, 10);
  progress.update(2, 10);
  progress.flush();

  assert.deepEqual(calls, [[2, 10]]);
});
