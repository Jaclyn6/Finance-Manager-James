import { describe, expect, it } from "vitest";

import { parseAlternativeMeFngResponse } from "./alternative-me-parse";

/**
 * Network-free tests for the alternative.me Crypto F&G parser.
 * All fixtures are synthetic; no live request required.
 */

describe("parseAlternativeMeFngResponse", () => {
  it("parses a well-formed response and reverses order to chronological ASC", () => {
    // Upstream returns newest-first.
    const body = {
      name: "Fear and Greed Index",
      data: [
        {
          value: "55",
          value_classification: "Greed",
          timestamp: "1745424000", // 2025-04-23 UTC
          time_until_update: "12345",
        },
        {
          value: "48",
          value_classification: "Neutral",
          timestamp: "1745337600", // 2025-04-22 UTC
        },
        {
          value: "32",
          value_classification: "Fear",
          timestamp: "1745251200", // 2025-04-21 UTC
        },
      ],
      metadata: { error: null },
    };
    const result = parseAlternativeMeFngResponse(body);

    expect(result.fetch_status).toBe("success");
    expect(result.observations).toHaveLength(3);
    // Reversed to ascending chronological.
    expect(result.observations.map((o) => o.date)).toEqual([
      "2025-04-21",
      "2025-04-22",
      "2025-04-23",
    ]);
    // Latest is the last element after reversal.
    expect(result.latest).toEqual({
      date: "2025-04-23",
      value: 55,
      classification: "greed",
    });
  });

  it("converts unix-seconds timestamps to YYYY-MM-DD UTC", () => {
    const body = {
      data: [
        {
          // 2025-01-01T00:00:00Z == 1735689600
          value: "50",
          value_classification: "Neutral",
          timestamp: "1735689600",
        },
        {
          // 2024-06-15T12:34:56Z == 1718454896
          value: "20",
          value_classification: "Extreme Fear",
          timestamp: "1718454896",
        },
      ],
    };
    const result = parseAlternativeMeFngResponse(body);

    expect(result.fetch_status).toBe("success");
    expect(result.observations).toEqual([
      { date: "2024-06-15", value: 20, classification: "extreme_fear" },
      { date: "2025-01-01", value: 50, classification: "neutral" },
    ]);
  });

  it("maps all 5 value_classification strings to snake_case", () => {
    const body = {
      data: [
        {
          value: "10",
          value_classification: "Extreme Fear",
          timestamp: "1700000000",
        },
        { value: "30", value_classification: "Fear", timestamp: "1700086400" },
        {
          value: "50",
          value_classification: "Neutral",
          timestamp: "1700172800",
        },
        {
          value: "70",
          value_classification: "Greed",
          timestamp: "1700259200",
        },
        {
          value: "90",
          value_classification: "Extreme Greed",
          timestamp: "1700345600",
        },
      ],
    };
    const result = parseAlternativeMeFngResponse(body);

    expect(result.fetch_status).toBe("success");
    expect(result.observations.map((o) => o.classification)).toEqual([
      "extreme_fear",
      "fear",
      "neutral",
      "greed",
      "extreme_greed",
    ]);
  });

  it("returns partial on empty data[]", () => {
    const result = parseAlternativeMeFngResponse({
      data: [],
      metadata: { error: null },
    });
    expect(result.fetch_status).toBe("partial");
    expect(result.error).toMatch(/no observations/);
    expect(result.observations).toEqual([]);
    expect(result.latest).toBeNull();
  });

  it("skips malformed rows without killing the whole parse", () => {
    const body = {
      data: [
        {
          value: "55",
          value_classification: "Greed",
          timestamp: "1745424000",
        },
        {
          // non-numeric value
          value: "not a number",
          value_classification: "Fear",
          timestamp: "1745337600",
        },
        {
          // missing timestamp
          value: "40",
          value_classification: "Fear",
        },
        {
          // missing value
          value_classification: "Neutral",
          timestamp: "1745251200",
        },
        {
          // value is not a string (doc says string — reject defensively)
          value: 42,
          value_classification: "Neutral",
          timestamp: "1745164800",
        },
        {
          value: "30",
          value_classification: "Fear",
          timestamp: "1745078400", // 2025-04-19T16:00:00Z → "2025-04-19"
        },
      ],
    };
    const result = parseAlternativeMeFngResponse(body);

    expect(result.fetch_status).toBe("success");
    // Only the two well-formed rows survive (chronological ascending).
    expect(result.observations.map((o) => o.date)).toEqual([
      "2025-04-19",
      "2025-04-23",
    ]);
  });

  it("returns error on non-object body (null, string, number, array)", () => {
    expect(parseAlternativeMeFngResponse(null).fetch_status).toBe("error");
    expect(parseAlternativeMeFngResponse("oops").fetch_status).toBe("error");
    expect(parseAlternativeMeFngResponse(42).fetch_status).toBe("error");
    expect(parseAlternativeMeFngResponse([]).fetch_status).toBe("error");
  });

  it("returns error when body is missing the data array", () => {
    const result = parseAlternativeMeFngResponse({
      name: "Fear and Greed Index",
      metadata: { error: "something" },
    });
    expect(result.fetch_status).toBe("error");
    expect(result.error).toMatch(/missing data/);
  });

  it("rejects values outside the 0-100 range", () => {
    const body = {
      data: [
        {
          value: "150",
          value_classification: "Extreme Greed",
          timestamp: "1745424000",
        },
        {
          value: "-5",
          value_classification: "Extreme Fear",
          timestamp: "1745337600",
        },
        {
          value: "50",
          value_classification: "Neutral",
          timestamp: "1745251200",
        },
      ],
    };
    const result = parseAlternativeMeFngResponse(body);

    // Only the in-range row survives.
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0].value).toBe(50);
  });

  it("flags unknown value_classification as partial without crashing", () => {
    const body = {
      data: [
        {
          value: "55",
          value_classification: "Moderately Optimistic", // not in the 5-value enum
          timestamp: "1745424000",
        },
        {
          value: "48",
          value_classification: "Neutral",
          timestamp: "1745337600",
        },
      ],
    };
    const result = parseAlternativeMeFngResponse(body);

    // Good row survived; unknown one was dropped with a partial marker.
    expect(result.fetch_status).toBe("partial");
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0].classification).toBe("neutral");
    expect(result.error).toMatch(/unknown value_classification/i);
  });

  it("sets fetched_at to a parseable ISO string", () => {
    const result = parseAlternativeMeFngResponse({
      data: [
        {
          value: "50",
          value_classification: "Neutral",
          timestamp: "1745424000",
        },
      ],
    });
    expect(() => new Date(result.fetched_at).toISOString()).not.toThrow();
    expect(new Date(result.fetched_at).toString()).not.toBe("Invalid Date");
  });
});
