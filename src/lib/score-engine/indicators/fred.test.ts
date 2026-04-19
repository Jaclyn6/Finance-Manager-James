import { describe, expect, it } from "vitest";

import { parseFredResponse } from "./fred";

/**
 * Network-free tests for the FRED response parser. The outer fetch
 * wrapper is not tested here (needs a live key); we instead feed
 * synthetic payloads through the pure parser and verify the shape
 * of `FredFetchResult` for each.
 */

describe("parseFredResponse", () => {
  it("parses a well-formed response", () => {
    const body = {
      observations: [
        { date: "2025-01-01", value: "1.0" },
        { date: "2025-02-01", value: "2.5" },
        { date: "2025-03-01", value: "3.1" },
      ],
    };
    const result = parseFredResponse("TEST", body);

    expect(result.series_id).toBe("TEST");
    expect(result.fetch_status).toBe("success");
    expect(result.observations).toHaveLength(3);
    expect(result.latest).toEqual({ date: "2025-03-01", value: 3.1 });
    expect(result.window).toEqual([1.0, 2.5]);
  });

  it("treats '.' values as null but keeps the observation slot", () => {
    const body = {
      observations: [
        { date: "2025-01-01", value: "1.0" },
        { date: "2025-02-01", value: "." }, // missing
        { date: "2025-03-01", value: "3.0" },
      ],
    };
    const result = parseFredResponse("TEST", body);

    expect(result.fetch_status).toBe("success");
    expect(result.observations).toHaveLength(3);
    expect(result.observations[1].value).toBeNull();
    // Latest is the most recent non-null, and the null from Feb drops
    // out of the window entirely.
    expect(result.latest).toEqual({ date: "2025-03-01", value: 3.0 });
    expect(result.window).toEqual([1.0]);
  });

  it("picks the latest non-null when the most recent row is missing", () => {
    const body = {
      observations: [
        { date: "2025-01-01", value: "1.0" },
        { date: "2025-02-01", value: "2.0" },
        { date: "2025-03-01", value: "." }, // most recent, null
      ],
    };
    const result = parseFredResponse("TEST", body);

    expect(result.latest).toEqual({ date: "2025-02-01", value: 2.0 });
    // Window is everything before latest that's non-null.
    expect(result.window).toEqual([1.0]);
  });

  it("reports partial when all values are '.'", () => {
    const body = {
      observations: [
        { date: "2025-01-01", value: "." },
        { date: "2025-02-01", value: "." },
      ],
    };
    const result = parseFredResponse("TEST", body);

    expect(result.fetch_status).toBe("partial");
    expect(result.latest).toBeNull();
    expect(result.window).toEqual([]);
    expect(result.error).toMatch(/all observations are missing/);
  });

  it("reports partial when observations[] is empty", () => {
    const result = parseFredResponse("TEST", { observations: [] });
    expect(result.fetch_status).toBe("partial");
    expect(result.error).toMatch(/no observations after parsing/);
  });

  it("skips malformed rows without failing the whole parse", () => {
    const body = {
      observations: [
        { date: "2025-01-01", value: "1.0" },
        { date: "2025-02-01", value: "not a number" },
        { date: "bad-date-ignored-too", value: "3.0" }, // date is a string, kept (parser doesn't validate format)
        { noDate: true, value: "5.0" },
        { date: "2025-03-01", value: "3.5" },
      ],
    };
    const result = parseFredResponse("TEST", body);

    // "not a number" drops; "noDate" drops; "bad-date-ignored-too" kept
    // (parser accepts any string date — downstream DB cast would fail;
    // in practice FRED never returns invalid dates).
    expect(result.observations.map((o) => o.date)).toEqual([
      "2025-01-01",
      "bad-date-ignored-too",
      "2025-03-01",
    ]);
    expect(result.fetch_status).toBe("success");
    expect(result.latest?.date).toBe("2025-03-01");
  });

  it("returns error on non-object body", () => {
    expect(parseFredResponse("TEST", null).fetch_status).toBe("error");
    expect(parseFredResponse("TEST", "a string").fetch_status).toBe("error");
    expect(parseFredResponse("TEST", 42).fetch_status).toBe("error");
  });

  it("returns error on body missing observations array", () => {
    const result = parseFredResponse("TEST", { error_message: "rate limit" });
    expect(result.fetch_status).toBe("error");
    expect(result.error).toMatch(/missing observations/);
  });

  it("sets fetched_at to a parseable ISO string", () => {
    const result = parseFredResponse("TEST", {
      observations: [{ date: "2025-01-01", value: "1.0" }],
    });
    expect(() => new Date(result.fetched_at).toISOString()).not.toThrow();
    expect(new Date(result.fetched_at).toString()).not.toBe("Invalid Date");
  });
});
