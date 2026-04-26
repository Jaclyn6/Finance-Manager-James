import { describe, expect, it } from "vitest";

import type { BacktestRequest } from "./backtest";
import { hashBacktestRequest } from "./backtest-hash";

const baseRequest: BacktestRequest = {
  weightsVersion: "v2.0.0-baseline",
  modelVersion: "v2.0.0",
  assetType: "us_equity",
  dateRange: { from: "2026-01-01", to: "2026-04-01" },
};

describe("hashBacktestRequest", () => {
  it("returns a 64-char hex sha256 digest", () => {
    const hash = hashBacktestRequest(baseRequest);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is idempotent — same request → same hash", () => {
    expect(hashBacktestRequest(baseRequest)).toBe(
      hashBacktestRequest(baseRequest),
    );
  });

  it("produces the same hash regardless of object key order", () => {
    const a = hashBacktestRequest(baseRequest);
    // Same logical request, different key insertion order.
    const reordered = {
      assetType: "us_equity" as const,
      dateRange: { to: "2026-04-01", from: "2026-01-01" },
      modelVersion: "v2.0.0",
      weightsVersion: "v2.0.0-baseline",
    };
    expect(hashBacktestRequest(reordered)).toBe(a);
  });

  it("changes hash when assetType changes", () => {
    const a = hashBacktestRequest(baseRequest);
    const b = hashBacktestRequest({ ...baseRequest, assetType: "kr_equity" });
    expect(a).not.toBe(b);
  });

  it("changes hash when dateRange changes", () => {
    const a = hashBacktestRequest(baseRequest);
    const b = hashBacktestRequest({
      ...baseRequest,
      dateRange: { from: "2026-02-01", to: "2026-04-01" },
    });
    expect(a).not.toBe(b);
  });

  it("changes hash when weightsVersion changes", () => {
    const a = hashBacktestRequest(baseRequest);
    const b = hashBacktestRequest({
      ...baseRequest,
      weightsVersion: "v2.1.0-baseline",
    });
    expect(a).not.toBe(b);
  });
});
