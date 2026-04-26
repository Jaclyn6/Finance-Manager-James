import { describe, expect, it } from "vitest";

import { parseTwelveDataResponse } from "./twelvedata-parse";

/**
 * Network-free tests for the Twelve Data time_series parser.
 * All fixtures are synthetic; no live key or env var required.
 * Mirrors `alpha-vantage-parse.test.ts` structure.
 */

describe("parseTwelveDataResponse", () => {
  it("parses a well-formed multi-day SPY response into ascending bars", () => {
    const body = {
      meta: {
        symbol: "SPY",
        interval: "1day",
        currency: "USD",
        exchange: "NYSE",
        type: "ETF",
      },
      // Twelve Data returns newest-first — verify we sort to ascending.
      values: [
        {
          datetime: "2026-04-24",
          open: "710.75",
          high: "714.46997",
          low: "709.010010",
          close: "713.94000",
          volume: "45123600",
        },
        {
          datetime: "2026-04-23",
          open: "709.5",
          high: "712.35999",
          low: "702.28003",
          close: "708.45001",
          volume: "56174000",
        },
        {
          datetime: "2026-04-22",
          open: "705.10",
          high: "710.20",
          low: "703.50",
          close: "708.00",
          volume: "50000000",
        },
      ],
      status: "ok",
    };

    const result = parseTwelveDataResponse("SPY", body);

    expect(result.ticker).toBe("SPY");
    expect(result.source_name).toBe("twelvedata");
    expect(result.fetch_status).toBe("ok");
    expect(result.bars).toHaveLength(3);
    expect(result.bars.map((b) => b.date)).toEqual([
      "2026-04-22",
      "2026-04-23",
      "2026-04-24",
    ]);
    expect(result.latest).toMatchObject({
      date: "2026-04-24",
      open: 710.75,
      close: 713.94,
      volume: 45123600,
    });
    expect(result.error).toBeUndefined();
  });

  it("returns 429-tagged error for rate-limit JSON body", () => {
    const body = {
      code: 429,
      message: "You have run out of API credits for the current minute.",
      status: "error",
    };
    const result = parseTwelveDataResponse("SPY", body);
    expect(result.fetch_status).toBe("error");
    expect(result.error).toMatch(/429/);
    expect(result.error).toMatch(/rate limit/i);
    expect(result.bars).toEqual([]);
    expect(result.latest).toBeNull();
    expect(result.source_name).toBe("twelvedata");
  });

  it("returns 401-tagged error for invalid API key JSON body", () => {
    const body = {
      code: 401,
      message: "Apikey XXXXXXXX is invalid or missing.",
      status: "error",
    };
    const result = parseTwelveDataResponse("SPY", body);
    expect(result.fetch_status).toBe("error");
    expect(result.error).toMatch(/401/);
    expect(result.error).toMatch(/invalid api key/i);
    expect(result.bars).toEqual([]);
    expect(result.latest).toBeNull();
  });

  it("returns 400-tagged error for invalid symbol JSON body", () => {
    const body = {
      code: 400,
      message: "**symbol** not found: BADTICKER.",
      status: "error",
    };
    const result = parseTwelveDataResponse("BADTICKER", body);
    expect(result.fetch_status).toBe("error");
    expect(result.error).toMatch(/400/);
    expect(result.bars).toEqual([]);
  });

  it("returns error when 'values' key is missing from response", () => {
    const body = { meta: { symbol: "SPY" }, status: "ok" };
    const result = parseTwelveDataResponse("SPY", body);
    expect(result.fetch_status).toBe("error");
    expect(result.error).toMatch(/values/i);
  });

  it("returns error when 'values' array is empty", () => {
    const body = { meta: { symbol: "SPY" }, values: [], status: "ok" };
    const result = parseTwelveDataResponse("SPY", body);
    expect(result.fetch_status).toBe("error");
    expect(result.error).toMatch(/empty/i);
    expect(result.bars).toEqual([]);
    expect(result.latest).toBeNull();
  });

  it("skips malformed rows without killing the whole parse", () => {
    const body = {
      values: [
        {
          datetime: "2026-04-24",
          open: "710.75",
          high: "714.47",
          low: "709.01",
          close: "713.94",
          volume: "45123600",
        },
        {
          // non-numeric close → row dropped
          datetime: "2026-04-23",
          open: "709.5",
          high: "712.36",
          low: "702.28",
          close: "not a number",
          volume: "56174000",
        },
        {
          // missing volume → row dropped
          datetime: "2026-04-22",
          open: "705.10",
          high: "710.20",
          low: "703.50",
          close: "708.00",
        },
      ],
      status: "ok",
    };
    const result = parseTwelveDataResponse("SPY", body);
    expect(result.fetch_status).toBe("ok");
    expect(result.bars).toHaveLength(1);
    expect(result.bars[0]!.date).toBe("2026-04-24");
  });

  it("rejects non-YYYY-MM-DD datetime values (Postgres DATE safety)", () => {
    const body = {
      values: [
        {
          datetime: "2026/04/24",
          open: "1",
          high: "2",
          low: "0.5",
          close: "1.5",
          volume: "100",
        },
        {
          datetime: "20260423",
          open: "1",
          high: "2",
          low: "0.5",
          close: "1.5",
          volume: "100",
        },
        {
          datetime: "2026-4-22",
          open: "1",
          high: "2",
          low: "0.5",
          close: "1.5",
          volume: "100",
        },
      ],
      status: "ok",
    };
    const result = parseTwelveDataResponse("SPY", body);
    expect(result.bars).toHaveLength(0);
    expect(result.fetch_status).toBe("partial");
  });

  it("returns error on non-object body (null, string, number, array)", () => {
    expect(parseTwelveDataResponse("SPY", null).fetch_status).toBe("error");
    expect(parseTwelveDataResponse("SPY", "oops").fetch_status).toBe("error");
    expect(parseTwelveDataResponse("SPY", 42).fetch_status).toBe("error");
    expect(parseTwelveDataResponse("SPY", []).fetch_status).toBe("error");
  });

  it("sets fetched_at to a parseable ISO string", () => {
    const body = {
      values: [
        {
          datetime: "2026-04-24",
          open: "710.75",
          high: "714.47",
          low: "709.01",
          close: "713.94",
          volume: "45123600",
        },
      ],
      status: "ok",
    };
    const result = parseTwelveDataResponse("SPY", body);
    expect(() => new Date(result.fetched_at).toISOString()).not.toThrow();
    expect(new Date(result.fetched_at).toString()).not.toBe("Invalid Date");
  });
});
