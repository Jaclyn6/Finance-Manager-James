import { describe, expect, it } from "vitest";

import { computeDateWindow, formatIsoDate, isValidIsoDate } from "./date";

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
