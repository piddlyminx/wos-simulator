// Mean squared bias: variance-around-zero, not variance-around-the-mean.
// A testcase that sits consistently at +2% is wrong by 2% every run — that's
// what the board wants ranked high. Classical variance would rank it at zero
// because it's perfectly stable around its (non-zero) mean.
export function computeDrift(values: (number | null)[]): number {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length === 0) return 0;
  return nums.reduce((sum, v) => sum + v * v, 0) / nums.length;
}
