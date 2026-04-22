import { describe, expect, it } from "vitest";

import { redactSecretsFromErrorMessage } from "./_redact";

describe("redactSecretsFromErrorMessage", () => {
  it("redacts Alpha Vantage apikey query param", () => {
    const msg =
      "fetch failed: GET https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=SPY&apikey=ABCD1234SECRET ECONNRESET";
    expect(redactSecretsFromErrorMessage(msg)).toBe(
      "fetch failed: GET https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=SPY&apikey=REDACTED ECONNRESET",
    );
  });

  it("redacts Finnhub token query param", () => {
    const msg =
      "ENOTFOUND https://finnhub.io/api/v1/news-sentiment?symbol=AAPL&token=fh_live_SECRET_TOKEN_VALUE";
    expect(redactSecretsFromErrorMessage(msg)).toBe(
      "ENOTFOUND https://finnhub.io/api/v1/news-sentiment?symbol=AAPL&token=REDACTED",
    );
  });

  it("redacts when the secret is the first query param (?token=…)", () => {
    const msg = "timeout: https://api.example.com/x?token=abc123&other=ok";
    expect(redactSecretsFromErrorMessage(msg)).toBe(
      "timeout: https://api.example.com/x?token=REDACTED&other=ok",
    );
  });

  it("is idempotent on already-redacted messages", () => {
    const once =
      "fetch failed: https://api.example.com/x?apikey=REDACTED&other=ok";
    expect(redactSecretsFromErrorMessage(once)).toBe(once);
  });

  it("leaves messages without apikey/token query params untouched", () => {
    const msg = "fetch failed: https://bitbo.io/metrics/mvrv-z-score.json 503";
    expect(redactSecretsFromErrorMessage(msg)).toBe(msg);
  });

  it("handles case variation (TOKEN=…, ApiKey=…)", () => {
    const msg = "fetch failed: ?APIKEY=A1&TOKEN=B2";
    expect(redactSecretsFromErrorMessage(msg)).toBe(
      "fetch failed: ?APIKEY=REDACTED&TOKEN=REDACTED",
    );
  });
});
