import { describe, expect, it } from "vitest";

import {
  aggregateTickerSentiment,
  makeAvNewsError,
  newsSentimentToScore,
  parseAlphaVantageNewsResponse,
  type AlphaVantageFeedItem,
} from "./alpha-vantage-news-parse";

/**
 * Network-free tests for the Alpha Vantage NEWS_SENTIMENT parser +
 * per-ticker weighted-mean aggregator. All fixtures are synthetic; no
 * live key required.
 */

function makeFeedItem(
  partial: Partial<AlphaVantageFeedItem> & {
    ticker_sentiment: AlphaVantageFeedItem["ticker_sentiment"];
  },
): AlphaVantageFeedItem {
  return {
    title: "Some headline",
    url: "https://example.com/article",
    time_published: "20260423T161740",
    source: "ExampleWire",
    overall_sentiment_score: 0.1,
    overall_sentiment_label: "Neutral",
    ...partial,
  };
}

describe("parseAlphaVantageNewsResponse", () => {
  it("parses a well-formed multi-ticker response with per-ticker aggregation", () => {
    const body = {
      items: "2",
      sentiment_score_definition: "x <= -0.35: Bearish; ...",
      relevance_score_definition: "0 < x <= 1, ...",
      feed: [
        {
          title: "Apple earnings beat",
          url: "https://example.com/a",
          time_published: "20260423T161740",
          source: "Reuters",
          overall_sentiment_score: 0.42,
          overall_sentiment_label: "Somewhat-Bullish",
          ticker_sentiment: [
            {
              ticker: "AAPL",
              relevance_score: "0.9",
              ticker_sentiment_score: "0.5",
              ticker_sentiment_label: "Somewhat-Bullish",
            },
            {
              ticker: "MSFT",
              relevance_score: "0.3",
              ticker_sentiment_score: "0.1",
              ticker_sentiment_label: "Neutral",
            },
          ],
        },
        {
          title: "Microsoft cloud guidance",
          url: "https://example.com/b",
          time_published: "20260423T120000",
          source: "Bloomberg",
          overall_sentiment_score: 0.25,
          overall_sentiment_label: "Somewhat-Bullish",
          ticker_sentiment: [
            {
              ticker: "MSFT",
              relevance_score: "0.7",
              ticker_sentiment_score: "0.3",
              ticker_sentiment_label: "Somewhat-Bullish",
            },
          ],
        },
      ],
    };

    const result = parseAlphaVantageNewsResponse(["AAPL", "MSFT"], body);

    expect(result.fetch_status).toBe("success");
    expect(result.feed).toHaveLength(2);
    expect(result.sentiment_score_definition).toMatch(/Bearish/);

    // AAPL: one article, weighted mean = 0.5
    expect(result.aggregates["AAPL"].weightedMeanScore).toBeCloseTo(0.5, 6);
    expect(result.aggregates["AAPL"].articleCount).toBe(1);

    // MSFT: two articles → (0.1*0.3 + 0.3*0.7) / (0.3+0.7) = 0.24
    expect(result.aggregates["MSFT"].weightedMeanScore).toBeCloseTo(0.24, 6);
    expect(result.aggregates["MSFT"].articleCount).toBe(2);
  });

  it("computes the documented weighted-mean example correctly", () => {
    const feed: AlphaVantageFeedItem[] = [
      makeFeedItem({
        ticker_sentiment: [
          {
            ticker: "AAPL",
            relevance_score: 1.0,
            ticker_sentiment_score: 0.5,
            ticker_sentiment_label: "Bullish",
          },
        ],
      }),
      makeFeedItem({
        ticker_sentiment: [
          {
            ticker: "AAPL",
            relevance_score: 0.2,
            ticker_sentiment_score: -0.3,
            ticker_sentiment_label: "Bearish",
          },
        ],
      }),
    ];

    const agg = aggregateTickerSentiment(feed, "AAPL");
    // (0.5 * 1.0 + -0.3 * 0.2) / (1.0 + 0.2) = 0.44 / 1.2 ≈ 0.3667
    expect(agg.weightedMeanScore).toBeCloseTo(0.3667, 3);
    expect(agg.articleCount).toBe(2);
  });

  it("newsSentimentToScore maps [-1, 1] → [0, 100] symmetrically and clamps", () => {
    expect(newsSentimentToScore(-1)).toBe(0);
    expect(newsSentimentToScore(0)).toBe(50);
    expect(newsSentimentToScore(1)).toBe(100);
    expect(newsSentimentToScore(null)).toBe(50);
    // Clamp out-of-range
    expect(newsSentimentToScore(-1.5)).toBe(0);
    expect(newsSentimentToScore(2)).toBe(100);
    // Non-finite collapses to neutral 50
    expect(newsSentimentToScore(Number.NaN)).toBe(50);
    expect(newsSentimentToScore(Number.POSITIVE_INFINITY)).toBe(50);
  });

  it("returns aggregate with null score + 0 count when ticker is missing from feed", () => {
    const body = {
      feed: [
        {
          title: "Unrelated story",
          time_published: "20260423T000000",
          ticker_sentiment: [
            {
              ticker: "TSLA",
              relevance_score: "0.6",
              ticker_sentiment_score: "0.2",
              ticker_sentiment_label: "Neutral",
            },
          ],
        },
      ],
    };
    const result = parseAlphaVantageNewsResponse(["AAPL", "TSLA"], body);
    expect(result.fetch_status).toBe("success");
    expect(result.aggregates["AAPL"].weightedMeanScore).toBeNull();
    expect(result.aggregates["AAPL"].articleCount).toBe(0);
    expect(result.aggregates["TSLA"].articleCount).toBe(1);
  });

  it("rate-limit body with Information string → error result", () => {
    const result = parseAlphaVantageNewsResponse(["AAPL"], {
      Information:
        "Thank you for using Alpha Vantage! Our standard API rate limit is ...",
    });
    expect(result.fetch_status).toBe("error");
    expect(result.error).toMatch(/rate limit/i);
    expect(result.aggregates["AAPL"].weightedMeanScore).toBeNull();
  });

  it("rate-limit body with Note string → error result", () => {
    const result = parseAlphaVantageNewsResponse(["AAPL"], {
      Note: "API call frequency is 5 calls per minute and 25 calls per day.",
    });
    expect(result.fetch_status).toBe("error");
    expect(result.error).toMatch(/note|rate limit/i);
  });

  it("body with Error Message string → error result", () => {
    const result = parseAlphaVantageNewsResponse(["AAPL"], {
      "Error Message": "Invalid API call. Please retry or visit the docs.",
    });
    expect(result.fetch_status).toBe("error");
    expect(result.error).toMatch(/Invalid API call/);
  });

  it("empty feed array without rate-limit shape → partial", () => {
    const result = parseAlphaVantageNewsResponse(["AAPL"], { feed: [] });
    expect(result.fetch_status).toBe("partial");
    expect(result.feed).toEqual([]);
    expect(result.aggregates["AAPL"].articleCount).toBe(0);
    expect(result.error).toMatch(/empty/i);
  });

  it("non-object body (null, string, number, array) → error", () => {
    expect(parseAlphaVantageNewsResponse(["AAPL"], null).fetch_status).toBe(
      "error",
    );
    expect(parseAlphaVantageNewsResponse(["AAPL"], "oops").fetch_status).toBe(
      "error",
    );
    expect(parseAlphaVantageNewsResponse(["AAPL"], 42).fetch_status).toBe(
      "error",
    );
    expect(parseAlphaVantageNewsResponse(["AAPL"], []).fetch_status).toBe(
      "error",
    );
  });

  it("skips article with missing ticker_sentiment array without failing parse", () => {
    const body = {
      feed: [
        {
          title: "Market-wide piece",
          time_published: "20260423T120000",
          // ticker_sentiment absent entirely
        },
        {
          title: "Apple piece",
          time_published: "20260423T130000",
          ticker_sentiment: [
            {
              ticker: "AAPL",
              relevance_score: "0.5",
              ticker_sentiment_score: "0.4",
            },
          ],
        },
      ],
    };
    const result = parseAlphaVantageNewsResponse(["AAPL"], body);
    expect(result.fetch_status).toBe("success");
    // Only the AAPL article survived the per-item filter.
    expect(result.feed).toHaveLength(1);
    expect(result.feed[0].title).toBe("Apple piece");
    expect(result.aggregates["AAPL"].articleCount).toBe(1);
  });

  it("coerces string-numeric ticker_sentiment_score via Number", () => {
    const body = {
      feed: [
        {
          title: "AAPL story",
          time_published: "20260423T120000",
          ticker_sentiment: [
            {
              ticker: "AAPL",
              relevance_score: "0.8",
              ticker_sentiment_score: "0.2",
            },
          ],
        },
      ],
    };
    const result = parseAlphaVantageNewsResponse(["AAPL"], body);
    expect(result.aggregates["AAPL"].weightedMeanScore).toBeCloseTo(0.2, 6);
  });

  it("skips ticker-sentiment entry with non-numeric sentiment score (keeps article)", () => {
    const body = {
      feed: [
        {
          title: "Multi-mention story",
          time_published: "20260423T120000",
          ticker_sentiment: [
            {
              ticker: "AAPL",
              relevance_score: "0.8",
              ticker_sentiment_score: "not-a-number",
            },
            {
              ticker: "MSFT",
              relevance_score: "0.5",
              ticker_sentiment_score: "0.3",
            },
          ],
        },
      ],
    };
    const result = parseAlphaVantageNewsResponse(["AAPL", "MSFT"], body);
    // AAPL entry was invalid → no mention count for AAPL.
    expect(result.aggregates["AAPL"].weightedMeanScore).toBeNull();
    expect(result.aggregates["AAPL"].articleCount).toBe(0);
    // MSFT entry valid → contributes 1 article.
    expect(result.aggregates["MSFT"].weightedMeanScore).toBeCloseTo(0.3, 6);
    expect(result.aggregates["MSFT"].articleCount).toBe(1);
    // Article itself survived.
    expect(result.feed).toHaveLength(1);
  });

  it("drops zero-relevance entry (division-by-zero guard)", () => {
    const body = {
      feed: [
        {
          title: "Passing mention",
          time_published: "20260423T120000",
          ticker_sentiment: [
            {
              ticker: "AAPL",
              relevance_score: "0",
              ticker_sentiment_score: "0.8",
            },
          ],
        },
      ],
    };
    const result = parseAlphaVantageNewsResponse(["AAPL"], body);
    expect(result.aggregates["AAPL"].weightedMeanScore).toBeNull();
    expect(result.aggregates["AAPL"].articleCount).toBe(0);
  });

  it("populates aggregates map for every requested ticker even when feed covers none", () => {
    const body = {
      feed: [
        {
          title: "Off-scope story",
          time_published: "20260423T120000",
          ticker_sentiment: [
            {
              ticker: "XOM",
              relevance_score: "0.5",
              ticker_sentiment_score: "0.1",
            },
          ],
        },
      ],
    };
    const result = parseAlphaVantageNewsResponse(
      ["SPY", "QQQ", "NVDA", "AAPL"],
      body,
    );
    for (const t of ["SPY", "QQQ", "NVDA", "AAPL"]) {
      expect(result.aggregates[t]).toBeDefined();
      expect(result.aggregates[t].weightedMeanScore).toBeNull();
      expect(result.aggregates[t].articleCount).toBe(0);
    }
  });

  it("skips article missing required title/time_published fields", () => {
    const body = {
      feed: [
        {
          // No title
          time_published: "20260423T120000",
          ticker_sentiment: [
            {
              ticker: "AAPL",
              relevance_score: "0.5",
              ticker_sentiment_score: "0.3",
            },
          ],
        },
        {
          title: "Has title",
          time_published: "20260423T130000",
          ticker_sentiment: [
            {
              ticker: "AAPL",
              relevance_score: "0.6",
              ticker_sentiment_score: "0.4",
            },
          ],
        },
      ],
    };
    const result = parseAlphaVantageNewsResponse(["AAPL"], body);
    expect(result.feed).toHaveLength(1);
    expect(result.aggregates["AAPL"].articleCount).toBe(1);
  });

  it("sets fetched_at to a parseable ISO string", () => {
    const result = parseAlphaVantageNewsResponse(["AAPL"], { feed: [] });
    expect(() => new Date(result.fetched_at).toISOString()).not.toThrow();
    expect(new Date(result.fetched_at).toString()).not.toBe("Invalid Date");
  });

  it("preserves sentiment_score_definition on both success and partial", () => {
    const definition = "x <= -0.35: Bearish; ...";
    const successResult = parseAlphaVantageNewsResponse(["AAPL"], {
      sentiment_score_definition: definition,
      feed: [
        {
          title: "t",
          time_published: "20260423T000000",
          ticker_sentiment: [
            {
              ticker: "AAPL",
              relevance_score: "0.5",
              ticker_sentiment_score: "0.2",
            },
          ],
        },
      ],
    });
    expect(successResult.sentiment_score_definition).toBe(definition);

    const partialResult = parseAlphaVantageNewsResponse(["AAPL"], {
      sentiment_score_definition: definition,
      feed: [],
    });
    expect(partialResult.sentiment_score_definition).toBe(definition);
  });

  it("makeAvNewsError returns aggregates entry for every requested ticker", () => {
    const result = makeAvNewsError(["AAPL", "MSFT"], "boom");
    expect(result.fetch_status).toBe("error");
    expect(result.error).toBe("boom");
    expect(result.aggregates["AAPL"].weightedMeanScore).toBeNull();
    expect(result.aggregates["MSFT"].weightedMeanScore).toBeNull();
    expect(result.aggregates["AAPL"].articleCount).toBe(0);
  });
});
