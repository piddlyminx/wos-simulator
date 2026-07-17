"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  snapTroopPercentages,
  troopCountsForPercentages,
  troopPercentagesForCounts,
  type TroopCounts,
  type TroopPercentages,
} from "@/lib/simulate/troop-ratio";

type DragTarget = "infantry-lancer" | "lancer-marksman" | "lancer-segment";

interface DragState {
  pointerId: number;
  target: DragTarget;
  startClientX: number;
  trackWidth: number;
  startPercentages: TroopPercentages;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

function countsKey(counts: TroopCounts): string {
  return `${counts.infantry}:${counts.lancer}:${counts.marksman}`;
}

function formatPercentage(value: number): string {
  const rounded = Math.round(value);
  return `${Math.abs(value - rounded) < 0.05 ? rounded : value.toFixed(1)}%`;
}

export function TroopRatioInput({
  counts,
  onChange,
  label,
  testId,
}: {
  counts: TroopCounts;
  onChange: (counts: TroopCounts) => void;
  label: string;
  testId: string;
}) {
  const totalTroops = counts.infantry + counts.lancer + counts.marksman;
  const infantryCount = counts.infantry;
  const lancerCount = counts.lancer;
  const marksmanCount = counts.marksman;
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const appliedCountsKeyRef = useRef<string | null>(null);
  const [activeTarget, setActiveTarget] = useState<DragTarget | null>(null);
  const [displayPercentages, setDisplayPercentages] = useState<TroopPercentages>(
    () => troopPercentagesForCounts(counts),
  );

  useEffect(() => {
    const currentCounts = {
      infantry: infantryCount,
      lancer: lancerCount,
      marksman: marksmanCount,
    };
    const nextKey = countsKey(currentCounts);
    if (appliedCountsKeyRef.current === nextKey) {
      appliedCountsKeyRef.current = null;
      return;
    }
    appliedCountsKeyRef.current = null;
    setDisplayPercentages(troopPercentagesForCounts(currentCounts));
  }, [infantryCount, lancerCount, marksmanCount]);

  const applyPercentages = (percentages: TroopPercentages) => {
    const snapped = snapTroopPercentages(percentages);
    const nextCounts = troopCountsForPercentages(totalTroops, snapped);
    setDisplayPercentages(snapped);
    appliedCountsKeyRef.current = countsKey(nextCounts);
    onChange(nextCounts);
  };

  const percentagesForTarget = (
    target: DragTarget,
    clientX: number,
    drag: DragState,
  ): TroopPercentages => {
    const [infantry, lancer, marksman] = drag.startPercentages;
    if (target === "infantry-lancer") {
      const delta = Math.round(
        ((clientX - drag.startClientX) / drag.trackWidth) * 100,
      );
      const nextInfantry = clamp(infantry + delta, 0, 100 - marksman);
      return [nextInfantry, 100 - marksman - nextInfantry, marksman];
    }
    if (target === "lancer-marksman") {
      const delta = Math.round(
        ((clientX - drag.startClientX) / drag.trackWidth) * 100,
      );
      const nextLancer = clamp(lancer + delta, 0, 100 - infantry);
      return [infantry, nextLancer, 100 - infantry - nextLancer];
    }

    const delta = Math.round(
      ((clientX - drag.startClientX) / drag.trackWidth) * 100,
    );
    const nextInfantry = clamp(infantry + delta, 0, 100 - lancer);
    return [nextInfantry, lancer, 100 - lancer - nextInfantry];
  };

  const handlePointerDown = (
    event: PointerEvent<HTMLElement>,
    target: DragTarget,
  ) => {
    if (totalTroops <= 0 || !trackRef.current) return;
    const track = trackRef.current.getBoundingClientRect();
    if (track.width <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      target,
      startClientX: event.clientX,
      trackWidth: track.width,
      startPercentages: snapTroopPercentages(displayPercentages),
    };
    setActiveTarget(target);
  };

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    applyPercentages(percentagesForTarget(drag.target, event.clientX, drag));
  };

  const finishPointerDrag = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setActiveTarget(null);
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLElement>,
    target: DragTarget,
  ) => {
    if (totalTroops <= 0) return;
    const direction =
      event.key === "ArrowRight" || event.key === "ArrowUp"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowDown"
          ? -1
          : null;
    if (direction === null && event.key !== "Home" && event.key !== "End") {
      return;
    }
    event.preventDefault();
    const [infantry, lancer, marksman] =
      snapTroopPercentages(displayPercentages);

    if (target === "infantry-lancer") {
      const nextInfantry =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? 100 - marksman
            : clamp(infantry + direction!, 0, 100 - marksman);
      applyPercentages([
        nextInfantry,
        100 - marksman - nextInfantry,
        marksman,
      ]);
      return;
    }

    if (target === "lancer-marksman") {
      const nextLancer =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? 100 - infantry
            : clamp(lancer + direction!, 0, 100 - infantry);
      applyPercentages([infantry, nextLancer, 100 - infantry - nextLancer]);
      return;
    }

    const nextInfantry =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? 100 - lancer
          : clamp(infantry + direction!, 0, 100 - lancer);
    applyPercentages([nextInfantry, lancer, 100 - lancer - nextInfantry]);
  };

  const [infantry, lancer, marksman] = displayPercentages;
  const rightBoundary = infantry + lancer;
  const disabled = totalTroops <= 0;
  const commonPointerProps = {
    onPointerMove: handlePointerMove,
    onPointerUp: finishPointerDrag,
    onPointerCancel: finishPointerDrag,
  };

  return (
    <div
      className="sim-troop-ratio"
      data-testid={testId}
      data-disabled={disabled}
    >
      <div className="sim-troop-ratio-labels" aria-hidden="true">
        <span>Infantry {formatPercentage(infantry)}</span>
        <span>Lancer {formatPercentage(lancer)}</span>
        <span>Marksman {formatPercentage(marksman)}</span>
      </div>
      <div
        ref={trackRef}
        className="sim-troop-ratio-track"
        aria-label={`${label} troop ratio`}
      >
        <span
          className="sim-troop-ratio-fill sim-troop-ratio-fill-infantry"
          style={{ width: `${infantry}%` }}
        />
        <span
          className="sim-troop-ratio-fill sim-troop-ratio-fill-lancer"
          style={{ left: `${infantry}%`, width: `${lancer}%` }}
        />
        <span
          className="sim-troop-ratio-fill sim-troop-ratio-fill-marksman"
          style={{ left: `${rightBoundary}%`, width: `${marksman}%` }}
        />

        <div
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label={`${label} Infantry and Lancer divider`}
          aria-valuemin={0}
          aria-valuemax={Math.round(100 - marksman)}
          aria-valuenow={Math.round(infantry)}
          aria-valuetext={`Infantry ${formatPercentage(infantry)}, Lancer ${formatPercentage(lancer)}`}
          aria-disabled={disabled}
          aria-keyshortcuts="ArrowLeft ArrowRight"
          title="Drag to adjust Infantry and Lancer. Click, then use ←/→ for 1% steps."
          className="sim-troop-ratio-handle"
          data-active={activeTarget === "infantry-lancer"}
          data-testid={`${testId}-infantry-lancer-handle`}
          style={{ left: `${infantry}%` }}
          onPointerDown={(event) =>
            handlePointerDown(event, "infantry-lancer")
          }
          onKeyDown={(event) => handleKeyDown(event, "infantry-lancer")}
          {...commonPointerProps}
        >
          <span />
        </div>

        <div
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label={`${label} Lancer segment; keep Lancer fixed and transfer between Infantry and Marksman`}
          aria-valuemin={0}
          aria-valuemax={Math.round(100 - lancer)}
          aria-valuenow={Math.round(infantry)}
          aria-valuetext={`Infantry ${formatPercentage(infantry)}, Lancer fixed at ${formatPercentage(lancer)}, Marksman ${formatPercentage(marksman)}`}
          aria-disabled={disabled}
          aria-keyshortcuts="ArrowLeft ArrowRight"
          title="Drag to keep Lancer fixed. Click, then use ←/→ to transfer 1% between Infantry and Marksman."
          className="sim-troop-ratio-segment"
          data-active={activeTarget === "lancer-segment"}
          data-testid={`${testId}-lancer-segment`}
          style={{ left: `${infantry}%`, width: `${lancer}%` }}
          onPointerDown={(event) => handlePointerDown(event, "lancer-segment")}
          onKeyDown={(event) => handleKeyDown(event, "lancer-segment")}
          {...commonPointerProps}
        >
          <span className="sim-troop-ratio-grip" aria-hidden="true" />
        </div>

        <div
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label={`${label} Lancer and Marksman divider`}
          aria-valuemin={0}
          aria-valuemax={Math.round(100 - infantry)}
          aria-valuenow={Math.round(lancer)}
          aria-valuetext={`Lancer ${formatPercentage(lancer)}, Marksman ${formatPercentage(marksman)}`}
          aria-disabled={disabled}
          aria-keyshortcuts="ArrowLeft ArrowRight"
          title="Drag to adjust Lancer and Marksman. Click, then use ←/→ for 1% steps."
          className="sim-troop-ratio-handle"
          data-active={activeTarget === "lancer-marksman"}
          data-testid={`${testId}-lancer-marksman-handle`}
          style={{ left: `${rightBoundary}%` }}
          onPointerDown={(event) =>
            handlePointerDown(event, "lancer-marksman")
          }
          onKeyDown={(event) => handleKeyDown(event, "lancer-marksman")}
          {...commonPointerProps}
        >
          <span />
        </div>
      </div>
    </div>
  );
}
