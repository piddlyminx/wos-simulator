import { lock } from "proper-lockfile";
import path from "path";

// Share queues across Next route bundles and development module reloads.
const processState = globalThis as typeof globalThis & {
  wosDirectoryLockQueues?: Map<string, Promise<void>>;
};
const queues = processState.wosDirectoryLockQueues ??= new Map<string, Promise<void>>();

function lockOptions(directory: string) {
  return {
    stale: 30_000,
    update: 5_000,
    realpath: false,
    lockfilePath: path.join(directory, ".wos-store.lock"),
    retries: {
      retries: 20,
      minTimeout: 50,
      maxTimeout: 500,
      factor: 1.35,
    },
  };
}

export async function withDirectoryLock<T>(
  directory: string,
  action: () => Promise<T>,
): Promise<T> {
  directory = path.resolve(directory);
  const previous = queues.get(directory);
  let complete!: () => void;
  const pending = new Promise<void>((resolve) => { complete = resolve; });
  queues.set(directory, pending);

  await previous;
  try {
    const release = await lock(directory, lockOptions(directory));
    try {
      return await action();
    } finally {
      await release();
    }
  } finally {
    if (queues.get(directory) === pending) queues.delete(directory);
    complete();
  }
}
