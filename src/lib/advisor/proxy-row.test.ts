import { describe, expect, it } from "vitest";

import { proxyToOnchainRow } from "./proxy-row";
import { STOCK_FG_PROXY_KEY, type StockFgProxyResult } from "./stock-fg-proxy";
import { ADVISOR_ENGINE_VERSION } from "./verdict";

const FULL: StockFgProxyResult = {
  value: 38.5,
  components: [
    { key: "momentum", score: 40, detailKo: "SPY 125일선 대비 -1.6%" },
    { key: "volatility", score: 55, detailKo: "VIX 18.2" },
    { key: "junkDemand", score: 30, detailKo: "HY 3.9%p" },
    { key: "safeHaven", score: 29, detailKo: "20일 차 -3.4%p" },
  ],
  missing: [],
};

describe("proxyToOnchainRow", () => {
  it("writes a raw-only success row with advisor provenance", () => {
    const row = proxyToOnchainRow(FULL, "2026-07-08");
    expect(row).toMatchObject({
      indicator_key: STOCK_FG_PROXY_KEY,
      asset_type: "common",
      observed_at: "2026-07-08",
      model_version: ADVISOR_ENGINE_VERSION,
      fetch_status: "success",
      value_raw: 38.5,
      value_normalized: null,
      score_0_100: null,
    });
  });

  it("keeps the component breakdown in raw_payload", () => {
    const row = proxyToOnchainRow(FULL, "2026-07-08");
    const payload = row.raw_payload as {
      components: unknown[];
      missing: unknown[];
    };
    expect(payload.components).toHaveLength(4);
    expect(payload.missing).toEqual([]);
  });

  it("a value from 3/4 components → partial, not success (convention: any missing = partial)", () => {
    const threeOfFour: StockFgProxyResult = {
      value: 41.7,
      components: FULL.components.map((c) =>
        c.key === "safeHaven" ? { ...c, score: null } : c,
      ),
      missing: ["safeHaven"],
    };
    const row = proxyToOnchainRow(threeOfFour, "2026-07-08");
    expect(row.fetch_status).toBe("partial");
    expect(row.value_raw).toBe(41.7);
  });

  it("null value → partial row, never a fabricated number", () => {
    const dark: StockFgProxyResult = {
      value: null,
      components: FULL.components.map((c) => ({ ...c, score: null })),
      missing: ["momentum", "volatility", "junkDemand", "safeHaven"],
    };
    const row = proxyToOnchainRow(dark, "2026-07-08");
    expect(row.fetch_status).toBe("partial");
    expect(row.value_raw).toBeNull();
  });
});
