export interface HistogramBin {
  start: number;
  end: number;
  count: number;
}

export function histogramBins(
  samples: readonly number[],
  domainValues: readonly number[] = [],
  targetBins = 30,
): HistogramBin[] {
  const values = [...samples, ...domainValues];
  if (values.length === 0) return [];

  const minimum = Math.floor(Math.min(...values));
  const maximum = Math.ceil(Math.max(...values));
  const width = niceBinWidth(
    (maximum - minimum + 1) / Math.max(1, Math.floor(targetBins)),
  );
  let start = Math.floor(minimum / width) * width - 0.5;
  let end = Math.ceil((maximum + 1) / width) * width - 0.5;
  if (start === end) {
    start -= width;
    end += width;
  }
  const bins = Array.from(
    { length: Math.max(1, Math.round((end - start) / width)) },
    (_, index) => ({
      start: start + index * width,
      end: start + (index + 1) * width,
      count: 0,
    }),
  );
  for (const sample of samples) {
    const index = Math.min(
      bins.length - 1,
      Math.max(0, Math.floor((sample - start) / width)),
    );
    bins[index]!.count += 1;
  }
  return bins;
}

export function histogramIntegerTicks(
  bins: readonly HistogramBin[],
  maximumTicks = 6,
): number[] {
  if (bins.length === 0) return [];
  const minimum = Math.ceil(bins[0]!.start);
  const maximum = Math.floor(bins.at(-1)!.end);
  const integerCount = maximum - minimum + 1;
  const tickCount = Math.min(
    Math.max(2, Math.floor(maximumTicks)),
    integerCount,
  );
  if (tickCount === 1) return [minimum];
  return Array.from({ length: tickCount }, (_, index) =>
    Math.round(minimum + ((maximum - minimum) * index) / (tickCount - 1)),
  );
}

function niceBinWidth(rawWidth: number): number {
  if (rawWidth <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rawWidth));
  const normalized = rawWidth / magnitude;
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return multiplier * magnitude;
}
