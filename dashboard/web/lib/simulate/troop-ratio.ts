import type { TroopCategory } from "@/lib/heroes-catalogue";

export type TroopCounts = Record<TroopCategory, number>;
export type TroopPercentages = [number, number, number];

const PERCENT_TOTAL = 100;

export function troopPercentagesForCounts(
  counts: TroopCounts,
): TroopPercentages {
  const values = [counts.infantry, counts.lancer, counts.marksman];
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return [0, 0, 0];
  return values.map((value) => (value / total) * PERCENT_TOTAL) as TroopPercentages;
}

export function snapTroopPercentages(
  percentages: TroopPercentages,
): TroopPercentages {
  const safe = percentages.map((value) => Math.max(0, value));
  const total = safe.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return [0, 0, 0];

  const scaled = safe.map((value) => (value / total) * PERCENT_TOTAL);
  const snapped = scaled.map(Math.floor);
  const remainder = PERCENT_TOTAL - snapped.reduce((sum, value) => sum + value, 0);
  const order = scaled
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || b.index - a.index);

  for (let index = 0; index < remainder; index += 1) {
    snapped[order[index].index] += 1;
  }

  return snapped as TroopPercentages;
}

export function troopCountsForPercentages(
  totalTroops: number,
  percentages: TroopPercentages,
): TroopCounts {
  const total = Math.max(0, Math.round(totalTroops));
  if (total === 0) {
    return { infantry: 0, lancer: 0, marksman: 0 };
  }

  const normalized = snapTroopPercentages(percentages);
  const exactCounts = normalized.map(
    (percentage) => (total * percentage) / PERCENT_TOTAL,
  );
  const counts = exactCounts.map(Math.floor);
  const remainder = total - counts.reduce((sum, value) => sum + value, 0);
  const order = exactCounts
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || b.index - a.index);

  for (let index = 0; index < remainder; index += 1) {
    counts[order[index].index] += 1;
  }

  return {
    infantry: counts[0],
    lancer: counts[1],
    marksman: counts[2],
  };
}
