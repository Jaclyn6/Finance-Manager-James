import { describe, expect, it } from "vitest";

import type { BacktestRequest } from "./backtest";
import { canonicalSha256Hex, hashBacktestRequest } from "./backtest-hash";

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

  it("differentiates by inline customWeightsPayload (collision-resistant)", () => {
    // Two requests share the same `weightsVersion` stamp (the engine
    // would normally produce different stamps for different payloads,
    // but the lossy 8-char suffix can collide). The hash MUST still
    // differentiate them — that is the whole point of including
    // customWeightsPayload in the canonical input.
    const stamped = { ...baseRequest, weightsVersion: "custom-deadbeef" };
    const hashA = hashBacktestRequest(stamped, {
      customWeightsPayload: { us_equity: { macro: 50, technical: 50 } },
    });
    const hashB = hashBacktestRequest(stamped, {
      customWeightsPayload: { us_equity: { macro: 30, technical: 70 } },
    });
    expect(hashA).not.toBe(hashB);
  });

  it("treats missing/null customWeightsPayload as the no-extra case", () => {
    expect(hashBacktestRequest(baseRequest)).toBe(
      hashBacktestRequest(baseRequest, { customWeightsPayload: null }),
    );
    expect(hashBacktestRequest(baseRequest)).toBe(
      hashBacktestRequest(baseRequest, { customWeightsPayload: undefined }),
    );
  });

  it("hash is independent of customWeightsPayload key order", () => {
    const stamped = { ...baseRequest, weightsVersion: "custom-canonical" };
    const a = hashBacktestRequest(stamped, {
      customWeightsPayload: { us_equity: { macro: 50, technical: 50 } },
    });
    const b = hashBacktestRequest(stamped, {
      customWeightsPayload: { us_equity: { technical: 50, macro: 50 } },
    });
    expect(a).toBe(b);
  });
});

describe("canonicalSha256Hex", () => {
  it("returns a 64-char hex digest", () => {
    expect(canonicalSha256Hex({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is key-order independent", () => {
    expect(canonicalSha256Hex({ a: 1, b: 2 })).toBe(
      canonicalSha256Hex({ b: 2, a: 1 }),
    );
  });

  it("differentiates by value", () => {
    expect(canonicalSha256Hex({ a: 1 })).not.toBe(canonicalSha256Hex({ a: 2 }));
  });
});
