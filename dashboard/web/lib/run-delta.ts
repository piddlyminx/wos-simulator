export function biasErrorDelta(biasA: number | null, biasB: number | null): number | null {
  if (biasA == null || biasB == null) return null;
  return roundPct(Math.abs(biasB) - Math.abs(biasA));
}

function roundPct(value: number): number {
  return Number(value.toFixed(2));
}
