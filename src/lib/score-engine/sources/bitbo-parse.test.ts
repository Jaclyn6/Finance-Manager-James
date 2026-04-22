import { describe, expect, it } from "vitest";

import { parseBitboResponse } from "./bitbo-parse";

/**
 * Network-free tests for the Bitbo response parser. Synthetic payloads
 * exercise the pure parser; the live upstream shape must be verified
 * at Step 7 cron implementation (see parser file header).
 */

describe("parseBitboResponse", () => {
  it("parses a well-formed MVRV Z-Score response", () => {
    const body = {
      metric: "mvrv-z-score",
      data: [
        { date: "2026-04-20", value: 1.2 },
        { date: "2026-04-21", value: 1.35 },
        { date: "2026-04-22", value: 1.45 },
      ],
    };

    const result = parseBitboResponse("mvrv-z-score", body);

    expect(result.metric).toBe("mvrv-z-score");
    expect(result.fetch_status).toBe("success");
    expect(result.observations).toHaveLength(3);
    expect(result.latest).toEqual({ date: "2026-04-22", value: 1.45 });
  });

  it("parses a well-formed SOPR response", () => {
    const body = {
      metric: "sopr",
      data: [
        { date: "2026-04-21", value: 0.98 },
        { date: "2026-04-22", value: 1.01 },
      ],
    };

    const result = parseBitboResponse("sopr", body);

    expect(result.metric).toBe("sopr");
    expect(result.fetch_status).toBe("success");
    expect(result.latest).toEqual({ date: "2026-04-22", value: 1.01 });
  });

  it("returns partial when data[] is empty", () => {
    const result = parseBitboResponse("mvrv-z-score", {
      metric: "mvrv-z-score",
      data: [],
    });

    expect(result.fetch_status).toBe("partial");
    expect(result.observations).toHaveLength(0);
    expect(result.latest).toBeNull();
    expect(result.error).toMatch(/no observations after parsing/);
  });

  it("rejects non-YYYY-MM-DD dates", () => {
    // Postgres DATE safety — off-format strings would crash the whole
    // batch upsert with `invalid input syntax for type date`.
    const body = {
      metric: "sopr",
      data: [
        { date: "2026/04/22", value: 1.0 }, // wrong separator
        { date: "20260422", value: 1.0 }, // no separators
        { date: "2026-4-22", value: 1.0 }, // not zero-padded
        { date: "", value: 1.0 }, // empty
        { date: "2026-04-22T00:00:00Z", value: 1.0 }, // timestamp
      ],
    };
    const result = parseBitboResponse("sopr", body);

    expect(result.observations).toHaveLength(0);
    expect(result.fetch_status).toBe("partial");
  });

  it("skips malformed entries (non-number value) without killing the parse", () => {
    const body = {
      metric: "mvrv-z-score",
      data: [
        { date: "2026-04-20", value: 1.2 },
        { date: "2026-04-21", value: "1.35" }, // string, not number
        { date: "2026-04-22", value: null }, // null
        { date: "2026-04-23", value: Number.NaN }, // NaN
        { date: "2026-04-24", value: 1.6 },
      ],
    };
    const result = parseBitboResponse("mvrv-z-score", body);

    expect(result.fetch_status).toBe("success");
    expect(result.observations).toHaveLength(2);
    expect(result.observations.map((o) => o.date)).toEqual([
      "2026-04-20",
      "2026-04-24",
    ]);
  });

  it("returns error on non-object body", () => {
    expect(parseBitboResponse("sopr", null).fetch_status).toBe("error");
    expect(parseBitboResponse("sopr", "string").fetch_status).toBe("error");
    expect(parseBitboResponse("sopr", 42).fetch_status).toBe("error");
    expect(parseBitboResponse("sopr", []).fetch_status).toBe("error");
  });

  it("returns error when data is missing or not an array", () => {
    expect(
      parseBitboResponse("mvrv-z-score", { metric: "mvrv-z-score" })
        .fetch_status,
    ).toBe("error");
    expect(
      parseBitboResponse("sopr", { metric: "sopr", data: "not-an-array" })
        .fetch_status,
    ).toBe("error");
  });

  it("sorts observations chronologically even when upstream order is wrong", () => {
    const body = {
      metric: "sopr",
      data: [
        { date: "2026-04-22", value: 1.05 },
        { date: "2026-04-20", value: 0.98 },
        { date: "2026-04-21", value: 1.01 },
      ],
    };
    const result = parseBitboResponse("sopr", body);

    expect(result.observations.map((o) => o.date)).toEqual([
      "2026-04-20",
      "2026-04-21",
      "2026-04-22",
    ]);
    expect(result.latest?.date).toBe("2026-04-22");
  });
});
