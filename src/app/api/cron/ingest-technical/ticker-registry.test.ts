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
  it("contains exactly 12 Alpha Vantage tickers (blueprint §3.2)", () => {
    // 7 US large-caps/ETFs + 3 region ETF + 2 macro-hedge ETF = 12.
    // KR equities removed 2026-04-25: AV free tier doesn't serve KOSPI;
    // see ticker-registry.ts header for Phase 3 ECOS / Yahoo plan.
    expect(TICKER_REGISTRY).toHaveLength(12);
  });

  it("has unique ticker strings (no accidental duplicates)", () => {
    const tickers = TICKER_REGISTRY.map((entry) => entry.ticker);
    const unique = new Set(tickers);
    expect(unique.size).toBe(tickers.length);
  });

  it("contains no .KS / .KQ tickers (KR equities removed at Phase 2)", () => {
    // KR carve-out 2026-04-25 — see ticker-registry.ts file header.
    // AV free tier returns `Invalid API call` for every KR symbol
    // format. This guard prevents an accidental re-add that would
    // burn the daily AV budget on errors.
    for (const entry of TICKER_REGISTRY) {
      expect(entry.ticker.endsWith(".KS")).toBe(false);
      expect(entry.ticker.endsWith(".KQ")).toBe(false);
      expect(entry.asset_type).not.toBe("kr_equity");
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

  it("places SPY + QQQ at indices 0-1 (broad-index aggregator + load-bearing-first)", () => {
    // signals.ts MOMENTUM_TURN and category-aggregators.ts both
    // reference SPY and QQQ. Putting them first means a mid-loop AV
    // outage doesn't block the most load-bearing tickers from landing.
    expect(TICKER_REGISTRY[0]?.ticker).toBe("SPY");
    expect(TICKER_REGISTRY[1]?.ticker).toBe("QQQ");
  });

  it("fits under the Vercel Fluid Compute 300s ceiling at 13s spacing", () => {
    // Asserts the total serial walk duration fits the route's budget.
    // 12 × 13_000 = 156_000ms + headroom for fetch latency.
    const totalSleepMs = TICKER_REGISTRY.length * ALPHA_VANTAGE_SLEEP_MS;
    expect(totalSleepMs).toBeLessThan(300_000);
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
