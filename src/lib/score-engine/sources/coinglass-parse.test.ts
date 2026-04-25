import { describe, expect, it } from "vitest";

import { parseCoinGlassEtfFlowResponse } from "./coinglass-parse";

/**
 * Network-free tests for the BTC Spot ETF flow parser.
 *
 * The live upstream is `https://bitbo.io/treasuries/etf-flows/`
 * (verified 2026-04-25), an HTML page; the parser also still accepts
 * the legacy CoinGlass `{code, msg, data: [...]}` JSON shape for
 * regression coverage and future-proofing per the file-header
 * contract in `coinglass-parse.ts`.
 *
 * Fixtures are minimal hand-written representations — NOT real scraped
 * HTML — to avoid hard-coupling the test suite to live data and to
 * keep the diff lean.
 */

describe("parseCoinGlassEtfFlowResponse", () => {
  describe("Bitbo HTML shape", () => {
    it("parses a well-formed ETF flows table", () => {
      // Minimal representative table mirroring Bitbo's
      // /treasuries/etf-flows/ structure: Date column, several ETF
      // columns, then a Totals column. Values are in millions USD.
      const html = `
<html><body>
<table>
  <thead>
    <tr><th>Date</th><th>IBIT</th><th>FBTC</th><th>Totals</th></tr>
  </thead>
  <tbody>
    <tr><td>Apr 21, 2026</td><td>50.0</td><td>30.0</td><td>167.1</td></tr>
    <tr><td>Apr 22, 2026</td><td>-10.0</td><td>5.0</td><td>-16.9</td></tr>
    <tr><td>Apr 23, 2026</td><td>100.0</td><td>40.0</td><td>226.8</td></tr>
    <tr><td>Total</td><td>140.0</td><td>75.0</td><td>377.0</td></tr>
    <tr><td>Average</td><td>46.7</td><td>25.0</td><td>125.7</td></tr>
  </tbody>
</table>
</body></html>`;

      const result = parseCoinGlassEtfFlowResponse(html);

      expect(result.fetch_status).toBe("success");
      expect(result.observations).toHaveLength(3);
      expect(result.latest).toEqual({
        date: "2026-04-23",
        // 226.8M USD → 226_800_000 USD raw.
        netFlow: 226_800_000,
      });
      // Negative netFlow handled correctly.
      const apr22 = result.observations.find((o) => o.date === "2026-04-22");
      expect(apr22?.netFlow).toBe(-16_900_000);
    });

    it("skips non-trading days where Totals is `-`", () => {
      const html = `
<table>
  <tr><th>Date</th><th>Totals</th></tr>
  <tr><td>Apr 19, 2026</td><td>-</td></tr>
  <tr><td>Apr 20, 2026</td><td>-</td></tr>
  <tr><td>Apr 21, 2026</td><td>167.1</td></tr>
</table>`;

      const result = parseCoinGlassEtfFlowResponse(html);

      // Non-trading days are an EXPECTED skip (not malformed), so the
      // overall status stays "success" — same semantics as header-row
      // skips. Only 1 valid observation is extracted.
      expect(result.fetch_status).toBe("success");
      expect(result.observations).toHaveLength(1);
      expect(result.latest).toEqual({
        date: "2026-04-21",
        netFlow: 167_100_000,
      });
    });

    it("anchors on the LAST cell as Totals — does NOT walk left when Totals is `-`", () => {
      // Regression for a real-world failure mode: when Bitbo renders a
      // partial / non-trading day, the Totals cell is `-` while one or
      // more per-ETF columns still carry numeric values from the
      // previous day's render. A walk-left fallback would pick the
      // rightmost numeric per-ETF cell as Totals — producing a
      // ~10× wrong netFlow. The parser must skip the row instead.
      const html = `
<table>
  <tr><th>Date</th><th>IBIT</th><th>FBTC</th><th>Totals</th></tr>
  <tr><td>Apr 22, 2026</td><td>50.0</td><td>30.0</td><td>-</td></tr>
  <tr><td>Apr 23, 2026</td><td>100.0</td><td>40.0</td><td>226.8</td></tr>
</table>`;

      const result = parseCoinGlassEtfFlowResponse(html);

      // Apr 22 row must be SKIPPED — neither 50.0 (IBIT) nor 30.0
      // (FBTC) leak in as a fake Totals. Only Apr 23 survives.
      expect(result.fetch_status).toBe("success");
      expect(result.observations).toHaveLength(1);
      expect(result.observations[0]).toEqual({
        date: "2026-04-23",
        netFlow: 226_800_000,
      });
      // Extra paranoia: no row landed with a per-ETF-magnitude flow.
      expect(
        result.observations.some((o) => o.netFlow === 50_000_000),
      ).toBe(false);
      expect(
        result.observations.some((o) => o.netFlow === 30_000_000),
      ).toBe(false);
    });

    it("strips embedded tags and entity references inside cells", () => {
      const html = `
<table>
  <tr><th>Date</th><th>Totals</th></tr>
  <tr><td><span>Apr&nbsp;23, 2026</span></td><td><strong>226.8</strong></td></tr>
</table>`;

      const result = parseCoinGlassEtfFlowResponse(html);

      expect(result.fetch_status).toBe("success");
      expect(result.latest).toEqual({
        date: "2026-04-23",
        netFlow: 226_800_000,
      });
    });

    it("handles comma-thousands in numeric cells", () => {
      // Bitbo doesn't currently use comma-thousands but other ETF
      // mirrors do; the parser should be tolerant.
      const html = `
<table>
  <tr><th>Date</th><th>Totals</th></tr>
  <tr><td>Apr 23, 2026</td><td>1,226.8</td></tr>
</table>`;

      const result = parseCoinGlassEtfFlowResponse(html);

      expect(result.fetch_status).toBe("success");
      expect(result.latest?.netFlow).toBe(1_226_800_000);
    });

    it("returns error when no data rows match the date pattern", () => {
      // Cloudflare interstitial / markup overhaul scenario.
      const html = `<html><body><h1>Just a moment...</h1></body></html>`;

      const result = parseCoinGlassEtfFlowResponse(html);

      expect(result.fetch_status).toBe("error");
      expect(result.observations).toHaveLength(0);
      expect(result.error).toMatch(/no ETF-flow rows found/);
    });

    it("filters out summary rows (Total / Average / Maximum / Minimum)", () => {
      const html = `
<table>
  <tr><th>Date</th><th>Totals</th></tr>
  <tr><td>Apr 21, 2026</td><td>167.1</td></tr>
  <tr><td>Apr 22, 2026</td><td>-16.9</td></tr>
  <tr><td>Apr 23, 2026</td><td>226.8</td></tr>
  <tr><td>Total</td><td>377.0</td></tr>
  <tr><td>Average</td><td>125.7</td></tr>
  <tr><td>Maximum</td><td>226.8</td></tr>
  <tr><td>Minimum</td><td>-16.9</td></tr>
</table>`;

      const result = parseCoinGlassEtfFlowResponse(html);

      expect(result.fetch_status).toBe("success");
      // Summary rows must NOT leak into observations — their first
      // cell isn't a Mon DD, YYYY date so the date parser drops them.
      expect(result.observations).toHaveLength(3);
      expect(result.observations.map((o) => o.date)).toEqual([
        "2026-04-21",
        "2026-04-22",
        "2026-04-23",
      ]);
    });

    it("sorts observations chronologically even when HTML order is reversed", () => {
      // Bitbo currently renders newest-first in the DOM. The parser
      // must sort ASC so consumers get a stable chronological series.
      const html = `
<table>
  <tr><th>Date</th><th>Totals</th></tr>
  <tr><td>Apr 23, 2026</td><td>226.8</td></tr>
  <tr><td>Apr 22, 2026</td><td>-16.9</td></tr>
  <tr><td>Apr 21, 2026</td><td>167.1</td></tr>
</table>`;

      const result = parseCoinGlassEtfFlowResponse(html);

      expect(result.observations.map((o) => o.date)).toEqual([
        "2026-04-21",
        "2026-04-22",
        "2026-04-23",
      ]);
      expect(result.latest?.date).toBe("2026-04-23");
    });
  });

  describe("legacy CoinGlass JSON shape", () => {
    it("parses a well-formed response", () => {
      const body = {
        code: "0",
        msg: "success",
        data: [
          { date: "2026-04-20", netFlow: 100_000_000, totalFlow: 120_000_000 },
          { date: "2026-04-21", netFlow: 135_000_000, totalFlow: 155_000_000 },
          { date: "2026-04-22", netFlow: -25_000_000, totalFlow: 90_000_000 },
        ],
      };

      const result = parseCoinGlassEtfFlowResponse(body);

      expect(result.fetch_status).toBe("success");
      expect(result.observations).toHaveLength(3);
      expect(result.latest).toEqual({
        date: "2026-04-22",
        netFlow: -25_000_000,
      });
      // totalFlow is intentionally dropped — blueprint §4.1 specifies
      // 순유입 = netFlow only.
      const keys = Object.keys(result.observations[0]).sort();
      expect(keys).toEqual(["date", "netFlow"]);
    });

    it("returns partial when data[] is empty", () => {
      const result = parseCoinGlassEtfFlowResponse({ code: "0", data: [] });

      expect(result.fetch_status).toBe("partial");
      expect(result.observations).toHaveLength(0);
      expect(result.latest).toBeNull();
      expect(result.error).toMatch(/no observations after parsing/);
    });

    it('returns error when response code !== "0"', () => {
      const result = parseCoinGlassEtfFlowResponse({
        code: "30001",
        msg: "rate limit exceeded",
        data: [],
      });

      expect(result.fetch_status).toBe("error");
      expect(result.error).toMatch(/30001/);
      expect(result.error).toMatch(/rate limit exceeded/);
    });

    it("returns error when data is missing or not an array", () => {
      expect(
        parseCoinGlassEtfFlowResponse({ code: "0" }).fetch_status,
      ).toBe("error");
      expect(
        parseCoinGlassEtfFlowResponse({ code: "0", data: "not-an-array" })
          .fetch_status,
      ).toBe("error");
    });
  });

  describe("malformed inputs", () => {
    it("returns error on null / undefined", () => {
      expect(parseCoinGlassEtfFlowResponse(null).fetch_status).toBe("error");
      expect(parseCoinGlassEtfFlowResponse(undefined).fetch_status).toBe(
        "error",
      );
    });

    it("returns error on an array body (not a recognized shape)", () => {
      // The legacy JSON shape requires an envelope object; a top-level
      // array is therefore invalid.
      expect(parseCoinGlassEtfFlowResponse([]).fetch_status).toBe("error");
    });

    it("returns error on a non-string scalar (number)", () => {
      // Strings are routed to the HTML parser, so 42 is the only
      // remaining scalar that should fail.
      expect(parseCoinGlassEtfFlowResponse(42).fetch_status).toBe("error");
    });
  });
});
