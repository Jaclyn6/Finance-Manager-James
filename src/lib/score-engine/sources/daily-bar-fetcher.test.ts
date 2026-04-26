import { describe, expect, it } from "vitest";

import { isKrTicker } from "./daily-bar-fetcher";

/**
 * Unit tests for the pure helpers in `daily-bar-fetcher.ts`.
 * The full `fetchDailyBars()` orchestrator is integration-tested via
 * the cron route's e2e test (Phase 3.0 Step 3), not here, since
 * mocking three live adapters in Vitest is more brittle than
 * hitting them in a contract test against fixtures.
 */

describe("isKrTicker", () => {
  it("matches .KS suffix (KOSPI)", () => {
    expect(isKrTicker("005930.KS")).toBe(true);
    expect(isKrTicker("000660.KS")).toBe(true);
    expect(isKrTicker("373220.KS")).toBe(true);
    expect(isKrTicker("069500.KS")).toBe(true);
  });

  it("matches .KQ suffix (KOSDAQ)", () => {
    expect(isKrTicker("229200.KQ")).toBe(true);
    expect(isKrTicker("ABCDEF.KQ")).toBe(true);
  });

  it("rejects US tickers", () => {
    expect(isKrTicker("SPY")).toBe(false);
    expect(isKrTicker("QQQ")).toBe(false);
    expect(isKrTicker("BTC-USD")).toBe(false);
  });

  it("rejects partial / lowercase / inside-string matches", () => {
    expect(isKrTicker("KS")).toBe(false);
    expect(isKrTicker("foo.ks")).toBe(false); // lowercase
    expect(isKrTicker("foo.KSX")).toBe(false); // suffix not at end
    expect(isKrTicker(".KS.foo")).toBe(false); // suffix not at end
  });

  it("rejects empty string", () => {
    expect(isKrTicker("")).toBe(false);
  });
});
