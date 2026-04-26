import { describe, expect, it } from "vitest";

import { parseYahooFinanceResponse } from "./yahoo-finance-parse";

/**
 * Network-free tests for the Yahoo Finance chart-API parser.
 * All fixtures are synthetic. No live key, no UA header needed
 * (parser only sees the JSON body).
 */

// Helper: shape a synthetic chart response.
function makeChartResponse(opts: {
  symbol?: string;
  gmtoffset?: number;
  timestamps: number[];
  open: Array<number | null>;
  high: Array<number | null>;
  low: Array<number | null>;
  close: Array<number | null>;
  volume: Array<number | null>;
}) {
  return {
    chart: {
      result: [
        {
          meta: {
            currency: "USD",
            symbol: opts.symbol ?? "SPY",
            exchangeName: "PCX",
            gmtoffset: opts.gmtoffset ?? 0,
          },
          timestamp: opts.timestamps,
          indicators: {
            quote: [
              {
                open: opts.open,
                high: opts.high,
                low: opts.low,
                close: opts.close,
                volume: opts.volume,
              },
            ],
          },
        },
      ],
      error: null,
    },
  };
}

describe("parseYahooFinanceResponse", () => {
  it("parses a well-formed SPY response into ascending bars (UTC)", () => {
    // 3 daily bars, US ticker (gmtoffset 0 to match the parser's UTC slice).
    // Times are the market-open instants 2026-04-22, -23, -24 14:30 UTC.
    const ts1 = Date.UTC(2026, 3, 22, 14, 30, 0) / 1000;
    const ts2 = Date.UTC(2026, 3, 23, 14, 30, 0) / 1000;
    const ts3 = Date.UTC(2026, 3, 24, 14, 30, 0) / 1000;
    const body = makeChartResponse({
      symbol: "SPY",
      gmtoffset: 0,
      timestamps: [ts1, ts2, ts3],
      open: [705.1, 709.5, 710.75],
      high: [710.2, 712.36, 714.47],
      low: [703.5, 702.28, 709.01],
      close: [708.0, 708.45, 713.94],
      volume: [50_000_000, 56_174_000, 45_123_600],
    });

    const result = parseYahooFinanceResponse("SPY", body);
    expect(result.fetch_status).toBe("ok");
    expect(result.source_name).toBe("yahoo_finance");
    expect(result.ticker).toBe("SPY");
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
      volume: 45_123_600,
    });
    expect(result.error).toBeUndefined();
  });

  it("parses a KR ticker (.KS) using gmtoffset to land on the local trade date", () => {
    // KR market opens at 09:00 KST = 00:00 UTC. The naive UTC date for
    // 2026-04-25 09:00 KST would be 2026-04-25 00:00 UTC → still the 25th.
    // But for 2026-04-25 09:00 KST = ts seconds where the UTC date is the 25th.
    // We test that gmtoffset applied keeps the date as 25th, not 24th.
    const localOpen = Date.UTC(2026, 3, 25, 0, 0, 0) / 1000; // 2026-04-25 00:00 UTC = 09:00 KST
    const body = makeChartResponse({
      symbol: "005930.KS",
      gmtoffset: 32400,
      timestamps: [localOpen],
      open: [219_000],
      high: [225_000],
      low: [216_500],
      close: [219_500],
      volume: [20_658_004],
    });

    const result = parseYahooFinanceResponse("005930.KS", body);
    expect(result.fetch_status).toBe("ok");
    expect(result.bars).toHaveLength(1);
    // 00:00 UTC + 9h offset = 09:00 UTC → date slice still 2026-04-25.
    expect(result.bars[0]!.date).toBe("2026-04-25");
    expect(result.latest?.close).toBe(219_500);
  });

  it("returns error on chart.error payload (invalid ticker)", () => {
    const body = {
      chart: {
        result: null,
        error: {
          code: "Not Found",
          description: "No data found, symbol may be delisted",
        },
      },
    };
    const result = parseYahooFinanceResponse("BADTICKER", body);
    expect(result.fetch_status).toBe("error");
    expect(result.error).toMatch(/Not Found/);
    expect(result.error).toMatch(/No data/);
    expect(result.bars).toEqual([]);
    expect(result.latest).toBeNull();
    expect(result.source_name).toBe("yahoo_finance");
  });

  it("returns error when chart.result is empty array", () => {
    const body = { chart: { result: [], error: null } };
    const result = parseYahooFinanceResponse("BADTICKER", body);
    expect(result.fetch_status).toBe("error");
    expect(result.error).toMatch(/result/);
  });

  it("returns error when timestamp array is empty", () => {
    const body = makeChartResponse({
      timestamps: [],
      open: [],
      high: [],
      low: [],
      close: [],
      volume: [],
    });
    const result = parseYahooFinanceResponse("SPY", body);
    expect(result.fetch_status).toBe("error");
    expect(result.error).toMatch(/timestamp/i);
  });

  it("returns error when OHLCV array length doesn't match timestamp length", () => {
    const body = makeChartResponse({
      timestamps: [1, 2, 3],
      open: [1, 2], // length mismatch
      high: [1, 2, 3],
      low: [1, 2, 3],
      close: [1, 2, 3],
      volume: [1, 2, 3],
    });
    const result = parseYahooFinanceResponse("SPY", body);
    expect(result.fetch_status).toBe("error");
    expect(result.error).toMatch(/length mismatch/);
  });

  it("drops rows with null OHLC values without killing the parse", () => {
    const ts1 = Date.UTC(2026, 3, 22, 14, 30, 0) / 1000;
    const ts2 = Date.UTC(2026, 3, 23, 14, 30, 0) / 1000;
    const ts3 = Date.UTC(2026, 3, 24, 14, 30, 0) / 1000;
    const body = makeChartResponse({
      timestamps: [ts1, ts2, ts3],
      open: [1, null, 3], // ts2 dropped
      high: [1, 2, 3],
      low: [1, 2, 3],
      close: [1, 2, 3],
      volume: [1, 2, 3],
    });
    const result = parseYahooFinanceResponse("SPY", body);
    expect(result.fetch_status).toBe("ok");
    expect(result.bars).toHaveLength(2);
    expect(result.bars.map((b) => b.date)).toEqual([
      "2026-04-22",
      "2026-04-24",
    ]);
  });

  it("returns partial when all rows are dropped (e.g. all-null OHLC)", () => {
    const ts1 = Date.UTC(2026, 3, 22, 14, 30, 0) / 1000;
    const body = makeChartResponse({
      timestamps: [ts1],
      open: [null],
      high: [null],
      low: [null],
      close: [null],
      volume: [null],
    });
    const result = parseYahooFinanceResponse("SPY", body);
    expect(result.fetch_status).toBe("partial");
    expect(result.bars).toEqual([]);
  });

  it("returns error on non-object body (null, string, array)", () => {
    expect(parseYahooFinanceResponse("SPY", null).fetch_status).toBe("error");
    expect(parseYahooFinanceResponse("SPY", "oops").fetch_status).toBe(
      "error",
    );
    expect(parseYahooFinanceResponse("SPY", []).fetch_status).toBe("error");
  });

  it("returns error when chart key is missing", () => {
    const body = { other: "stuff" };
    const result = parseYahooFinanceResponse("SPY", body);
    expect(result.fetch_status).toBe("error");
    expect(result.error).toMatch(/chart/);
  });

  it("sets fetched_at to a parseable ISO string", () => {
    const ts1 = Date.UTC(2026, 3, 22, 14, 30, 0) / 1000;
    const body = makeChartResponse({
      timestamps: [ts1],
      open: [1],
      high: [2],
      low: [0.5],
      close: [1.5],
      volume: [100],
    });
    const result = parseYahooFinanceResponse("SPY", body);
    expect(() => new Date(result.fetched_at).toISOString()).not.toThrow();
    expect(new Date(result.fetched_at).toString()).not.toBe("Invalid Date");
  });
});
