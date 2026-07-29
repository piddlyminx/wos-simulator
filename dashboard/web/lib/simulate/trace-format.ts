export type BattleWinner = "attacker" | "defender" | "draw";

export interface SurvivorCounts {
  attacker: number;
  defender: number;
}

export function formatTraceTroopCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return Math.ceil(value).toLocaleString();
}

export function exactNumberTitle(value: number): string | undefined {
  if (!Number.isFinite(value)) return undefined;
  return `Exact value: ${String(value)}`;
}

export function formatSurvivorCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return Math.round(value).toLocaleString();
}

export function formatMeanSurvivorCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value < 0.1) {
    return value.toLocaleString(undefined, {
      maximumFractionDigits: 3,
      minimumFractionDigits: 3,
    });
  }
  if (value < 1) {
    return value.toLocaleString(undefined, {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    });
  }
  return formatSurvivorCount(value);
}

export function formatBattleOutcome(
  winner: BattleWinner | undefined,
  survivors: SurvivorCounts | undefined,
  fallbackOutcome: number,
): string {
  if (winner === "draw" && survivors) {
    return `draw — attacker ${formatSurvivorCount(
      survivors.attacker,
    )}, defender ${formatSurvivorCount(survivors.defender)}`;
  }
  if (winner === "attacker" && survivors) {
    return `${formatSurvivorCount(survivors.attacker)} (attacker)`;
  }
  if (winner === "defender" && survivors) {
    return `${formatSurvivorCount(survivors.defender)} (defender)`;
  }
  if (fallbackOutcome === 0) return "0 (draw)";
  const fallbackWinner = fallbackOutcome > 0 ? "attacker" : "defender";
  return `${formatSurvivorCount(Math.abs(fallbackOutcome))} (${fallbackWinner})`;
}
