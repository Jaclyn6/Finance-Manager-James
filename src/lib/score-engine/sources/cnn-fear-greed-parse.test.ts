import { describe, expect, it } from "vitest";

import { parseCnnFearGreedResponse } from "./cnn-fear-greed-parse";

/**
 * Network-free tests for the CNN F&G parser. All fixtures are
 * synthetic; no live request required. The response shape modelled
 * here is as of 2026-04-23 — if CNN changes it, these tests will
 * fail loudly, which is the right signal for the Step 7 cron author.
 */

describe("parseCnnFearGreedResponse", () => {
  it("parses a well-formed response, extracting latest + history (chronological ASC)", () => {
    const body = {
      fear_and_greed: {
        score: 42.5,
        rating: "fear",
        timestamp: "2026-04-23T12:00:00.000Z",
        previous_close: 45.2,
        previous_1_week: 50.1,
        previous_1_month: 55.3,
        previous_1_year: 48.7,
      },
      fear_and_greed_historical: {
        score: 42.5,
        rating: "fear",
        timestamp: "2026-04-23T12:00:00.000Z",
        // Include these out-of-order to verify we sort ASC.
        data: [
          { x: 1745336400000, y: 42.5, rating: "fear" }, // 2025-04-22
          { x: 1745250000000, y: 43.2, rating: "fear" }, // 2025-04-21
          { x: 1745422800000, y: 41.8, rating: "fear" }, // 2025-04-23
        ],
      },
      // Six more sub-indicators CNN returns but we don't consume.
      market_momentum_sp500: { score: 50, rating: "neutral" },
      stock_price_strength: { score: 55, rating: "neutral" },
    };
    const result = parseCnnFearGreedResponse(body);

    expect(result.fetch_status).toBe("success");
    expect(result.latest).toEqual({
      date: "2026-04-23",
      score: 42.5,
      rating: "fear",
    });
    // History is sorted ASC regardless of upstream order.
    expect(result.history.map((o) => o.date)).toEqual([
      "2025-04-21",
      "2025-04-22",
      "2025-04-23",
    ]);
    expect(result.history[0]).toEqual({
      date: "2025-04-21",
      score: 43.2,
      rating: "fear",
    });
  });

  it("converts history x=unix_ms timestamps to YYYY-MM-DD UTC", () => {
    const body = {
      fear_and_greed: {
        score: 50,
        rating: "neutral",
        timestamp: "2026-04-23T12:00:00.000Z",
      },
      fear_and_greed_historical: {
        data: [
          // 1735689600000 == 2025-01-01T00:00:00Z
          { x: 1735689600000, y: 50, rating: "neutral" },
          // 1700000000000 == 2023-11-14T22:13:20Z
          { x: 1700000000000, y: 20, rating: "extreme_fear" },
        ],
      },
    };
    const result = parseCnnFearGreedResponse(body);

    expect(result.fetch_status).toBe("success");
    expect(result.history).toEqual([
      { date: "2023-11-14", score: 20, rating: "extreme_fear" },
      { date: "2025-01-01", score: 50, rating: "neutral" },
    ]);
  });

  it("returns partial when fear_and_greed is missing but history is valid", () => {
    const body = {
      // fear_and_greed intentionally omitted
      fear_and_greed_historical: {
        data: [
          { x: 1745250000000, y: 43.2, rating: "fear" },
          { x: 1745336400000, y: 42.5, rating: "fear" },
        ],
      },
    };
    const result = parseCnnFearGreedResponse(body);

    expect(result.fetch_status).toBe("partial");
    expect(result.latest).toBeNull();
    expect(result.history).toHaveLength(2);
    expect(result.error).toMatch(/fear_and_greed/);
  });

  it("returns partial when history is missing but latest is valid", () => {
    const body = {
      fear_and_greed: {
        score: 42.5,
        rating: "fear",
        timestamp: "2026-04-23T12:00:00.000Z",
      },
      // fear_and_greed_historical intentionally omitted
    };
    const result = parseCnnFearGreedResponse(body);

    expect(result.fetch_status).toBe("partial");
    expect(result.latest).not.toBeNull();
    expect(result.latest?.date).toBe("2026-04-23");
    expect(result.history).toEqual([]);
    expect(result.error).toMatch(/historical/);
  });

  it("returns error when both latest and history are missing", () => {
    const body = {
      market_momentum_sp500: { score: 50, rating: "neutral" },
    };
    const result = parseCnnFearGreedResponse(body);

    expect(result.fetch_status).toBe("error");
    expect(result.latest).toBeNull();
    expect(result.history).toEqual([]);
    expect(result.error).toMatch(/missing both/i);
  });

  it("returns error on non-object body (null, string, number, array)", () => {
    expect(parseCnnFearGreedResponse(null).fetch_status).toBe("error");
    expect(parseCnnFearGreedResponse("oops").fetch_status).toBe("error");
    expect(parseCnnFearGreedResponse(42).fetch_status).toBe("error");
    expect(parseCnnFearGreedResponse([]).fetch_status).toBe("error");
  });

  it("rejects malformed rating values (guard against CNN enum drift)", () => {
    const body = {
      fear_and_greed: {
        score: 42.5,
        // CNN hypothetically changes rating to a new value we don't know.
        rating: "slight_anxiety",
        timestamp: "2026-04-23T12:00:00.000Z",
      },
      fear_and_greed_historical: {
        data: [
          { x: 1745250000000, y: 43.2, rating: "moderately_fearful" },
          { x: 1745336400000, y: 42.5, rating: "fear" }, // one good row
        ],
      },
    };
    const result = parseCnnFearGreedResponse(body);

    // Latest rejected (unknown rating) → null. History: one good row
    // survives, one dropped. Since latest is null but history is
    // non-empty, we get partial with the fear_and_greed-missing error.
    expect(result.latest).toBeNull();
    expect(result.history).toHaveLength(1);
    expect(result.history[0].rating).toBe("fear");
    expect(result.fetch_status).toBe("partial");
  });

  it("rejects scores outside the 0-100 range", () => {
    const body = {
      fear_and_greed: {
        score: 150, // out of range → latest null
        rating: "extreme_greed",
        timestamp: "2026-04-23T12:00:00.000Z",
      },
      fear_and_greed_historical: {
        data: [
          { x: 1745250000000, y: -5, rating: "extreme_fear" }, // dropped
          { x: 1745336400000, y: 42.5, rating: "fear" }, // kept
          { x: 1745422800000, y: 200, rating: "extreme_greed" }, // dropped
        ],
      },
    };
    const result = parseCnnFearGreedResponse(body);

    expect(result.latest).toBeNull();
    expect(result.history).toHaveLength(1);
    expect(result.history[0].score).toBe(42.5);
  });

  it("ignores previous_close / previous_1_week / etc. on the latest reading", () => {
    const body = {
      fear_and_greed: {
        score: 42.5,
        rating: "fear",
        timestamp: "2026-04-23T12:00:00.000Z",
        previous_close: 45.2,
        previous_1_week: 50.1,
        previous_1_month: 55.3,
        previous_1_year: 48.7,
      },
      fear_and_greed_historical: {
        data: [{ x: 1745422800000, y: 41.8, rating: "fear" }],
      },
    };
    const result = parseCnnFearGreedResponse(body);

    expect(result.fetch_status).toBe("success");
    // The `latest` output shape contains only date/score/rating; the
    // previous_* fields are intentionally dropped.
    expect(result.latest).toEqual({
      date: "2026-04-23",
      score: 42.5,
      rating: "fear",
    });
    expect(Object.keys(result.latest!).sort()).toEqual([
      "date",
      "rating",
      "score",
    ]);
  });

  it("drops malformed history rows but keeps valid siblings (partial)", () => {
    const body = {
      fear_and_greed: {
        score: 42.5,
        rating: "fear",
        timestamp: "2026-04-23T12:00:00.000Z",
      },
      fear_and_greed_historical: {
        data: [
          { x: 1745250000000, y: 43.2, rating: "fear" }, // good
          { x: "not a number", y: 42.5, rating: "fear" }, // bad x
          { x: 1745336400000, y: "oops", rating: "fear" }, // bad y
          { x: 1745422800000, y: 41.8 }, // missing rating
          null, // not an object
          { x: 1745509200000, y: 41.0, rating: "fear" }, // good
        ],
      },
    };
    const result = parseCnnFearGreedResponse(body);

    // Some rows dropped → partial status regardless of latest success.
    expect(result.fetch_status).toBe("partial");
    expect(result.history).toHaveLength(2);
    expect(result.error).toMatch(/dropped/i);
  });

  it("sets fetched_at to a parseable ISO string", () => {
    const result = parseCnnFearGreedResponse({
      fear_and_greed: {
        score: 42.5,
        rating: "fear",
        timestamp: "2026-04-23T12:00:00.000Z",
      },
      fear_and_greed_historical: {
        data: [{ x: 1745422800000, y: 41.8, rating: "fear" }],
      },
    });
    expect(() => new Date(result.fetched_at).toISOString()).not.toThrow();
    expect(new Date(result.fetched_at).toString()).not.toBe("Invalid Date");
  });
});
