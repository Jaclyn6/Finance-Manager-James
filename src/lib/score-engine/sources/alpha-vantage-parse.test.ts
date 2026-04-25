import { describe, expect, it } from "vitest";

import { parseAlphaVantageDailyResponse } from "./alpha-vantage-parse";

/**
 * Network-free tests for the Alpha Vantage TIME_SERIES_DAILY parser.
 * All fixtures are synthetic; no live key required.
 */

describe("parseAlphaVantageDailyResponse", () => {
  it("parses a well-formed multi-day response into ascending bars", () => {
    const body = {
      "Meta Data": {
        "1. Information": "Daily Prices (open, high, low, close) and Volumes",
        "2. Symbol": "SPY",
      },
      "Time Series (Daily)": {
        // Alpha Vantage actually returns newest-first; verify we sort.
        "2026-04-22": {
          "1. open": "512.30",
          "2. high": "513.50",
          "3. low": "510.10",
          "4. close": "512.80",
          "5. volume": "71234567",
        },
        "2026-04-21": {
          "1. open": "510.00",
          "2. high": "511.00",
          "3. low": "509.50",
          "4. close": "510.75",
          "5. volume": "60000000",
        },
        "2026-04-20": {
          "1. open": "509.00",
          "2. high": "510.50",
          "3. low": "508.00",
          "4. close": "509.90",
          "5. volume": "55500000",
        },
      },
    };
    const result = parseAlphaVantageDailyResponse("SPY", body);

    expect(result.ticker).toBe("SPY");
    expect(result.fetch_status).toBe("success");
    expect(result.bars).toHaveLength(3);
    // Chronological ascending.
    expect(result.bars.map((b) => b.date)).toEqual([
      "2026-04-20",
      "2026-04-21",
      "2026-04-22",
    ]);
    expect(result.latest).toEqual({
      date: "2026-04-22",
      open: 512.3,
      high: 513.5,
      low: 510.1,
      close: 512.8,
      volume: 71234567,
    });
  });

  it("returns error when body is the Alpha Vantage rate-limit Information shape", () => {
    const body = {
      Information:
        "We have detected your API key ... You have reached the 25 requests/day limit.",
    };
    const result = parseAlphaVantageDailyResponse("SPY", body);
    expect(result.fetch_status).toBe("error");
    expect(result.error).toMatch(/rate limit/i);
    expect(result.bars).toEqual([]);
    expect(result.latest).toBeNull();
  });

  it("returns error AND flags 'premium-only' when AV gates outputsize=full behind a paid plan", () => {
    // Verified 2026-04-25: AV moved `outputsize=full` to a paid plan
    // and started returning HTTP 200 with `Information: "...premium
    // feature..."`. The parser must (a) route this to fetch_status
    // 'error' so the cron's per-ticker loop continues, and (b) make
    // the failure mode obvious in the audit row's error_summary.
    const body = {
      Information:
        "Thank you for using Alpha Vantage! This is a premium feature; please subscribe to a paid plan.",
    };
    const result = parseAlphaVantageDailyResponse("SPY", body);
    expect(result.fetch_status).toBe("error");
    expect(result.error).toMatch(/premium-only/i);
    expect(result.bars).toEqual([]);
    expect(result.latest).toBeNull();
  });

  it("returns error when body is the legacy rate-limit Note shape", () => {
    const body = { Note: "Thank you for using Alpha Vantage! ..." };
    const result = parseAlphaVantageDailyResponse("SPY", body);
    expect(result.fetch_status).toBe("error");
    expect(result.error).toMatch(/rate limit/i);
  });

  it("returns error when body is the invalid-ticker Error Message shape", () => {
    const body = {
      "Error Message":
        "Invalid API call. Please retry or visit the documentation.",
    };
    const result = parseAlphaVantageDailyResponse("BADTICKER", body);
    expect(result.fetch_status).toBe("error");
    expect(result.error).toMatch(/Alpha Vantage error/);
  });

  it("skips malformed daily rows without killing the whole parse", () => {
    const body = {
      "Time Series (Daily)": {
        "2026-04-22": {
          "1. open": "512.30",
          "2. high": "513.50",
          "3. low": "510.10",
          "4. close": "512.80",
          "5. volume": "71234567",
        },
        "2026-04-21": {
          // non-numeric open — whole row dropped
          "1. open": "not a number",
          "2. high": "511.00",
          "3. low": "509.50",
          "4. close": "510.75",
          "5. volume": "60000000",
        },
        "2026-04-20": {
          // missing "4. close" — whole row dropped
          "1. open": "509.00",
          "2. high": "510.50",
          "3. low": "508.00",
          "5. volume": "55500000",
        },
        "2026-04-19": {
          "1. open": "508.00",
          "2. high": "509.00",
          "3. low": "507.00",
          "4. close": "508.50",
          "5. volume": "50000000",
        },
      },
    };
    const result = parseAlphaVantageDailyResponse("SPY", body);

    expect(result.fetch_status).toBe("success");
    // Only the two well-formed rows survive, in ascending order.
    expect(result.bars.map((b) => b.date)).toEqual([
      "2026-04-19",
      "2026-04-22",
    ]);
  });

  it("rejects non-YYYY-MM-DD date keys (Postgres DATE safety)", () => {
    const body = {
      "Time Series (Daily)": {
        "2026/04/22": {
          "1. open": "1",
          "2. high": "2",
          "3. low": "0.5",
          "4. close": "1.5",
          "5. volume": "100",
        },
        "20260421": {
          "1. open": "1",
          "2. high": "2",
          "3. low": "0.5",
          "4. close": "1.5",
          "5. volume": "100",
        },
        "2026-4-20": {
          "1. open": "1",
          "2. high": "2",
          "3. low": "0.5",
          "4. close": "1.5",
          "5. volume": "100",
        },
        "": {
          "1. open": "1",
          "2. high": "2",
          "3. low": "0.5",
          "4. close": "1.5",
          "5. volume": "100",
        },
        "2026-04-22T00:00:00Z": {
          "1. open": "1",
          "2. high": "2",
          "3. low": "0.5",
          "4. close": "1.5",
          "5. volume": "100",
        },
      },
    };
    const result = parseAlphaVantageDailyResponse("SPY", body);
    expect(result.bars).toHaveLength(0);
    // Zero bars → partial.
    expect(result.fetch_status).toBe("partial");
  });

  it("returns error on non-object body (null, string, number, array)", () => {
    expect(parseAlphaVantageDailyResponse("SPY", null).fetch_status).toBe(
      "error",
    );
    expect(parseAlphaVantageDailyResponse("SPY", "oops").fetch_status).toBe(
      "error",
    );
    expect(parseAlphaVantageDailyResponse("SPY", 42).fetch_status).toBe(
      "error",
    );
    expect(parseAlphaVantageDailyResponse("SPY", []).fetch_status).toBe(
      "error",
    );
  });

  it("returns error when 'Time Series (Daily)' is missing", () => {
    const result = parseAlphaVantageDailyResponse("SPY", {
      "Meta Data": { "2. Symbol": "SPY" },
    });
    expect(result.fetch_status).toBe("error");
    expect(result.error).toMatch(/Time Series \(Daily\)/);
  });

  it("sets fetched_at to a parseable ISO string", () => {
    const result = parseAlphaVantageDailyResponse("SPY", {
      "Time Series (Daily)": {
        "2026-04-22": {
          "1. open": "1",
          "2. high": "2",
          "3. low": "0.5",
          "4. close": "1.5",
          "5. volume": "100",
        },
      },
    });
    expect(() => new Date(result.fetched_at).toISOString()).not.toThrow();
    expect(new Date(result.fetched_at).toString()).not.toBe("Invalid Date");
  });
});
