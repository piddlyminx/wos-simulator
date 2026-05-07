import { lock } from "proper-lockfile";
import path from "path";

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
  const release = await lock(directory, lockOptions(directory));
  try {
    return await action();
  } finally {
    await release();
  }
}
