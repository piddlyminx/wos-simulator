export interface OutcomeDistribution {
  samples: readonly number[];
}

export interface ParityThresholds {
  p_threshold?: number;
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
  stat_type: "deterministic" | "surprisal";
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
  const candidate = summarize(options.candidate.samples, "candidate");
  const reference = summarize(options.reference.samples, "reference");
  const initialTroops = options.initialTroops || 1;
  const biasRaw = round(candidate.mu - reference.mu, 2);
  const biasPct = round((biasRaw / initialTroops) * 100, 2);
  const deterministicLimit = (
    options.thresholds?.max_diff_ratio_deterministic
    ?? options.thresholds?.max_diff_ratio
    ?? 0.01
  ) * 100;

  let statType: ParityComparisonMetrics["stat_type"] = "deterministic";
  let stat: number | null = null;
  let p: number | null = null;
  let passes = Math.abs(biasPct) <= deterministicLimit;

  if (!options.deterministic) {
    statType = "surprisal";
    const model = fitPredictiveDensity(candidate.samples);
    const rawStat = totalSurprisal(reference.samples, model);
    const rawP = empiricalNullP(model.nullSurprisals, reference.n, rawStat, candidate.samples);
    stat = round(rawStat, 4);
    p = round(rawP, 6);
    passes = rawP >= (options.thresholds?.p_threshold ?? 0.05);
  }

  return {
    n_candidate: candidate.n,
    mu_candidate: round(candidate.mu, 2),
    sigma_candidate: round(candidate.sigma, 2),
    n_reference: reference.n,
    mu_reference: round(reference.mu, 2),
    sigma_reference: round(reference.sigma, 2),
    bias_raw: biasRaw,
    bias_pct: biasPct,
    sem: round(candidate.sigma / Math.sqrt(candidate.n), 2),
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

function summarize(samples: readonly number[], label: string): {
  samples: readonly number[];
  n: number;
  mu: number;
  sigma: number;
} {
  if (samples.length === 0) throw new Error(`${label} distribution has no samples`);
  if (samples.some((value) => !Number.isFinite(value))) throw new Error(`${label} distribution contains a non-finite sample`);
  const mu = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const variance = samples.length > 1
    ? samples.reduce((sum, value) => sum + (value - mu) ** 2, 0) / (samples.length - 1)
    : 0;
  return { samples, n: samples.length, mu, sigma: Math.sqrt(variance) };
}

interface PredictiveDensity {
  samples: readonly number[];
  bandwidth: number;
  nullSurprisals: readonly number[];
}

const MIN_BANDWIDTH = 0.5;
const BANDWIDTH_CANDIDATES = 25;
const MAX_BANDWIDTH_SAMPLES = 200;
const NULL_RESAMPLES = 100_000;
const MAX_SURPRISAL = -Math.log(Number.MIN_VALUE);
const LOG_SQRT_TWO_PI = 0.5 * Math.log(2 * Math.PI);

function fitPredictiveDensity(samples: readonly number[]): PredictiveDensity {
  const bandwidth = selectBandwidth(samples);
  const nullSurprisals = samples.length === 1
    ? [surprisal(samples[0]!, samples, bandwidth)]
    : samples.map((value, index) => surprisal(value, samples, bandwidth, index));
  return { samples, bandwidth, nullSurprisals };
}

function selectBandwidth(samples: readonly number[]): number {
  const bandwidthSamples = samples.slice(0, MAX_BANDWIDTH_SAMPLES);
  if (bandwidthSamples.length < 2) return MIN_BANDWIDTH;
  const sorted = [...bandwidthSamples].sort((left, right) => left - right);
  const sigma = summarize(bandwidthSamples, "candidate").sigma;
  const span = sorted[sorted.length - 1]! - sorted[0]!;
  const maxBandwidth = Math.max(MIN_BANDWIDTH, sigma * 2, span / 4);
  if (maxBandwidth === MIN_BANDWIDTH) return MIN_BANDWIDTH;

  let bestBandwidth = MIN_BANDWIDTH;
  let bestLogLikelihood = Number.NEGATIVE_INFINITY;
  const ratio = (maxBandwidth / MIN_BANDWIDTH) ** (1 / (BANDWIDTH_CANDIDATES - 1));
  for (let index = 0; index < BANDWIDTH_CANDIDATES; index += 1) {
    const bandwidth = MIN_BANDWIDTH * ratio ** index;
    const logLikelihood = bandwidthSamples.reduce(
      (sum, value, sampleIndex) => sum + logDensity(value, bandwidthSamples, bandwidth, sampleIndex),
      0
    );
    if (logLikelihood > bestLogLikelihood) {
      bestLogLikelihood = logLikelihood;
      bestBandwidth = bandwidth;
    }
  }
  return bestBandwidth;
}

function totalSurprisal(samples: readonly number[], model: PredictiveDensity): number {
  return samples.reduce(
    (sum, value) => sum + surprisal(value, model.samples, model.bandwidth),
    0
  );
}

function surprisal(
  value: number,
  samples: readonly number[],
  bandwidth: number,
  excludedIndex?: number
): number {
  return Math.min(MAX_SURPRISAL, Math.max(0, -logDensity(value, samples, bandwidth, excludedIndex)));
}

function logDensity(
  value: number,
  samples: readonly number[],
  bandwidth: number,
  excludedIndex?: number
): number {
  let maximum = Number.NEGATIVE_INFINITY;
  const terms = samples.map((sample, index) => {
    if (index === excludedIndex) return Number.NEGATIVE_INFINITY;
    const standardized = (value - sample) / bandwidth;
    const term = -0.5 * standardized * standardized;
    maximum = Math.max(maximum, term);
    return term;
  });
  const count = samples.length - (excludedIndex === undefined ? 0 : 1);
  if (count <= 0) return Number.NEGATIVE_INFINITY;
  const scaledSum = terms.reduce(
    (sum, term) => term === Number.NEGATIVE_INFINITY ? sum : sum + Math.exp(term - maximum),
    0
  );
  return maximum + Math.log(scaledSum) - Math.log(count) - Math.log(bandwidth) - LOG_SQRT_TWO_PI;
}

function empiricalNullP(
  singleDrawSurprisals: readonly number[],
  referenceN: number,
  observedSurprisal: number,
  seedSamples: readonly number[]
): number {
  const random = seededRandom(seedSamples, referenceN);
  let atLeastAsSurprising = 0;
  for (let sampleIndex = 0; sampleIndex < NULL_RESAMPLES; sampleIndex += 1) {
    let nullSurprisal = 0;
    for (let draw = 0; draw < referenceN; draw += 1) {
      nullSurprisal += singleDrawSurprisals[Math.floor(random() * singleDrawSurprisals.length)]!;
    }
    if (nullSurprisal >= observedSurprisal - 1e-12) atLeastAsSurprising += 1;
  }
  return (atLeastAsSurprising + 1) / (NULL_RESAMPLES + 1);
}

function seededRandom(samples: readonly number[], referenceN: number): () => number {
  let state = (0x811c9dc5 ^ referenceN) >>> 0;
  for (const sample of samples) {
    const integer = Math.round(sample * 1000);
    state = Math.imul(state ^ integer, 0x01000193) >>> 0;
    state = Math.imul(state ^ Math.floor(integer / 0x1_0000_0000), 0x01000193) >>> 0;
  }
  if (state === 0) state = 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}
