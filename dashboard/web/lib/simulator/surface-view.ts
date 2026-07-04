import type { SurfacePoint } from "@/lib/simulator/surface";

export type SurfaceProgressState = { done: number; total: number } | null;

function meanRow(matrix: number[], rowIdx: number, size: number): number {
  let sum = 0;
  for (let j = 0; j < size; j++) sum += matrix[rowIdx * size + j];
  return sum / size;
}

function meanCol(matrix: number[], colIdx: number, size: number): number {
  let sum = 0;
  for (let i = 0; i < size; i++) sum += matrix[i * size + colIdx];
  return sum / size;
}

export function surfacePointLabel(
  point: SurfacePoint | undefined,
  total: number,
): string {
  if (!point) return "selected composition";
  const denom = Math.max(1, total);
  const inf = Math.round((point.inf / denom) * 100);
  const lanc = Math.round((point.lanc / denom) * 100);
  const mark = Math.round((point.mark / denom) * 100);
  return `${inf}i / ${lanc}l / ${mark}m`;
}

export function attackerSurfaceValues(
  matrix: number[],
  size: number,
  activeDefIdx: number | null,
): number[] {
  if (activeDefIdx !== null) {
    return Array.from({ length: size }, (_, i) => matrix[i * size + activeDefIdx]);
  }
  return Array.from({ length: size }, (_, i) => meanRow(matrix, i, size));
}

export function defenderSurfaceValues(
  matrix: number[],
  size: number,
  activeAttIdx: number | null,
): number[] {
  if (activeAttIdx !== null) {
    return Array.from({ length: size }, (_, j) => matrix[activeAttIdx * size + j]);
  }
  return Array.from({ length: size }, (_, j) => meanCol(matrix, j, size));
}

export function nextProgressState(
  prev: SurfaceProgressState,
  done: number,
  total: number,
): SurfaceProgressState {
  if (!prev) return { done, total };
  if (prev.done === done && prev.total === total) return prev;
  if (prev.total !== total || done <= 0 || done >= total) return { done, total };
  const prevPct = Math.floor((prev.done / Math.max(1, prev.total)) * 100);
  const nextPct = Math.floor((done / Math.max(1, total)) * 100);
  return prevPct === nextPct ? prev : { done, total };
}

export function nextNullableNumberState(
  prev: number | null,
  next: number | null,
): number | null {
  return prev === next ? prev : next;
}
