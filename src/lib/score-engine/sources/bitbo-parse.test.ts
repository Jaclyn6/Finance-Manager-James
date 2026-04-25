import { describe, expect, it } from "vitest";

import { parseBitboResponse } from "./bitbo-parse";

/**
 * Network-free tests for the on-chain MVRV/SOPR parser.
 *
 * Synthetic payloads exercise the pure parser. The live upstream is
 * `https://api.bitcoin-data.com/v1/{mvrv-zscore,sopr}` (re-verified
 * 2026-04-25 — page returns the documented JSON shape from local; the
 * Vercel-side production failure is a hard 8/hr rate-limit surfaced
 * via HTTP 429 + `{"code":"RATE_LIMIT_HOUR_EXCEEDED"}`, NOT a shape
 * change. The fetcher in `bitbo.ts` now opts out of 429 retries via
 * `retryOnRateLimit:false` so the rate-limit hit propagates immediately
 * as `fetch_status:'error'` instead of draining more slots.)
 *
 * Fixtures below mirror BOTH the new bitcoin-data.com shape — top-level
 * array of `{d, unixTs, mvrvZscore|sopr}` — AND the legacy Bitbo
 * `{data: [{date, value}]}` wrapper, which the parser still accepts
 * as a regression-safety net per the file-header contract in
 * `bitbo-parse.ts`.
 */

describe("parseBitboResponse", () => {
  describe("bitcoin-data.com shape — top-level array", () => {
    it("parses a well-formed MVRV Z-Score array", () => {
      // unixTs values are seconds-since-epoch UTC midnight, derived
      // via `Math.floor(Date.UTC(2026, 3, dd) / 1000)` so the `d` and
      // `unixTs` columns agree (the parser prefers `d`, but a future
      // change that drops `d` would surface a fixture mismatch).
      const body = [
        { d: "2026-04-22", unixTs: 1776816000, mvrvZscore: 1.45 },
        { d: "2026-04-23", unixTs: 1776902400, mvrvZscore: 1.48 },
        { d: "2026-04-24", unixTs: 1776988800, mvrvZscore: 0.83 },
      ];

      const result = parseBitboResponse("mvrv-z-score", body);

      expect(result.metric).toBe("mvrv-z-score");
      expect(result.fetch_status).toBe("success");
      expect(result.observations).toHaveLength(3);
      expect(result.latest).toEqual({ date: "2026-04-24", value: 0.83 });
    });

    it("parses a well-formed SOPR array", () => {
      const body = [
        { d: "2026-04-23", unixTs: 1776902400, sopr: 0.9834 },
        { d: "2026-04-24", unixTs: 1776988800, sopr: 1.012 },
      ];

      const result = parseBitboResponse("sopr", body);

      expect(result.metric).toBe("sopr");
      expect(result.fetch_status).toBe("success");
      expect(result.latest).toEqual({ date: "2026-04-24", value: 1.012 });
    });

    it("derives date from unixTs when `d` is missing", () => {
      const body = [
        // 1776988800 = 2026-04-24 00:00:00 UTC (matches the real
        // bitcoin-data.com response observed 2026-04-25).
        { unixTs: 1776988800, mvrvZscore: 0.83 },
      ];

      const result = parseBitboResponse("mvrv-z-score", body);

      expect(result.fetch_status).toBe("success");
      expect(result.latest).toEqual({ date: "2026-04-24", value: 0.83 });
    });

    it("parses a single-object /last response", () => {
      // bitcoin-data.com `/v1/sopr/last` returns a bare object, not
      // an array. The parser detects the `d` key and treats it as a
      // one-element series.
      const body = { d: "2026-04-24", unixTs: 1776988800, sopr: 0.9834 };

      const result = parseBitboResponse("sopr", body);

      expect(result.fetch_status).toBe("success");
      expect(result.observations).toHaveLength(1);
      expect(result.latest).toEqual({ date: "2026-04-24", value: 0.9834 });
    });

    it("accepts string-typed metric values (some upstream APIs return floats as strings)", () => {
      // bitcoin-data.com's free tier publishes numbers, but the paid
      // tier and some mirrors return stringified floats. Be permissive.
      const body = [
        { d: "2026-04-23", mvrvZscore: "1.48" },
        { d: "2026-04-24", mvrvZscore: 0.83 },
      ];

      const result = parseBitboResponse("mvrv-z-score", body);

      expect(result.fetch_status).toBe("success");
      expect(result.observations).toHaveLength(2);
      expect(result.latest).toEqual({ date: "2026-04-24", value: 0.83 });
    });

    it("returns partial on empty top-level array", () => {
      const result = parseBitboResponse("mvrv-z-score", []);

      expect(result.fetch_status).toBe("partial");
      expect(result.observations).toHaveLength(0);
      expect(result.latest).toBeNull();
      expect(result.error).toMatch(/no observations after parsing/);
    });
  });

  describe("legacy Bitbo shape — {data: [...]}", () => {
    it("parses a well-formed MVRV Z-Score response", () => {
      const body = {
        metric: "mvrv-z-score",
        data: [
          { date: "2026-04-20", value: 1.2 },
          { date: "2026-04-21", value: 1.35 },
          { date: "2026-04-22", value: 1.45 },
        ],
      };

      const result = parseBitboResponse("mvrv-z-score", body);

      expect(result.metric).toBe("mvrv-z-score");
      expect(result.fetch_status).toBe("success");
      expect(result.observations).toHaveLength(3);
      expect(result.latest).toEqual({ date: "2026-04-22", value: 1.45 });
    });

    it("parses a well-formed SOPR response", () => {
      const body = {
        metric: "sopr",
        data: [
          { date: "2026-04-21", value: 0.98 },
          { date: "2026-04-22", value: 1.01 },
        ],
      };

      const result = parseBitboResponse("sopr", body);

      expect(result.metric).toBe("sopr");
      expect(result.fetch_status).toBe("success");
      expect(result.latest).toEqual({ date: "2026-04-22", value: 1.01 });
    });

    it("returns partial when data[] is empty", () => {
      const result = parseBitboResponse("mvrv-z-score", {
        metric: "mvrv-z-score",
        data: [],
      });

      expect(result.fetch_status).toBe("partial");
      expect(result.observations).toHaveLength(0);
      expect(result.latest).toBeNull();
      expect(result.error).toMatch(/no observations after parsing/);
    });
  });

  describe("malformed inputs", () => {
    it("rejects non-YYYY-MM-DD dates and unparseable timestamps", () => {
      // Postgres DATE safety — off-format strings would crash the whole
      // batch upsert with `invalid input syntax for type date`.
      const body = {
        metric: "sopr",
        data: [
          { date: "2026/04/22", value: 1.0 }, // wrong separator
          { date: "20260422", value: 1.0 }, // no separators
          { date: "2026-4-22", value: 1.0 }, // not zero-padded
          { date: "", value: 1.0 }, // empty
          { date: "2026-04-22T00:00:00Z", value: 1.0 }, // timestamp string
        ],
      };
      const result = parseBitboResponse("sopr", body);

      expect(result.observations).toHaveLength(0);
      expect(result.fetch_status).toBe("partial");
    });

    it("skips empty-string metric values without coercing to 0", () => {
      // `Number("")` returns 0 (finite!) — without an explicit
      // empty-string guard the parser would emit value:0 for a missing
      // upstream value, which fires false signals: SOPR<1 →
      // CAPITULATION, MVRV_Z≤0 → CRYPTO_UNDERVALUED. This regression
      // test pins the guard in extractValue.
      const body = [
        { d: "2026-04-23", mvrvZscore: "" },
        { d: "2026-04-24", mvrvZscore: "   " },
        { d: "2026-04-25", mvrvZscore: 0.83 },
      ];
      const result = parseBitboResponse("mvrv-z-score", body);

      expect(result.fetch_status).toBe("success");
      expect(result.observations).toHaveLength(1);
      expect(result.observations[0]).toEqual({
        date: "2026-04-25",
        value: 0.83,
      });
      // Extra paranoia: no entry with value:0 leaked through.
      expect(result.observations.some((o) => o.value === 0)).toBe(false);
    });

    it("skips malformed entries (null / NaN value) without killing the parse", () => {
      // String numerics are accepted by the new parser (see "string-typed
      // metric values" test above), but null / NaN / non-finite are not.
      const body = [
        { d: "2026-04-20", mvrvZscore: 1.2 },
        { d: "2026-04-22", mvrvZscore: null },
        { d: "2026-04-23", mvrvZscore: Number.NaN },
        { d: "2026-04-24", mvrvZscore: 1.6 },
      ];
      const result = parseBitboResponse("mvrv-z-score", body);

      expect(result.fetch_status).toBe("success");
      expect(result.observations).toHaveLength(2);
      expect(result.observations.map((o) => o.date)).toEqual([
        "2026-04-20",
        "2026-04-24",
      ]);
    });

    it("returns error on null/undefined/non-object scalar body", () => {
      expect(parseBitboResponse("sopr", null).fetch_status).toBe("error");
      expect(parseBitboResponse("sopr", undefined).fetch_status).toBe("error");
      expect(parseBitboResponse("sopr", "string").fetch_status).toBe("error");
      expect(parseBitboResponse("sopr", 42).fetch_status).toBe("error");
    });

    it("returns error when object body has no recognizable shape", () => {
      // Object without `data[]`, `d`, or `date` — can't be either shape.
      expect(
        parseBitboResponse("mvrv-z-score", { metric: "mvrv-z-score" })
          .fetch_status,
      ).toBe("error");
      expect(
        parseBitboResponse("sopr", { metric: "sopr", data: "not-an-array" })
          .fetch_status,
      ).toBe("error");
    });

    it("sorts observations chronologically even when upstream order is wrong", () => {
      const body = [
        { d: "2026-04-22", sopr: 1.05 },
        { d: "2026-04-20", sopr: 0.98 },
        { d: "2026-04-21", sopr: 1.01 },
      ];
      const result = parseBitboResponse("sopr", body);

      expect(result.observations.map((o) => o.date)).toEqual([
        "2026-04-20",
        "2026-04-21",
        "2026-04-22",
      ]);
      expect(result.latest?.date).toBe("2026-04-22");
    });
  });
});
