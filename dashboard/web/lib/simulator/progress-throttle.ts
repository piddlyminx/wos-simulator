type ProgressCallback = (done: number, total: number) => void;
type ScheduleCallback = (flush: () => void) => number;
type CancelScheduleCallback = (id: number) => void;

interface PendingProgress {
  done: number;
  total: number;
}

export interface ProgressThrottle {
  update(done: number, total: number): void;
  flush(): void;
  cancel(): void;
}

export function createProgressThrottle(
  onProgress: ProgressCallback,
  schedule: ScheduleCallback = defaultSchedule,
  cancelSchedule: CancelScheduleCallback = defaultCancelSchedule,
): ProgressThrottle {
  let pending: PendingProgress | null = null;
  let frameId: number | null = null;

  function flush(): void {
    if (frameId !== null) {
      cancelSchedule(frameId);
      frameId = null;
    }
    if (!pending) return;
    const latest = pending;
    pending = null;
    onProgress(latest.done, latest.total);
  }

  return {
    update(done, total) {
      pending = { done, total };
      if (frameId !== null) return;
      frameId = schedule(() => {
        frameId = null;
        if (!pending) return;
        const latest = pending;
        pending = null;
        onProgress(latest.done, latest.total);
      });
    },
    flush,
    cancel() {
      if (frameId !== null) {
        cancelSchedule(frameId);
        frameId = null;
      }
      pending = null;
    },
  };
}

function defaultSchedule(flush: () => void): number {
  if (typeof requestAnimationFrame === "function") {
    return requestAnimationFrame(flush);
  }
  return setTimeout(flush, 16) as unknown as number;
}

function defaultCancelSchedule(id: number): void {
  if (typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(id);
    return;
  }
  clearTimeout(id);
}
