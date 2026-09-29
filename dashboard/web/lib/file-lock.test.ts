import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { check, lock } from "proper-lockfile";

import { withDirectoryLock } from "./file-lock";

const lockPath = (directory: string) => path.join(directory, ".wos-store.lock");

test("local writers queue across module instances without exhausting filesystem retries", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "wos-lock-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  // A fresh import exercises the separate module instances created by Next routes/HMR.
  const fresh = await import(`./file-lock.ts?case=${Date.now()}`);
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  let value = 0;
  const first = withDirectoryLock(directory, async () => {
    enter();
    await delay(10_000);
    value = 1;
    return value;
  });
  await entered;
  const second = fresh.withDirectoryLock(path.relative(process.cwd(), directory), async () => {
    assert.equal(value, 1);
    assert.equal(await check(directory, { lockfilePath: lockPath(directory) }), true);
    value = 2;
    return value;
  });
  const third = withDirectoryLock(directory, async () => {
    assert.equal(value, 2);
    return ++value;
  });
  const results = await Promise.allSettled([first, second, third]);
  assert.deepEqual(results, [1, 2, 3].map((result) => ({ status: "fulfilled", value: result })));
  assert.equal(await check(directory, { lockfilePath: lockPath(directory) }), false);
});

test("failed actions and lock acquisition do not poison the directory queue", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "wos-lock-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "store");
  await assert.rejects(withDirectoryLock(directory, async () => 0), { code: "ENOENT" });
  await mkdir(directory);
  const failure = new Error("write failed");
  const failed = withDirectoryLock(directory, async () => { throw failure; });
  const next = withDirectoryLock(directory, async () => "saved");
  await assert.rejects(failed, (error) => error === failure);
  assert.equal(await next, "saved");
});

test("external locks still exclude local writers without blocking other directories", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "wos-lock-"));
  const other = await mkdtemp(path.join(tmpdir(), "wos-lock-"));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
    await rm(other, { recursive: true, force: true });
  });
  const release = await lock(directory, { lockfilePath: lockPath(directory) });
  let entered = false;
  const pending = withDirectoryLock(directory, async () => { entered = true; return "saved"; });
  try {
    assert.equal(await withDirectoryLock(other, async () => "independent"), "independent");
    await delay(100);
    assert.equal(entered, false);
  } finally {
    await release();
  }
  assert.equal(await pending, "saved");
});
