import { describe, expect, it } from "vitest";

import {
  ALPHA_VANTAGE_SLEEP_MS,
  INDICATOR_KEYS,
  TICKER_REGISTRY,
} from "./ticker-registry";

/**
 * Registry-shape tests for the Phase 2 Step 7 ticker list.
 *
 * Network-free — no Alpha Vantage / Supabase / Next.js imports on the
 * module-under-test side (`ticker-registry.ts`), so `vitest run` can
 * execute this in the default Node env with no server-only shim.
 *
 * The tests encode the cross-file invariants from blueprint §3.2 and
 * migration 0005 so that an accidental edit to the array, an asset-
 * type misclassification, or a typo in an indicator_key is caught at
 * the test layer rather than by a silent mismatch between
 * technical_readings rows and the Step 8 UI reader.
 */

describe("TICKER_REGISTRY", () => {
  it("contains exactly 19 Alpha Vantage tickers (blueprint §3.2)", () => {
    // 7 KR + 7 US + 3 region ETF + 2 macro-hedge ETF = 19.
    expect(TICKER_REGISTRY).toHaveLength(19);
  });

  it("has unique ticker strings (no accidental duplicates)", () => {
    const tickers = TICKER_REGISTRY.map((entry) => entry.ticker);
    const unique = new Set(tickers);
    expect(unique.size).toBe(tickers.length);
  });

  it("maps KR equities (.KS suffix) to kr_equity", () => {
    const krEntries = TICKER_REGISTRY.filter((e) => e.ticker.endsWith(".KS"));
    expect(krEntries).toHaveLength(7);
    for (const entry of krEntries) {
      expect(entry.asset_type).toBe("kr_equity");
    }
  });

  it("maps the 7 US large-caps/ETFs to us_equity", () => {
    const expectedUsTickers = ["SPY", "QQQ", "NVDA", "AAPL", "MSFT", "GOOGL", "AMZN"];
    for (const ticker of expectedUsTickers) {
      const entry = TICKER_REGISTRY.find((e) => e.ticker === ticker);
      expect(entry, `missing ${ticker}`).toBeDefined();
      expect(entry!.asset_type).toBe("us_equity");
    }
  });

  it("maps region and macro-hedge ETFs (EWJ/MCHI/INDA/GLD/TLT) to global_etf", () => {
    const expectedGlobalEtfs = ["EWJ", "MCHI", "INDA", "GLD", "TLT"];
    for (const ticker of expectedGlobalEtfs) {
      const entry = TICKER_REGISTRY.find((e) => e.ticker === ticker);
      expect(entry, `missing ${ticker}`).toBeDefined();
      expect(entry!.asset_type).toBe("global_etf");
    }
  });

  it("never uses 'btc' or 'common' asset_type (crypto lives in ingest-prices)", () => {
    // The technical cron writes to technical_readings for equities/ETFs
    // only. Bitcoin/Ethereum/Solana prices come from CoinGecko via
    // ingest-prices (visualization-only) — they have no RSI/MACD rows.
    for (const entry of TICKER_REGISTRY) {
      expect(entry.asset_type).not.toBe("btc");
      expect(entry.asset_type).not.toBe("common");
    }
  });

  it("fits under the Vercel Fluid Compute 300s ceiling at 13s spacing", () => {
    // Asserts the total serial walk duration + overhead budget.
    // 19 × 13_000 = 247_000ms + ~30s headroom for fetch latency.
    const totalSleepMs = TICKER_REGISTRY.length * ALPHA_VANTAGE_SLEEP_MS;
    expect(totalSleepMs).toBeLessThan(300_000);
  });

  // ------------------------------------------------------------------
  // C2 batch-split (2026-04-25) — the route handler walks half the
  // registry per `?batch=1|2` invocation. These tests pin the split
  // so a future ticker-registry edit (e.g. growing to 21 tickers) is
  // forced to consciously rebalance the batches rather than silently
  // tipping batch 1 back over the 300s ceiling.
  // ------------------------------------------------------------------
  describe("C2 batch-split (?batch=1|2)", () => {
    const BATCH_SIZE = Math.ceil(TICKER_REGISTRY.length / 2);
    const batch1 = TICKER_REGISTRY.slice(0, BATCH_SIZE);
    const batch2 = TICKER_REGISTRY.slice(BATCH_SIZE);

    it("batch 1 has 10 tickers (ceil(19/2))", () => {
      expect(batch1).toHaveLength(10);
    });

    it("batch 2 has 9 tickers (remainder)", () => {
      expect(batch2).toHaveLength(9);
    });

    it("batch 1 ∪ batch 2 == full registry, no overlap", () => {
      expect([...batch1, ...batch2]).toEqual([...TICKER_REGISTRY]);
      const overlap = batch1.filter((b1) =>
        batch2.some((b2) => b2.ticker === b1.ticker),
      );
      expect(overlap).toEqual([]);
    });

    it("batch 1 includes SPY + QQQ (broad-index aggregator dependency)", () => {
      // signals.ts MOMENTUM_TURN and category-aggregators.ts both
      // reference SPY and QQQ. Putting them in batch 1 means they
      // survive a batch-2 outage — the load-bearing tickers ingest
      // first and never depend on the second cron firing.
      const tickers = batch1.map((entry) => entry.ticker);
      expect(tickers).toContain("SPY");
      expect(tickers).toContain("QQQ");
    });

    it("each batch's runtime budget fits under 300s", () => {
      // Per batch: (n - 1) sleeps × 13s + n fetches × ~2s + overhead.
      // We bound the dominant term (sleeps) and require it well under
      // 300s. Real fetch latency is 1-3s/ticker so 50s headroom is
      // ample.
      const batch1Ms = (batch1.length - 1) * ALPHA_VANTAGE_SLEEP_MS;
      const batch2Ms = (batch2.length - 1) * ALPHA_VANTAGE_SLEEP_MS;
      expect(batch1Ms).toBeLessThan(250_000); // 9 × 13_000 = 117_000
      expect(batch2Ms).toBeLessThan(250_000); // 8 × 13_000 = 104_000
    });
  });
});

describe("INDICATOR_KEYS", () => {
  it("matches the migration 0005 comment exactly", () => {
    // From supabase/migrations/0005_phase2_schema.sql line 24:
    //   -- 'RSI_14', 'MACD_12_26_9', 'MA_50', 'MA_200', 'BB_20_2', 'DISPARITY'
    // A mismatch here silently splinters the indicator_key space so the
    // Step 8 UI reader returns no rows.
    const expected = [
      "RSI_14",
      "MACD_12_26_9",
      "MA_50",
      "MA_200",
      "BB_20_2",
      "DISPARITY",
    ];
    const actual = Object.values(INDICATOR_KEYS).sort();
    expect(actual).toEqual(expected.slice().sort());
  });

  it("uses key === value everywhere (const-as-enum discipline)", () => {
    for (const [key, value] of Object.entries(INDICATOR_KEYS)) {
      expect(value).toBe(key);
    }
  });
});
