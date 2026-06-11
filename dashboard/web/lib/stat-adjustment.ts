export function formatStatAdjustment(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

export function statAdjustmentTitle(
  value: number | null | undefined,
  mode: string | null | undefined,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "No stat rounding correction applied";
  }
  const direction =
    value > 0
      ? "attacker stats increased, defender stats decreased"
      : value < 0
        ? "attacker stats decreased, defender stats increased"
        : "no net stat direction";
  return `${formatStatAdjustment(value)} (${mode ?? "unknown mode"}): ${direction}`;
}
