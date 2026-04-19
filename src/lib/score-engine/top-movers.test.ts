import { describe, expect, it } from "vitest";

import { computeTopMovers } from "./top-movers";
import type { CompositeResult } from "./types";

function mkContrib(map: Record<string, number>): CompositeResult["contributing"] {
  // Score / weight fields are not used by computeTopMovers but the
  // contract type requires them, so stub with plausible values.
  const out: CompositeResult["contributing"] = {};
  for (const [key, contribution] of Object.entries(map)) {
    out[key] = { score: 50, weight: 0.2, contribution };
  }
  return out;
}

describe("computeTopMovers", () => {
  it("returns [] when prior is null (first-ever-snapshot defense)", () => {
    const current = mkContrib({ VIXCLS: 15, DGS10: 10 });
    // The cron actually skips changelog writes when there's no prior,
    // but the function's own behavior for null prior should be either
    // empty or all-keys-as-new. We use the "treat prior as empty" path,
    // which yields every current key with delta = current_contribution.
    const result = computeTopMovers(current, null);
    expect(result).toHaveLength(2);
    expect(result[0].key).toBe("VIXCLS"); // larger |delta|
    expect(result[0].delta).toBe(15);
    expect(result[1].key).toBe("DGS10");
  });

  it("ranks by |delta| descending", () => {
    const current = mkContrib({ a: 10, b: 12, c: 8 });
    const prior = mkContrib({ a: 5, b: 3, c: 8.5 });
    // deltas: a=+5, b=+9, c=-0.5
    const result = computeTopMovers(current, prior);
    expect(result.map((m) => m.key)).toEqual(["b", "a", "c"]);
    expect(result[0].delta).toBe(9);
  });

  it("respects the limit parameter", () => {
    const current = mkContrib({ a: 10, b: 20, c: 30, d: 40 });
    const prior = mkContrib({});
    const result = computeTopMovers(current, prior, 2);
    expect(result).toHaveLength(2);
    expect(result[0].key).toBe("d");
    expect(result[1].key).toBe("c");
  });

  it("defaults limit to 3", () => {
    const current = mkContrib({ a: 1, b: 2, c: 3, d: 4, e: 5 });
    const result = computeTopMovers(current, mkContrib({}));
    expect(result).toHaveLength(3);
  });

  it("treats unchanged keys as non-movers (filters delta=0)", () => {
    const current = mkContrib({ a: 5, b: 10 });
    const prior = mkContrib({ a: 5, b: 8 });
    const result = computeTopMovers(current, prior);
    expect(result.map((m) => m.key)).toEqual(["b"]); // only b moved
  });

  it("handles newly-added indicators (prior missing → prior=0)", () => {
    const current = mkContrib({ a: 10, b: 5 });
    const prior = mkContrib({ a: 10 }); // b is new
    const result = computeTopMovers(current, prior);
    expect(result).toEqual([
      {
        key: "b",
        prior_contribution: 0,
        current_contribution: 5,
        delta: 5,
      },
    ]);
  });

  it("handles dropped indicators (current missing → current=0)", () => {
    const current = mkContrib({ a: 10 });
    const prior = mkContrib({ a: 10, b: 5 }); // b dropped
    const result = computeTopMovers(current, prior);
    expect(result).toEqual([
      {
        key: "b",
        prior_contribution: 5,
        current_contribution: 0,
        delta: -5,
      },
    ]);
  });

  it("tolerates malformed JSONB prior (returns current-only movers)", () => {
    const current = mkContrib({ a: 10 });
    const result = computeTopMovers(current, "not an object");
    expect(result).toHaveLength(1);
    expect(result[0].delta).toBe(10);
  });

  it("tolerates prior entries with non-numeric contribution (drops them)", () => {
    const current = mkContrib({ a: 10 });
    const prior = { a: { contribution: "oops" } }; // contribution is a string, not number
    const result = computeTopMovers(current, prior);
    // The prior.a parse drops → prior effectively empty → delta=10.
    expect(result[0].delta).toBe(10);
  });

  it("returns [] on non-positive limit", () => {
    expect(computeTopMovers(mkContrib({ a: 1 }), null, 0)).toEqual([]);
    expect(computeTopMovers(mkContrib({ a: 1 }), null, -1)).toEqual([]);
    expect(computeTopMovers(mkContrib({ a: 1 }), null, Number.NaN)).toEqual([]);
  });
});
