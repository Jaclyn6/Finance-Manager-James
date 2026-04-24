import { describe, expect, it } from "vitest";

import {
  HISTORY_WINDOW_DAYS,
  PROJECT_EPOCH,
  computeDateWindow,
  computePickerFloor,
  formatIsoDate,
  isValidIsoDate,
  sanitizeDateParam,
} from "./date";

describe("isValidIsoDate", () => {
  it("accepts well-formed calendar dates", () => {
    expect(isValidIsoDate("2026-04-19")).toBe(true);
    expect(isValidIsoDate("2020-02-29")).toBe(true); // leap year
    expect(isValidIsoDate("1999-12-31")).toBe(true);
  });

  it("rejects malformed shapes", () => {
    expect(isValidIsoDate("")).toBe(false);
    expect(isValidIsoDate("2026-4-19")).toBe(false); // month not zero-padded
    expect(isValidIsoDate("2026/04/19")).toBe(false); // wrong separator
    expect(isValidIsoDate("2026-04-19T00:00:00Z")).toBe(false); // timestamp
    expect(isValidIsoDate("yesterday")).toBe(false);
  });

  it("rejects impossible dates (round-trip mismatch)", () => {
    // JS coerces 02-30 to 03-02; the round-trip check catches that.
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false); // month 13
    expect(isValidIsoDate("2026-04-32")).toBe(false); // day 32
    // 2023 is not a leap year, so Feb 29 must reject.
    expect(isValidIsoDate("2023-02-29")).toBe(false);
  });
});

describe("formatIsoDate", () => {
  it("produces YYYY-MM-DD from UTC components", () => {
    expect(formatIsoDate(new Date("2026-04-19T00:00:00Z"))).toBe("2026-04-19");
    expect(formatIsoDate(new Date("2026-04-19T23:59:59Z"))).toBe("2026-04-19");
  });
});

describe("computeDateWindow", () => {
  it("returns a symmetric ±windowDays range", () => {
    expect(computeDateWindow("2026-04-19", 14)).toEqual({
      start: "2026-04-05",
      end: "2026-05-03",
    });
  });

  it("handles month boundaries correctly", () => {
    expect(computeDateWindow("2026-04-01", 5)).toEqual({
      start: "2026-03-27",
      end: "2026-04-06",
    });
  });

  it("handles year boundaries correctly", () => {
    expect(computeDateWindow("2026-01-01", 3)).toEqual({
      start: "2025-12-29",
      end: "2026-01-04",
    });
  });

  it("treats window = 0 as the anchor alone", () => {
    expect(computeDateWindow("2026-04-19", 0)).toEqual({
      start: "2026-04-19",
      end: "2026-04-19",
    });
  });

  it("falls back to anchor-only for invalid input", () => {
    // Bad anchor string — downstream query should return empty rather
    // than spanning the whole table.
    expect(computeDateWindow("not-a-date", 14)).toEqual({
      start: "not-a-date",
      end: "not-a-date",
    });
    // Negative window is treated as invalid.
    expect(computeDateWindow("2026-04-19", -1)).toEqual({
      start: "2026-04-19",
      end: "2026-04-19",
    });
    // NaN window likewise.
    expect(computeDateWindow("2026-04-19", Number.NaN)).toEqual({
      start: "2026-04-19",
      end: "2026-04-19",
    });
  });
});

describe("computePickerFloor", () => {
  it("uses HISTORY_WINDOW_DAYS (180) when the rolling window is after PROJECT_EPOCH", () => {
    // 2027-06-30 − 180d = 2027-01-01, well after the 2026-01-01 epoch.
    expect(computePickerFloor("2027-06-30")).toBe("2027-01-01");
    // Sanity: constant is 180 and kept in sync with the computation.
    expect(HISTORY_WINDOW_DAYS).toBe(180);
  });

  it("clamps to PROJECT_EPOCH when the rolling window reaches back past it", () => {
    // 2026-04-24 − 180d = 2025-10-26, before 2026-01-01. Must clamp.
    expect(computePickerFloor("2026-04-24")).toBe(PROJECT_EPOCH);
  });

  it("returns PROJECT_EPOCH for the epoch itself", () => {
    // today == epoch ⇒ rolling floor = epoch − 180d, clamp back to epoch.
    expect(computePickerFloor(PROJECT_EPOCH)).toBe(PROJECT_EPOCH);
  });

  it("falls back to PROJECT_EPOCH for invalid input", () => {
    expect(computePickerFloor("not-a-date")).toBe(PROJECT_EPOCH);
    expect(computePickerFloor("")).toBe(PROJECT_EPOCH);
  });
});

describe("sanitizeDateParam", () => {
  const TODAY = "2026-04-20";

  it("returns the date when valid and in-range", () => {
    expect(sanitizeDateParam("2026-04-19", TODAY)).toBe("2026-04-19");
    expect(sanitizeDateParam(PROJECT_EPOCH, TODAY)).toBe(PROJECT_EPOCH);
    expect(sanitizeDateParam(TODAY, TODAY)).toBe(TODAY);
  });

  it("collapses undefined / arrays / non-strings to null", () => {
    expect(sanitizeDateParam(undefined, TODAY)).toBeNull();
    // Duplicated query params come through as a string[].
    expect(sanitizeDateParam(["a", "b"], TODAY)).toBeNull();
  });

  it("collapses malformed strings to null", () => {
    expect(sanitizeDateParam("", TODAY)).toBeNull();
    expect(sanitizeDateParam("2026/04/19", TODAY)).toBeNull();
    expect(sanitizeDateParam("tomorrow", TODAY)).toBeNull();
    // Impossible calendar dates (round-trip reject).
    expect(sanitizeDateParam("2026-02-30", TODAY)).toBeNull();
  });

  it("collapses out-of-range dates to null", () => {
    // Before PROJECT_EPOCH (2026-01-01).
    expect(sanitizeDateParam("2025-12-31", TODAY)).toBeNull();
    // After today.
    expect(sanitizeDateParam("2026-04-21", TODAY)).toBeNull();
  });
});
