export interface OutcomeDistribution {
  samples: readonly number[];
}

export interface OutcomeRange {
  min: number;
  max: number;
}

export interface ParityThresholds {
  p_threshold?: number;
  max_diff_ratio?: number;
  max_diff_ratio_deterministic?: number;
}

export const DEFAULT_STOCHASTIC_P_THRESHOLD = 1 / 250;

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
  stat_type: "deterministic" | "cdf_support";
  stat: number | null;
  p: number | null;
  passes: boolean;
  cdf_rms?: number;
  cdf_p?: number;
  support_value?: number;
  support_mass?: number;
  support_p?: number;
  flag_reason?: "cdf" | "support" | "cdf+support";
}

export function compareOutcomeDistribution(options: {
  candidate: OutcomeDistribution;
  reference: OutcomeDistribution;
  initialTroops: number;
  outcomeRange?: OutcomeRange;
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

  if (options.deterministic) {
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
      stat_type: "deterministic",
      stat: null,
      p: null,
      passes: Math.abs(biasPct) <= deterministicLimit
    };
  }

  const range = normalizeOutcomeRange(options.outcomeRange ?? {
    min: -Math.abs(initialTroops),
    max: Math.abs(initialTroops)
  });
  const comparison = calibratedComparison(candidate.samples, reference.samples, range);
  const threshold = options.thresholds?.p_threshold ?? DEFAULT_STOCHASTIC_P_THRESHOLD;

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
    stat_type: "cdf_support",
    stat: round(-Math.log10(comparison.overallP), 4),
    p: round(comparison.overallP, 6),
    passes: comparison.overallP >= threshold,
    cdf_rms: round(comparison.cdfRms, 6),
    cdf_p: round(comparison.cdfP, 6),
    support_value: comparison.supportValue,
    support_mass: round(comparison.supportMass, 8),
    support_p: round(comparison.supportP, 6),
    flag_reason: comparison.flagReason
  };
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

interface DistributionModel {
  samples: readonly number[];
  range: OutcomeRange;
  cutoffCount: number;
  candidatePairTailSum: number;
  candidateCrossTailSums: readonly number[];
  smoothedMass: ReadonlyMap<number, number>;
}

interface RawGroupMetrics {
  cdfRms: number;
  supportMass: number;
}

interface ObservedGroupMetrics extends RawGroupMetrics {
  supportValue: number;
}

interface CalibratedComparison extends ObservedGroupMetrics {
  cdfP: number;
  supportP: number;
  overallP: number;
  flagReason: "cdf" | "support" | "cdf+support";
}

const COMPONENT_NULL_RESAMPLES = 20_000;
const JOINT_NULL_RESAMPLES = 20_000;
const SUPPORT_KERNEL = [1, 2, 3, 2, 1] as const;
const SUPPORT_RADIUS = 2;
const COMPARISON_EPSILON = 1e-12;

function calibratedComparison(
  candidateSamples: readonly number[],
  referenceSamples: readonly number[],
  range: OutcomeRange
): CalibratedComparison {
  const model = buildDistributionModel(candidateSamples, range);
  const observed = observedGroupMetrics(model, referenceSamples);
  const random = seededRandom(candidateSamples, referenceSamples.length);
  const componentNull = generateNullMetrics(model, referenceSamples.length, COMPONENT_NULL_RESAMPLES, random);
  const sortedCdf = componentNull.map((metrics) => metrics.cdfRms).sort((left, right) => left - right);
  const sortedSupport = componentNull.map((metrics) => metrics.supportMass).sort((left, right) => left - right);
  const cdfP = upperTailEmpiricalP(sortedCdf, observed.cdfRms);
  const supportP = lowerTailEmpiricalP(sortedSupport, observed.supportMass);
  const observedMinP = Math.min(cdfP, supportP);

  let atLeastAsExtreme = 0;
  for (const metrics of generateNullMetrics(model, referenceSamples.length, JOINT_NULL_RESAMPLES, random)) {
    const nullMinP = Math.min(
      upperTailEmpiricalP(sortedCdf, metrics.cdfRms),
      lowerTailEmpiricalP(sortedSupport, metrics.supportMass)
    );
    if (nullMinP <= observedMinP + COMPARISON_EPSILON) atLeastAsExtreme += 1;
  }
  const overallP = (atLeastAsExtreme + 1) / (JOINT_NULL_RESAMPLES + 1);
  const pDifference = Math.abs(cdfP - supportP);
  const flagReason = pDifference <= 1 / (COMPONENT_NULL_RESAMPLES + 1)
    ? "cdf+support"
    : cdfP < supportP ? "cdf" : "support";

  return {
    ...observed,
    supportValue: observed.supportValue,
    cdfP,
    supportP,
    overallP,
    flagReason
  };
}

function buildDistributionModel(samples: readonly number[], range: OutcomeRange): DistributionModel {
  const cutoffCount = range.max - range.min + 1;
  const candidateCrossTailSums = samples.map((sample) => (
    samples.reduce((sum, other) => sum + tailCutoffCount(Math.max(sample, other), range), 0)
  ));
  const candidatePairTailSum = candidateCrossTailSums.reduce((sum, value) => sum + value, 0);
  const kernelMass = new Map<number, number>();

  for (const sample of samples) {
    let retainedWeight = 0;
    for (let offset = -SUPPORT_RADIUS; offset <= SUPPORT_RADIUS; offset += 1) {
      const target = sample + offset;
      if (target >= range.min && target <= range.max) retainedWeight += SUPPORT_KERNEL[offset + SUPPORT_RADIUS]!;
    }
    for (let offset = -SUPPORT_RADIUS; offset <= SUPPORT_RADIUS; offset += 1) {
      const target = sample + offset;
      if (target < range.min || target > range.max) continue;
      const weight = SUPPORT_KERNEL[offset + SUPPORT_RADIUS]! / retainedWeight;
      kernelMass.set(target, (kernelMass.get(target) ?? 0) + weight);
    }
  }

  const smoothedMass = new Map([...kernelMass].map(([value, mass]) => [value, mass / samples.length]));
  return {
    samples,
    range,
    cutoffCount,
    candidatePairTailSum,
    candidateCrossTailSums,
    smoothedMass
  };
}

function observedGroupMetrics(model: DistributionModel, samples: readonly number[]): ObservedGroupMetrics {
  const candidateCrossTailSums = samples.map((sample) => (
    model.samples.reduce((sum, other) => sum + tailCutoffCount(Math.max(sample, other), model.range), 0)
  ));
  let supportValue = samples[0]!;
  let supportMass = model.smoothedMass.get(supportValue) ?? 0;
  for (const sample of samples.slice(1)) {
    const mass = model.smoothedMass.get(sample) ?? 0;
    if (mass < supportMass) {
      supportMass = mass;
      supportValue = sample;
    }
  }
  return {
    cdfRms: cdfRms(model, samples, candidateCrossTailSums),
    supportMass,
    supportValue
  };
}

function generateNullMetrics(
  model: DistributionModel,
  sampleCount: number,
  count: number,
  random: () => number
): RawGroupMetrics[] {
  const metrics: RawGroupMetrics[] = [];
  for (let sampleIndex = 0; sampleIndex < count; sampleIndex += 1) {
    const samples: number[] = [];
    const candidateCrossTailSums: number[] = [];
    let supportMass = Number.POSITIVE_INFINITY;
    for (let draw = 0; draw < sampleCount; draw += 1) {
      const index = Math.floor(random() * model.samples.length);
      samples.push(model.samples[index]!);
      candidateCrossTailSums.push(model.candidateCrossTailSums[index]!);
      supportMass = Math.min(supportMass, leaveOneOutKernelSupportMass(model, index, random));
    }
    metrics.push({ cdfRms: cdfRms(model, samples, candidateCrossTailSums), supportMass });
  }
  return metrics;
}

function leaveOneOutKernelSupportMass(model: DistributionModel, index: number, random: () => number): number {
  const value = model.samples[index]!;
  const range = model.range;
  let retainedWeight = 0;
  for (let offset = -SUPPORT_RADIUS; offset <= SUPPORT_RADIUS; offset += 1) {
    const target = value + offset;
    if (target >= range.min && target <= range.max) retainedWeight += SUPPORT_KERNEL[offset + SUPPORT_RADIUS]!;
  }
  let selectedWeight = random() * retainedWeight;
  for (let offset = -SUPPORT_RADIUS; offset <= SUPPORT_RADIUS; offset += 1) {
    const target = value + offset;
    if (target < range.min || target > range.max) continue;
    const kernelWeight = SUPPORT_KERNEL[offset + SUPPORT_RADIUS]!;
    selectedWeight -= kernelWeight;
    if (selectedWeight < 0) {
      const fullMass = model.smoothedMass.get(target) ?? 0;
      if (model.samples.length < 2) return fullMass;
      const ownContribution = kernelWeight / retainedWeight;
      return Math.max(0, (fullMass * model.samples.length - ownContribution) / (model.samples.length - 1));
    }
  }
  return model.smoothedMass.get(value) ?? 0;
}

function cdfRms(
  model: DistributionModel,
  samples: readonly number[],
  candidateCrossTailSums: readonly number[]
): number {
  let samplePairTailSum = 0;
  for (const left of samples) {
    for (const right of samples) {
      samplePairTailSum += tailCutoffCount(Math.max(left, right), model.range);
    }
  }
  const candidateCount = model.samples.length;
  const sampleCount = samples.length;
  const squared = (
    model.candidatePairTailSum / candidateCount ** 2
    + samplePairTailSum / sampleCount ** 2
    - (2 * candidateCrossTailSums.reduce((sum, value) => sum + value, 0)) / (candidateCount * sampleCount)
  ) / model.cutoffCount;
  return Math.sqrt(Math.max(0, squared));
}

function tailCutoffCount(value: number, range: OutcomeRange): number {
  const firstCutoff = Math.max(range.min, Math.ceil(value));
  return firstCutoff > range.max ? 0 : range.max - firstCutoff + 1;
}

function upperTailEmpiricalP(sortedNull: readonly number[], observed: number): number {
  return (sortedNull.length - lowerBound(sortedNull, observed - COMPARISON_EPSILON) + 1) / (sortedNull.length + 1);
}

function lowerTailEmpiricalP(sortedNull: readonly number[], observed: number): number {
  return (upperBound(sortedNull, observed + COMPARISON_EPSILON) + 1) / (sortedNull.length + 1);
}

function lowerBound(sorted: readonly number[], value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (sorted[middle]! < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function upperBound(sorted: readonly number[], value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (sorted[middle]! <= value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function normalizeOutcomeRange(range: OutcomeRange): OutcomeRange {
  if (!Number.isFinite(range.min) || !Number.isFinite(range.max)) throw new Error("outcome range must be finite");
  const min = Math.ceil(range.min);
  const max = Math.floor(range.max);
  if (min > max) throw new Error("outcome range is empty");
  return { min, max };
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
