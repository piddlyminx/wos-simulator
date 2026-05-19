export interface OutcomeDistribution {
  n: number;
  mu: number;
  sigma: number;
}

export interface ParityThresholds {
  z_threshold?: number;
  min_bias_pct?: number;
  max_diff_ratio?: number;
  max_diff_ratio_deterministic?: number;
}

export interface ParityComparisonMetrics {
  n_candidate: number;
  mu_candidate: number;
  sigma_candidate: number;
  n_reference: number;
  mu_reference: number;
  sigma_reference: number;
  bias_raw: number;
  bias_pct: number;
  sem: number;
  stat_type: "deterministic" | "zero_var" | "single_obs" | "t";
  stat: number | null;
  p: number | null;
  q: number | null;
  passes: boolean;
}

export function compareOutcomeDistribution(options: {
  candidate: OutcomeDistribution;
  reference: OutcomeDistribution;
  initialTroops: number;
  deterministic: boolean;
  thresholds?: ParityThresholds;
}): ParityComparisonMetrics {
  const thresholds = options.thresholds ?? {};
  const initialTroops = options.initialTroops || 1;
  const biasRaw = round(options.candidate.mu - options.reference.mu, 2);
  const biasPct = round((biasRaw / initialTroops) * 100, 2);
  const zThreshold = thresholds.z_threshold ?? 2;
  const minBiasPct = thresholds.min_bias_pct ?? 0.5;
  const deterministicLimit = (thresholds.max_diff_ratio_deterministic ?? thresholds.max_diff_ratio ?? 0.01) * 100;

  let sem = 0;
  let stat: number | null = null;
  let p: number | null = null;
  let statType: ParityComparisonMetrics["stat_type"];
  let passes: boolean;

  if (options.deterministic) {
    statType = "deterministic";
    passes = Math.abs(biasPct) <= deterministicLimit;
  } else if (options.candidate.sigma === 0) {
    statType = "zero_var";
    passes = Math.abs(biasPct) <= deterministicLimit;
  } else if (options.reference.n <= 1) {
    statType = "single_obs";
    sem = round(options.candidate.sigma, 2);
    passes = true;
  } else {
    statType = "t";
    sem = options.candidate.sigma * Math.sqrt(1 / Math.max(options.candidate.n, 1) + 1 / options.reference.n);
    stat = sem === 0 ? null : round(biasRaw / sem, 4);
    p = stat === null ? null : round(2 * (1 - normalCdf(Math.abs(stat))), 6);
    passes = stat === null || Math.abs(stat) <= zThreshold || Math.abs(biasPct) <= minBiasPct;
  }

  return {
    n_candidate: options.candidate.n,
    mu_candidate: round(options.candidate.mu, 2),
    sigma_candidate: round(options.candidate.sigma, 2),
    n_reference: options.reference.n,
    mu_reference: round(options.reference.mu, 2),
    sigma_reference: round(options.reference.sigma, 2),
    bias_raw: biasRaw,
    bias_pct: biasPct,
    sem: round(sem, 2),
    stat_type: statType,
    stat,
    p,
    q: null,
    passes
  };
}

export function applyBenjaminiHochberg(rows: Array<{ p: number | null; q: number | null }>): void {
  const ranked = rows
    .filter((row): row is { p: number; q: number | null } => row.p !== null)
    .sort((a, b) => a.p - b.p);
  const m = ranked.length;
  let runningMin = 1;
  for (let index = m - 1; index >= 0; index -= 1) {
    const rawQ = (ranked[index].p * m) / (index + 1);
    runningMin = Math.min(runningMin, rawQ);
    ranked[index].q = round(Math.min(1, runningMin), 6);
  }
}

function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return sign * y;
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}
