type ProgressCallback = (done: number, total: number) => void;
type ScheduleCallback = (flush: () => void) => number;
type CancelScheduleCallback = (id: number) => void;

const PROGRESS_UPDATE_INTERVAL_MS = 100;

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
  let scheduledId: number | null = null;
  let lastEmitted: PendingProgress | null = null;

  function emitLatest(): void {
    if (!pending) return;
    const latest = pending;
    pending = null;
    if (
      lastEmitted?.done === latest.done &&
      lastEmitted.total === latest.total
    ) {
      return;
    }
    lastEmitted = latest;
    onProgress(latest.done, latest.total);
  }

  function flush(): void {
    if (scheduledId !== null) {
      cancelSchedule(scheduledId);
      scheduledId = null;
    }
    emitLatest();
  }

  return {
    update(done, total) {
      pending = { done, total };
      if (scheduledId !== null) return;
      scheduledId = schedule(() => {
        scheduledId = null;
        emitLatest();
      });
    },
    flush,
    cancel() {
      if (scheduledId !== null) {
        cancelSchedule(scheduledId);
        scheduledId = null;
      }
      pending = null;
    },
  };
}

function defaultSchedule(flush: () => void): number {
  return setTimeout(flush, PROGRESS_UPDATE_INTERVAL_MS) as unknown as number;
}

function defaultCancelSchedule(id: number): void {
  clearTimeout(id);
}
