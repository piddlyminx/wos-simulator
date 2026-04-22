import { expect, test } from "@playwright/test";
import { splitMatchingInput } from "../lib/check-now";

test.describe("check-now helpers", () => {
  test("splitMatchingInput trims whitespace and comma separators", () => {
    expect(splitMatchingInput(" alonso, solo  norah ")).toEqual([
      "alonso",
      "solo",
      "norah",
    ]);
  });

  test("splitMatchingInput returns an empty list for blank input", () => {
    expect(splitMatchingInput("   ")).toEqual([]);
    expect(splitMatchingInput("")).toEqual([]);
  });
});
