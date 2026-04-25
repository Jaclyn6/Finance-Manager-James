import { describe, expect, it } from "vitest";

import { parseCoinGlassEtfFlowResponse } from "./coinglass-parse";

/**
 * Network-free tests for the BTC Spot ETF flow parser.
 *
 * The live upstream is `https://farside.co.uk/btc/` (verified
 * 2026-04-25), an HTML page; the parser also still accepts the legacy
 * Bitbo `Mon DD, YYYY` date format for fixture continuity and the
 * legacy CoinGlass `{code, msg, data: [...]}` JSON shape for
 * regression coverage / future-proofing per the file-header contract
 * in `coinglass-parse.ts`.
 *
 * Fixtures are minimal hand-written representations — NOT real scraped
 * HTML — to avoid hard-coupling the test suite to live data and to
 * keep the diff lean. The Farside fixtures mirror the real markup:
 * `<td><span class="tabletext">DATE</span></td>` for dates, and
 * `<td><div align="right"><span class="tabletext"><span class="redFont">(VALUE)</span></span></div></td>`
 * for negative numbers.
 */

describe("parseCoinGlassEtfFlowResponse", () => {
  describe("Farside HTML shape", () => {
    it("parses a well-formed ETF flows table with mixed positives and parenthesized negatives", () => {
      // Mirrors Farside's real markup: 3-row thead (icons / ticker /
      // fee), then `<tbody>` with one `<tr>` per trading day. Negative
      // net-flow days are wrapped in `<span class="redFont">(X)</span>`
      // (accountancy parentheses), positives are bare numbers.
      const html = `
<html><body>
<table class="etf">
  <thead>
    <tr><th></th><th><img alt="Blackrock"></th><th><img alt="Fidelity"></th><th>Total</th></tr>
    <tr><th></th><th>IBIT</th><th>FBTC</th><th></th></tr>
    <tr><th>Fee</th><th>0.25%</th><th>0.25%</th><th></th></tr>
  </thead>
  <tbody>
    <tr>
      <td><span class="tabletext">21 Apr 2026</span></td>
      <td><div align="right"><span class="tabletext">50.0</span></div></td>
      <td><div align="right"><span class="tabletext">30.0</span></div></td>
      <td><div align="right"><span class="tabletext">167.1</span></div></td>
    </tr>
    <tr>
      <td><span class="tabletext">22 Apr 2026</span></td>
      <td><div align="right"><span class="tabletext"><span class="redFont">(10.0)</span></span></div></td>
      <td><div align="right"><span class="tabletext">5.0</span></div></td>
      <td><div align="right"><span class="tabletext"><span class="redFont">(16.9)</span></span></div></td>
    </tr>
    <tr>
      <td><span class="tabletext">23 Apr 2026</span></td>
      <td><div align="right"><span class="tabletext">100.0</span></div></td>
      <td><div align="right"><span class="tabletext">40.0</span></div></td>
      <td><div align="right"><span class="tabletext">226.8</span></div></td>
    </tr>
    <tr><td>Average</td><td></td><td></td><td>125.7</td></tr>
    <tr><td>Total</td><td></td><td></td><td>377.0</td></tr>
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
      // CRITICAL: parenthesized-negative netFlow handled correctly.
      // Without the (X)→-X branch in parseSignedDecimal, this row
      // would be silently dropped, biasing the 90d z-score upward.
      const apr22 = result.observations.find((o) => o.date === "2026-04-22");
      expect(apr22?.netFlow).toBe(-16_900_000);
    });

    it("converts every accountancy-parenthesis form to a real negative", () => {
      // Tight unit on the (X)→-X branch — covers integer, decimal,
      // comma-thousands, and whitespace-padded variants.
      const html = `
<table>
  <tr><td>01 Jan 2026</td><td>(50)</td></tr>
  <tr><td>02 Jan 2026</td><td>(50.5)</td></tr>
  <tr><td>03 Jan 2026</td><td>(1,234.5)</td></tr>
  <tr><td>04 Jan 2026</td><td> ( 50 ) </td></tr>
</table>`;

      const result = parseCoinGlassEtfFlowResponse(html);

      expect(result.fetch_status).toBe("success");
      expect(result.observations).toHaveLength(4);
      expect(result.observations.map((o) => o.netFlow)).toEqual([
        -50_000_000,
        -50_500_000,
        -1_234_500_000,
        -50_000_000,
      ]);
    });

    it("skips non-trading days where Totals is `-`", () => {
      const html = `
<table>
  <tr><th>Date</th><th>Total</th></tr>
  <tr><td>19 Apr 2026</td><td>-</td></tr>
  <tr><td>20 Apr 2026</td><td>-</td></tr>
  <tr><td>21 Apr 2026</td><td>167.1</td></tr>
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
      // Regression for a real-world failure mode: when Farside renders
      // a partial / non-trading day, the Total cell is `-` while one or
      // more per-ETF columns still carry numeric values. A walk-left
      // fallback would pick the rightmost numeric per-ETF cell as
      // Totals — producing a ~10× wrong netFlow. Parser must skip
      // the row instead.
      const html = `
<table>
  <tr><th>Date</th><th>IBIT</th><th>FBTC</th><th>Total</th></tr>
  <tr><td>22 Apr 2026</td><td>50.0</td><td>30.0</td><td>-</td></tr>
  <tr><td>23 Apr 2026</td><td>100.0</td><td>40.0</td><td>226.8</td></tr>
</table>`;

      const result = parseCoinGlassEtfFlowResponse(html);

      // 22 Apr row must be SKIPPED — neither 50.0 (IBIT) nor 30.0
      // (FBTC) leak in as a fake Total. Only 23 Apr survives.
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
  <tr><th>Date</th><th>Total</th></tr>
  <tr><td><span class="tabletext">23&nbsp;Apr&nbsp;2026</span></td><td><strong>226.8</strong></td></tr>
</table>`;

      const result = parseCoinGlassEtfFlowResponse(html);

      expect(result.fetch_status).toBe("success");
      expect(result.latest).toEqual({
        date: "2026-04-23",
        netFlow: 226_800_000,
      });
    });

    it("handles comma-thousands in numeric cells", () => {
      // Farside doesn't currently use comma-thousands for the Total
      // column (values are typically <1000) but a single-day mega-flow
      // could push it into 4-digit territory; be tolerant.
      const html = `
<table>
  <tr><th>Date</th><th>Total</th></tr>
  <tr><td>23 Apr 2026</td><td>1,226.8</td></tr>
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

    it("filters out summary rows (Average / Minimum / Maximum / Std Dev / Total)", () => {
      // Farside appends a summary block AFTER the per-day rows. Their
      // first cell is a label like "Average", not a date — so the
      // date-prefix regex drops them naturally without special casing.
      const html = `
<table>
  <tr><th>Date</th><th>Total</th></tr>
  <tr><td>21 Apr 2026</td><td>167.1</td></tr>
  <tr><td>22 Apr 2026</td><td><span class="redFont">(16.9)</span></td></tr>
  <tr><td>23 Apr 2026</td><td>226.8</td></tr>
  <tr><td>Average</td><td>125.7</td></tr>
  <tr><td>Minimum</td><td><span class="redFont">(16.9)</span></td></tr>
  <tr><td>Maximum</td><td>226.8</td></tr>
  <tr><td>Standard Deviation</td><td>105.2</td></tr>
  <tr><td>Total</td><td>377.0</td></tr>
</table>`;

      const result = parseCoinGlassEtfFlowResponse(html);

      expect(result.fetch_status).toBe("success");
      expect(result.observations).toHaveLength(3);
      expect(result.observations.map((o) => o.date)).toEqual([
        "2026-04-21",
        "2026-04-22",
        "2026-04-23",
      ]);
    });

    it("sorts observations chronologically even when HTML order is reversed", () => {
      // Some mirrors render newest-first; the parser must sort ASC so
      // consumers get a stable chronological series.
      const html = `
<table>
  <tr><th>Date</th><th>Total</th></tr>
  <tr><td>23 Apr 2026</td><td>226.8</td></tr>
  <tr><td>22 Apr 2026</td><td><span class="redFont">(16.9)</span></td></tr>
  <tr><td>21 Apr 2026</td><td>167.1</td></tr>
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

  describe("legacy Bitbo HTML shape (Mon DD, YYYY + leading-minus negatives)", () => {
    // Pinned regression: the old Bitbo source was IP-blocked by Vercel
    // in 2026 and we migrated to Farside. The parser should still cope
    // with Bitbo-shape fixtures so a future swap back (e.g. if Bitbo
    // unblocks Vercel ranges) doesn't require parser surgery.
    it("parses Mon DD, YYYY dates with leading-minus negatives", () => {
      const html = `
<table>
  <tr><th>Date</th><th>Totals</th></tr>
  <tr><td>Apr 21, 2026</td><td>167.1</td></tr>
  <tr><td>Apr 22, 2026</td><td>-16.9</td></tr>
  <tr><td>Apr 23, 2026</td><td>226.8</td></tr>
</table>`;

      const result = parseCoinGlassEtfFlowResponse(html);

      expect(result.fetch_status).toBe("success");
      expect(result.observations).toHaveLength(3);
      expect(result.latest).toEqual({
        date: "2026-04-23",
        netFlow: 226_800_000,
      });
      const apr22 = result.observations.find((o) => o.date === "2026-04-22");
      expect(apr22?.netFlow).toBe(-16_900_000);
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
