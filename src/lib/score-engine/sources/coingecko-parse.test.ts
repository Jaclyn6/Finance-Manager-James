import { describe, expect, it } from "vitest";

import { parseCoinGeckoResponse } from "./coingecko-parse";

/**
 * Network-free tests for the CoinGecko response parser. Synthetic
 * payloads exercise the pure parser without hitting the live API.
 */

describe("parseCoinGeckoResponse", () => {
  it("parses a well-formed response into chronological bars", () => {
    // 2026-04-20 00:00:00 UTC = 1776643200000
    // 2026-04-21 00:00:00 UTC = 1776729600000
    // 2026-04-22 00:00:00 UTC = 1776816000000
    const body = {
      prices: [
        [1776643200000, 72000],
        [1776729600000, 72500],
        [1776816000000, 73100],
      ],
      market_caps: [],
      total_volumes: [],
    };

    const result = parseCoinGeckoResponse("bitcoin", body);

    expect(result.id).toBe("bitcoin");
    expect(result.fetch_status).toBe("success");
    expect(result.bars).toHaveLength(3);
    expect(result.bars[0]).toEqual({ date: "2026-04-20", close: 72000 });
    expect(result.bars[2]).toEqual({ date: "2026-04-22", close: 73100 });
    expect(result.latest).toEqual({ date: "2026-04-22", close: 73100 });
  });

  it("converts unix-ms timestamps to YYYY-MM-DD in UTC", () => {
    // 2026-01-01 00:00:00 UTC = 1767225600000
    // 2026-12-31 23:59:59 UTC = 1798761599000 — still inside Dec 31 UTC
    const body = {
      prices: [
        [1767225600000, 100],
        [1798761599000, 200],
      ],
    };
    const result = parseCoinGeckoResponse("ethereum", body);

    expect(result.fetch_status).toBe("success");
    expect(result.bars.map((b) => b.date)).toEqual([
      "2026-01-01",
      "2026-12-31",
    ]);
  });

  it("returns partial when prices is an empty array", () => {
    const result = parseCoinGeckoResponse("bitcoin", { prices: [] });

    expect(result.fetch_status).toBe("partial");
    expect(result.bars).toHaveLength(0);
    expect(result.latest).toBeNull();
    expect(result.error).toMatch(/no bars after parsing/);
  });

  it("returns error when prices is not an array (CoinGecko error body)", () => {
    // CoinGecko returns HTTP 200 with `{ error: "coin not found" }`
    // on unknown coin ids — detect and flag as error, not partial.
    const result = parseCoinGeckoResponse("not-a-coin", {
      error: "coin not found",
    });

    expect(result.fetch_status).toBe("error");
    expect(result.error).toMatch(/coin not found/);
    expect(result.bars).toHaveLength(0);
  });

  it("returns error when body is not an object", () => {
    expect(parseCoinGeckoResponse("bitcoin", null).fetch_status).toBe("error");
    expect(parseCoinGeckoResponse("bitcoin", "a string").fetch_status).toBe(
      "error",
    );
    expect(parseCoinGeckoResponse("bitcoin", 42).fetch_status).toBe("error");
    // Arrays are objects in JS but not the shape we expect.
    expect(parseCoinGeckoResponse("bitcoin", []).fetch_status).toBe("error");
  });

  it("skips malformed bar entries without killing the parse", () => {
    const body = {
      prices: [
        [1776643200000, 72000], // good — 2026-04-20
        [1776729600000, "not a number"], // bad price
        ["not a number", 72500], // bad timestamp
        [1776816000000], // too short
        "not a tuple", // not an array
        null, // null entry
        [1776902400000, 74000], // good — 2026-04-23
      ],
    };

    const result = parseCoinGeckoResponse("bitcoin", body);

    expect(result.fetch_status).toBe("success");
    expect(result.bars).toHaveLength(2);
    expect(result.bars.map((b) => b.date)).toEqual([
      "2026-04-20",
      "2026-04-23",
    ]);
  });

  it("sets fetched_at to a parseable ISO string", () => {
    const result = parseCoinGeckoResponse("bitcoin", {
      prices: [[1776643200000, 72000]],
    });
    expect(() => new Date(result.fetched_at).toISOString()).not.toThrow();
    expect(new Date(result.fetched_at).toString()).not.toBe("Invalid Date");
  });
});
