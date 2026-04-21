import { test, expect } from '@playwright/test';
import { computeDrift } from '../lib/drift';

// WOS-189 follow-up: ranking metric swapped from variance-around-mean to
// variance-around-zero (mean squared bias). A testcase sitting at a constant
// non-zero bias is what the board cares about — the simulator is wrong by
// that amount every run. A low-magnitude wobble around zero is noise.
//
// These assertions pin the behaviour so nobody "fixes" it back to textbook
// statistical variance later.
test.describe('computeDrift (WOS-189)', () => {
  test('constant +2% series outranks a ±0.5% wobble around zero', () => {
    const constantBias = new Array(12).fill(2);
    const wobble = [0.5, -0.5, 0.5, -0.5, 0.5, -0.5, 0.5, -0.5, 0.5, -0.5, 0.5, -0.5];
    expect(computeDrift(constantBias)).toBeGreaterThan(computeDrift(wobble));
  });

  test('large-magnitude wobble still outranks small-magnitude wobble', () => {
    const loud = [3, -3, 3, -3, 3, -3];
    const quiet = [0.5, -0.5, 0.5, -0.5, 0.5, -0.5];
    expect(computeDrift(loud)).toBeGreaterThan(computeDrift(quiet));
  });

  test('nulls are skipped and do not count toward the denominator', () => {
    const withNulls: (number | null)[] = [2, null, 2, null, 2];
    const dense = [2, 2, 2];
    expect(computeDrift(withNulls)).toBeCloseTo(computeDrift(dense), 10);
  });

  test('all-null series returns zero without throwing', () => {
    expect(computeDrift([null, null, null])).toBe(0);
  });

  test('exact value equals mean squared bias', () => {
    // MSE of [2, 2, 2] = (4+4+4)/3 = 4.
    expect(computeDrift([2, 2, 2])).toBeCloseTo(4, 10);
    // MSE of [1, -1] = (1+1)/2 = 1.
    expect(computeDrift([1, -1])).toBeCloseTo(1, 10);
  });
});
