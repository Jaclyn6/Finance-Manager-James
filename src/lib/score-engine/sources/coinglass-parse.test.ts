import { describe, expect, it } from "vitest";

import { parseCoinGlassEtfFlowResponse } from "./coinglass-parse";

/**
 * Network-free tests for the CoinGlass BTC Spot ETF flow parser.
 * Synthetic payloads only; the live upstream shape must be verified
 * at Step 7 cron implementation (see parser file header).
 */

describe("parseCoinGlassEtfFlowResponse", () => {
  it("parses a well-formed response", () => {
    const body = {
      code: "0",
      msg: "success",
      data: [
        { date: "2026-04-20", netFlow: 100_000_000, totalFlow: 120_000_000 },
        { date: "2026-04-21", netFlow: 135_000_000, totalFlow: 155_000_000 },
        { date: "2026-04-22", netFlow: -25_000_000, totalFlow: 90_000_000 },
      ],
    };

    const result = parseCoinGlassEtfFlowResponse(body);

    expect(result.fetch_status).toBe("success");
    expect(result.observations).toHaveLength(3);
    expect(result.latest).toEqual({
      date: "2026-04-22",
      netFlow: -25_000_000,
    });
    // totalFlow is intentionally dropped — blueprint §4.1 specifies
    // 순유입 = netFlow only.
    const keys = Object.keys(result.observations[0]).sort();
    expect(keys).toEqual(["date", "netFlow"]);
  });

  it("returns partial when data[] is empty", () => {
    const result = parseCoinGlassEtfFlowResponse({ code: "0", data: [] });

    expect(result.fetch_status).toBe("partial");
    expect(result.observations).toHaveLength(0);
    expect(result.latest).toBeNull();
    expect(result.error).toMatch(/no observations after parsing/);
  });

  it("rejects non-YYYY-MM-DD dates", () => {
    const body = {
      code: "0",
      data: [
        { date: "2026/04/22", netFlow: 1 }, // wrong separator
        { date: "20260422", netFlow: 1 }, // no separators
        { date: "2026-4-22", netFlow: 1 }, // not zero-padded
        { date: "", netFlow: 1 }, // empty
        { date: "2026-04-22T00:00:00Z", netFlow: 1 }, // timestamp
      ],
    };
    const result = parseCoinGlassEtfFlowResponse(body);

    expect(result.observations).toHaveLength(0);
    expect(result.fetch_status).toBe("partial");
  });

  it("skips malformed entries (non-number netFlow) without killing the parse", () => {
    const body = {
      code: "0",
      data: [
        { date: "2026-04-20", netFlow: 100 },
        { date: "2026-04-21", netFlow: "135000000" }, // string
        { date: "2026-04-22", netFlow: null }, // null
        { date: "2026-04-23", netFlow: Number.NaN }, // NaN
        { date: "2026-04-24", netFlow: 200 },
      ],
    };
    const result = parseCoinGlassEtfFlowResponse(body);

    expect(result.fetch_status).toBe("success");
    expect(result.observations).toHaveLength(2);
    expect(result.observations.map((o) => o.date)).toEqual([
      "2026-04-20",
      "2026-04-24",
    ]);
  });

  it('returns error when response code !== "0"', () => {
    const result = parseCoinGlassEtfFlowResponse({
      code: "30001",
      msg: "rate limit exceeded",
      data: [],
    });

    expect(result.fetch_status).toBe("error");
    expect(result.error).toMatch(/30001/);
    expect(result.error).toMatch(/rate limit exceeded/);
  });

  it("returns error on non-object body", () => {
    expect(parseCoinGlassEtfFlowResponse(null).fetch_status).toBe("error");
    expect(parseCoinGlassEtfFlowResponse("a string").fetch_status).toBe(
      "error",
    );
    expect(parseCoinGlassEtfFlowResponse(42).fetch_status).toBe("error");
    expect(parseCoinGlassEtfFlowResponse([]).fetch_status).toBe("error");
  });

  it("returns error when data is missing or not an array", () => {
    expect(
      parseCoinGlassEtfFlowResponse({ code: "0" }).fetch_status,
    ).toBe("error");
    expect(
      parseCoinGlassEtfFlowResponse({ code: "0", data: "not-an-array" })
        .fetch_status,
    ).toBe("error");
  });

  it("sorts observations chronologically when upstream order is reversed", () => {
    const body = {
      code: "0",
      data: [
        { date: "2026-04-22", netFlow: 300 },
        { date: "2026-04-20", netFlow: 100 },
        { date: "2026-04-21", netFlow: 200 },
      ],
    };
    const result = parseCoinGlassEtfFlowResponse(body);

    expect(result.observations.map((o) => o.date)).toEqual([
      "2026-04-20",
      "2026-04-21",
      "2026-04-22",
    ]);
    expect(result.latest).toEqual({ date: "2026-04-22", netFlow: 300 });
  });
});
