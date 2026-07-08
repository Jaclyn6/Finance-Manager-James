import { describe, expect, it } from "vitest";

import { compareVersionsNumeric } from "./version-compare";

describe("compareVersionsNumeric", () => {
  it("orders double-digit components numerically (the lexicographic trap)", () => {
    expect(compareVersionsNumeric("adv-1.1.9", "adv-1.1.10")).toBeLessThan(0);
    expect(compareVersionsNumeric("v2.9.0", "v2.10.0")).toBeLessThan(0);
    expect(compareVersionsNumeric("v2.10.0", "v2.9.0")).toBeGreaterThan(0);
  });

  it("equal strings compare 0", () => {
    expect(compareVersionsNumeric("adv-1.1.0", "adv-1.1.0")).toBe(0);
  });

  it("shorter prefix counts as older", () => {
    expect(compareVersionsNumeric("v2", "v2.1")).toBeLessThan(0);
  });

  it("prefix differences fall back to lexicographic", () => {
    expect(compareVersionsNumeric("adv-1.0.0", "v1.0.0")).toBeLessThan(0);
  });

  it("sorts a realistic version list correctly", () => {
    const versions = ["adv-1.10.0", "adv-1.2.0", "adv-1.1.10", "adv-1.1.9"];
    versions.sort(compareVersionsNumeric);
    expect(versions).toEqual([
      "adv-1.1.9",
      "adv-1.1.10",
      "adv-1.2.0",
      "adv-1.10.0",
    ]);
  });
});
