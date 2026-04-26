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
  it("contains exactly 19 tickers (Phase 3.0: 12 US/global via AV-primary + 7 KR via Yahoo-primary)", () => {
    // 7 US large-caps + 3 region ETF + 2 macro-hedge ETF + 5 KR
    // large-caps + 2 KR ETFs = 19. Phase 3.0 (2026-04-26) reinstated
    // the KR tickers under the daily-bar fallback chain (Yahoo
    // primary for `.KS` / `.KQ`); AV / Twelve Data are still skipped
    // for KR via `isKrTicker()` in `daily-bar-fetcher.ts`.
    expect(TICKER_REGISTRY).toHaveLength(19);
  });

  it("has unique ticker strings (no accidental duplicates)", () => {
    const tickers = TICKER_REGISTRY.map((entry) => entry.ticker);
    const unique = new Set(tickers);
    expect(unique.size).toBe(tickers.length);
  });

  it("contains exactly 7 KR equity tickers (Phase 3.0 reinstatement)", () => {
    // Five KOSPI large-caps (Samsung 005930, SK Hynix 000660,
    // LG Energy Solution 373220, Samsung Bio 207940, Hyundai 005380)
    // + 069500 KODEX 200 (KOSPI proxy) + 229200 KODEX KOSDAQ150 (KOSDAQ
    // proxy). All routed through Yahoo Finance via the Phase 3.0
    // fallback chain.
    const krEntries = TICKER_REGISTRY.filter(
      (e) => e.asset_type === "kr_equity",
    );
    expect(krEntries).toHaveLength(7);

    const krTickers = krEntries.map((e) => e.ticker).sort();
    expect(krTickers).toEqual(
      [
        "000660.KS",
        "005380.KS",
        "005930.KS",
        "069500.KS",
        "207940.KS",
        "229200.KQ",
        "373220.KS",
      ].sort(),
    );
  });

  it("only KR tickers carry `.KS` / `.KQ` suffix (US/global stay symbol-only)", () => {
    for (const entry of TICKER_REGISTRY) {
      const isKr = /\.(KS|KQ)$/.test(entry.ticker);
      if (isKr) {
        expect(entry.asset_type).toBe("kr_equity");
      } else {
        expect(entry.asset_type).not.toBe("kr_equity");
      }
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
    // Phase 3.0: only the 12 AV-served tickers need 13s spacing for
    // AV's 5/min ceiling. The 7 KR tickers go via Yahoo Finance with
    // no per-minute throttle. Worst-case wallclock: 11 × 13s sleeps
    // (between the 12 AV calls) + ~2s × 19 fetches ≈ 181s, comfortably
    // inside the 300s `maxDuration` ceiling.
    const avTickers = TICKER_REGISTRY.filter(
      (e) => !/\.(KS|KQ)$/.test(e.ticker),
    );
    const avSleepMs = Math.max(0, avTickers.length - 1) * ALPHA_VANTAGE_SLEEP_MS;
    expect(avSleepMs).toBeLessThan(300_000);
    // Sanity: the un-paced KR additions don't push us over even with
    // generous fetch latency.
    const generousFetchLatencyMs = TICKER_REGISTRY.length * 5_000;
    expect(avSleepMs + generousFetchLatencyMs).toBeLessThan(300_000);
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
