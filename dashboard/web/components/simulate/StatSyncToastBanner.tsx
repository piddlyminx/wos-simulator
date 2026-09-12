"use client";

import type { TroopCategory } from "@/lib/heroes-catalogue";
import type { HeroBaseStats } from "@/lib/hero-base-stats";
import type { Side } from "@/lib/simulate/form-state";

export interface StatSyncToast {
  id: number;
  which: Side;
  cat: TroopCategory;
  oldHeroName: string | null;
  newHeroName: string | null;
  prevStats: Record<string, number>;
  deltas: HeroBaseStats;
  showDisablePrompt: boolean;
}

const STAT_NAMES_ORDERED: (keyof HeroBaseStats)[] = [
  "attack",
  "defense",
  "lethality",
  "health",
];

function formatHeroName(name: string | null): string {
  if (!name) return "(none)";
  if (name === "WuMing") return "Wu Ming";
  return name;
}

function formatDelta(v: number): string {
  if (Math.abs(v) < 1e-9) return "0";
  const rounded = Math.round(v * 100) / 100;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded}`;
}

export function StatSyncToastBanner({
  toast,
  onUndo,
  onDismiss,
  onDisable,
  onKeepEnabled,
}: {
  toast: StatSyncToast;
  onUndo: () => void;
  onDismiss: () => void;
  onDisable: () => void;
  onKeepEnabled: () => void;
}) {
  const catLabel =
    toast.cat === "marksman"
      ? "Marksman"
      : toast.cat[0].toUpperCase() + toast.cat.slice(1);
  const sideLabel = toast.which === "attacker" ? "Attacker" : "Defender";
  const deltaBits = STAT_NAMES_ORDERED.map((k) => {
    const v = toast.deltas[k];
    if (Math.abs(v) < 1e-9) return null;
    const short = k[0].toUpperCase();
    return `${formatDelta(v)} ${short}`;
  }).filter(Boolean);

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-3 z-50 rounded px-3 py-2 text-xs shadow-lg sm:left-auto sm:right-5 sm:w-[min(34rem,calc(100vw-2.5rem))]"
      style={{
        border: "1px solid var(--sim-blue)",
        backgroundColor: "var(--sim-toast-bg, rgba(137, 180, 250, 0.12))",
        color: "var(--sim-text)",
        bottom: "calc(11.5rem + env(safe-area-inset-bottom, 0px))",
      }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {toast.showDisablePrompt ? (
          <>
            <span className="font-bold">Stats reverted.</span>
            <span className="opacity-80">
              Disable &ldquo;Update stats on hero change&rdquo; so this
              doesn&rsquo;t happen again?
            </span>
            <span className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={onDisable}
                className="sim-edit-chip px-2 py-1 font-bold"
                style={{ color: "var(--sim-blue)" }}
              >
                Disable sync
              </button>
              <button
                type="button"
                onClick={onKeepEnabled}
                className="sim-edit-chip px-2 py-1"
              >
                Keep enabled
              </button>
            </span>
          </>
        ) : (
          <>
            <span className="font-bold">
              {sideLabel} {catLabel} stats updated
            </span>
            <span className="opacity-80 font-mono">
              {formatHeroName(toast.oldHeroName)} →{" "}
              {formatHeroName(toast.newHeroName)} (
              {deltaBits.join(", ") || "no change"})
            </span>
            <span className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={onUndo}
                className="sim-edit-chip px-2 py-1 font-bold"
                style={{ color: "var(--sim-blue)" }}
              >
                Undo stat change
              </button>
              <button
                type="button"
                onClick={onDismiss}
                className="sim-edit-chip px-2 py-1 opacity-70"
                aria-label="Dismiss"
              >
                ×
              </button>
            </span>
          </>
        )}
      </div>
    </div>
  );
}
