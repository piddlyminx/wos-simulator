import { expect, test } from "@playwright/test";
import {
  estimateCompositionCount,
  recommendedOptimizeStep,
} from "../lib/optimize-ratio";

test.describe("optimize-ratio helpers", () => {
  test("recommended step scales to about thirty buckets across the army total", () => {
    expect(recommendedOptimizeStep(3000)).toBe(100);
    expect(recommendedOptimizeStep(150000)).toBe(5000);
  });

  test("composition count matches simplex grid points for a fixed total", () => {
    expect(estimateCompositionCount(3000, 100)).toBe(496);
    expect(estimateCompositionCount(150000, 5000)).toBe(496);
    expect(estimateCompositionCount(3500, 100)).toBe(666);
  });
});
