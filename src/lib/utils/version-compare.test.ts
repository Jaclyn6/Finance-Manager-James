import { describe, expect, it } from "vitest";

import {
  compareVersionsNumeric,
  pickLatestByDateThenVersion,
} from "./version-compare";

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

describe("pickLatestByDateThenVersion", () => {
  it("newest observed_at wins regardless of row order", () => {
    const best = pickLatestByDateThenVersion([
      { observed_at: "2026-07-01", model_version: "v2.0.0", v: 1 },
      { observed_at: "2026-08-01", model_version: "v2.0.0", v: 2 },
      { observed_at: "2026-07-15", model_version: "v2.0.0", v: 3 },
    ]);
    expect(best?.v).toBe(2);
  });

  it("same-date cutover rows resolve by NUMERIC version (v2.10 > v2.9)", () => {
    const best = pickLatestByDateThenVersion([
      { observed_at: "2026-08-01", model_version: "v2.9.0", v: 1 },
      { observed_at: "2026-08-01", model_version: "v2.10.0", v: 2 },
    ]);
    expect(best?.v).toBe(2);
  });

  it("timestamps and plain dates compare on the calendar day", () => {
    const best = pickLatestByDateThenVersion([
      { observed_at: "2026-08-01T23:00:00Z", model_version: "v2.0.0", v: 1 },
      { observed_at: "2026-08-01", model_version: "v2.1.0", v: 2 },
    ]);
    expect(best?.v).toBe(2);
  });

  it("empty input → null", () => {
    expect(pickLatestByDateThenVersion([])).toBeNull();
  });
});
