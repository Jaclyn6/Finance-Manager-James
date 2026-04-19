import { describe, expect, it } from "vitest";

import { findObservationAsOf, type FredObservation } from "./fred-parse";

describe("findObservationAsOf", () => {
  const series: FredObservation[] = [
    { date: "2026-04-01", value: 10 },
    { date: "2026-04-05", value: 12 },
    { date: "2026-04-10", value: null }, // missing sentinel
    { date: "2026-04-15", value: 15 },
    { date: "2026-04-20", value: 18 },
  ];

  it("returns the exact-match observation when present", () => {
    expect(findObservationAsOf(series, "2026-04-05")).toEqual({
      date: "2026-04-05",
      value: 12,
    });
  });

  it("returns the latest observation strictly <= asOfDate", () => {
    // Apr 7 falls between Apr 5 and Apr 10 → Apr 5 wins.
    expect(findObservationAsOf(series, "2026-04-07")).toEqual({
      date: "2026-04-05",
      value: 12,
    });
  });

  it("skips past null observations to find the most recent real value", () => {
    // Apr 10 has a null sentinel, so asOf=Apr 10 should pull the
    // Apr 5 value rather than "null at Apr 10".
    expect(findObservationAsOf(series, "2026-04-10")).toEqual({
      date: "2026-04-05",
      value: 12,
    });
  });

  it("returns null when asOfDate is before the first observation", () => {
    expect(findObservationAsOf(series, "2026-03-01")).toBeNull();
  });

  it("returns null on empty input", () => {
    expect(findObservationAsOf([], "2026-04-20")).toBeNull();
  });

  it("returns the final observation when asOfDate is in the future", () => {
    expect(findObservationAsOf(series, "2030-01-01")).toEqual({
      date: "2026-04-20",
      value: 18,
    });
  });

  it("returns null when every observation is null (all-missing series)", () => {
    const allNull: FredObservation[] = [
      { date: "2026-04-01", value: null },
      { date: "2026-04-05", value: null },
    ];
    expect(findObservationAsOf(allNull, "2026-04-10")).toBeNull();
  });
});
