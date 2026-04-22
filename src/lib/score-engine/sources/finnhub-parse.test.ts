import { describe, expect, it } from "vitest";

import { parseFinnhubSentimentResponse } from "./finnhub-parse";

/**
 * Network-free tests for the Finnhub news-sentiment parser.
 * All fixtures are synthetic; no live key required.
 */

describe("parseFinnhubSentimentResponse", () => {
  it("parses a well-formed response and extracts raw fields", () => {
    const body = {
      buzz: { articlesInLastWeek: 52, buzz: 0.9, weeklyAverage: 58 },
      companyNewsScore: 0.62,
      sectorAverageBullishPercent: 0.58,
      sectorAverageNewsScore: 0.56,
      sentiment: { bearishPercent: 0.12, bullishPercent: 0.88 },
      symbol: "AAPL",
    };
    const result = parseFinnhubSentimentResponse("AAPL", body);

    expect(result.ticker).toBe("AAPL");
    expect(result.fetch_status).toBe("success");
    expect(result.bullishPercent).toBe(0.88);
    expect(result.bearishPercent).toBe(0.12);
    expect(result.companyNewsScore).toBe(0.62);
    expect(result.articleCount).toBe(52);
    expect(result.error).toBeUndefined();
  });

  it("returns partial when the sentiment object is missing (no articles)", () => {
    const body = {
      buzz: { articlesInLastWeek: 0, buzz: 0, weeklyAverage: 0 },
      companyNewsScore: 0,
      symbol: "SMALLCAP",
    };
    const result = parseFinnhubSentimentResponse("SMALLCAP", body);

    expect(result.fetch_status).toBe("partial");
    expect(result.bullishPercent).toBeNull();
    expect(result.bearishPercent).toBeNull();
    expect(result.articleCount).toBe(0);
    expect(result.error).toMatch(/no articles/i);
  });

  it("returns partial when sentiment is missing but buzz has articles", () => {
    const body = {
      buzz: { articlesInLastWeek: 10 },
      // Sentiment object absent entirely.
      symbol: "WEIRD",
    };
    const result = parseFinnhubSentimentResponse("WEIRD", body);

    expect(result.fetch_status).toBe("partial");
    expect(result.articleCount).toBe(10);
    expect(result.error).toMatch(/sentiment object missing/);
  });

  it("returns error on non-object body (null, string, number, array)", () => {
    expect(parseFinnhubSentimentResponse("AAPL", null).fetch_status).toBe(
      "error",
    );
    expect(parseFinnhubSentimentResponse("AAPL", "oops").fetch_status).toBe(
      "error",
    );
    expect(parseFinnhubSentimentResponse("AAPL", 42).fetch_status).toBe(
      "error",
    );
    expect(parseFinnhubSentimentResponse("AAPL", []).fetch_status).toBe(
      "error",
    );
  });

  it("returns error when body contains an explicit error string", () => {
    const result = parseFinnhubSentimentResponse("AAPL", {
      error: "Invalid API key",
    });
    expect(result.fetch_status).toBe("error");
    expect(result.error).toMatch(/Invalid API key/);
  });

  it("gracefully handles missing buzz (sets articleCount to 0)", () => {
    const body = {
      sentiment: { bearishPercent: 0.2, bullishPercent: 0.8 },
      companyNewsScore: 0.5,
      symbol: "AAPL",
    };
    const result = parseFinnhubSentimentResponse("AAPL", body);

    expect(result.fetch_status).toBe("success");
    expect(result.articleCount).toBe(0);
    expect(result.bullishPercent).toBe(0.8);
  });

  it("drops percent values outside [0, 1] to null (stale upstream guard)", () => {
    const body = {
      buzz: { articlesInLastWeek: 10 },
      sentiment: { bearishPercent: -0.1, bullishPercent: 1.5 },
      companyNewsScore: 0.4,
    };
    const result = parseFinnhubSentimentResponse("AAPL", body);

    // Both sentiment fields are out of range → treated as missing →
    // partial status with "sentiment missing" semantics.
    expect(result.bullishPercent).toBeNull();
    expect(result.bearishPercent).toBeNull();
    expect(result.fetch_status).toBe("partial");
  });

  it("treats non-finite companyNewsScore as null", () => {
    const body = {
      buzz: { articlesInLastWeek: 5 },
      sentiment: { bearishPercent: 0.3, bullishPercent: 0.7 },
      companyNewsScore: "not a number",
    };
    const result = parseFinnhubSentimentResponse("AAPL", body);
    expect(result.fetch_status).toBe("success");
    expect(result.companyNewsScore).toBeNull();
  });

  it("sets fetched_at to a parseable ISO string", () => {
    const result = parseFinnhubSentimentResponse("AAPL", {
      buzz: { articlesInLastWeek: 1 },
      sentiment: { bearishPercent: 0.1, bullishPercent: 0.9 },
      companyNewsScore: 0.8,
    });
    expect(() => new Date(result.fetched_at).toISOString()).not.toThrow();
    expect(new Date(result.fetched_at).toString()).not.toBe("Invalid Date");
  });
});
