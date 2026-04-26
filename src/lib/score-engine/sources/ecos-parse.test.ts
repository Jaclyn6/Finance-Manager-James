import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  parseEcosResponse,
  ecosTimeToIsoDate,
  findEcosObservationAsOf,
  type EcosObservation,
} from "./ecos-parse";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Network-free tests for the ECOS response parser. Live envelope
 * captured 2026-04-27 from
 *   GET /StatisticSearch/<key>/json/kr/1/200/722Y001/M/202401/202412
 * and saved (filtered to ITEM_CODE1=0101000) under __fixtures__/.
 */

describe("parseEcosResponse — success envelope", () => {
  it("parses a well-formed monthly response (BOK base rate fixture)", () => {
    const raw = readFileSync(
      resolve(__dirname, "__fixtures__/ecos-bok-rate.json"),
      "utf8",
    );
    const body = JSON.parse(raw) as unknown;
    const result = parseEcosResponse("722Y001", body, "0101000");

    expect(result.series_code).toBe("722Y001");
    expect(result.item_code).toBe("0101000");
    expect(result.fetch_status).toBe("success");
    expect(result.observations.length).toBeGreaterThan(0);
    // Monthly TIME (e.g. "202401") becomes ISO YYYY-MM-01.
    expect(result.observations[0].date).toMatch(/^\d{4}-\d{2}-01$/);
    expect(result.latest).not.toBeNull();
    expect(typeof result.latest!.value).toBe("number");
  });

  it("parses a synthetic monthly envelope and converts YYYYMM → YYYY-MM-01", () => {
    const body = {
      StatisticSearch: {
        list_total_count: 3,
        row: [
          {
            STAT_CODE: "722Y001",
            ITEM_CODE1: "0101000",
            TIME: "202401",
            DATA_VALUE: "3.5",
          },
          {
            STAT_CODE: "722Y001",
            ITEM_CODE1: "0101000",
            TIME: "202402",
            DATA_VALUE: "3.5",
          },
          {
            STAT_CODE: "722Y001",
            ITEM_CODE1: "0101000",
            TIME: "202403",
            DATA_VALUE: "3.0",
          },
        ],
      },
    };
    const result = parseEcosResponse("722Y001", body, "0101000");
    expect(result.fetch_status).toBe("success");
    expect(result.observations).toHaveLength(3);
    expect(result.observations[0]).toEqual({ date: "2024-01-01", value: 3.5 });
    expect(result.latest).toEqual({ date: "2024-03-01", value: 3.0 });
    expect(result.window).toEqual([3.5, 3.5]);
  });

  it("parses a synthetic daily envelope and converts YYYYMMDD → YYYY-MM-DD", () => {
    const body = {
      StatisticSearch: {
        list_total_count: 2,
        row: [
          {
            STAT_CODE: "817Y002",
            ITEM_CODE1: "010210000",
            TIME: "20260102",
            DATA_VALUE: "3.396",
          },
          {
            STAT_CODE: "817Y002",
            ITEM_CODE1: "010210000",
            TIME: "20260105",
            DATA_VALUE: "3.401",
          },
        ],
      },
    };
    const result = parseEcosResponse("817Y002", body, "010210000");
    expect(result.fetch_status).toBe("success");
    expect(result.observations[0].date).toBe("2026-01-02");
    expect(result.observations[1].date).toBe("2026-01-05");
    expect(result.latest?.value).toBe(3.401);
    expect(result.window).toEqual([3.396]);
  });

  it("filters by ITEM_CODE1 when caller passes one", () => {
    // 722Y001 returns BOK rate AND many other series under one stat code;
    // verify the filter pulls only the requested item.
    const body = {
      StatisticSearch: {
        list_total_count: 4,
        row: [
          {
            STAT_CODE: "722Y001",
            ITEM_CODE1: "0101000",
            TIME: "202401",
            DATA_VALUE: "3.5",
          },
          {
            STAT_CODE: "722Y001",
            ITEM_CODE1: "0102000", // different sub-series
            TIME: "202401",
            DATA_VALUE: "3.623",
          },
          {
            STAT_CODE: "722Y001",
            ITEM_CODE1: "0101000",
            TIME: "202402",
            DATA_VALUE: "3.5",
          },
          {
            STAT_CODE: "722Y001",
            ITEM_CODE1: "0102000",
            TIME: "202402",
            DATA_VALUE: "3.624",
          },
        ],
      },
    };
    const result = parseEcosResponse("722Y001", body, "0101000");
    expect(result.observations).toHaveLength(2);
    expect(result.observations.every((o) => o.value === 3.5)).toBe(true);
  });

  it("returns every row when itemCode is omitted", () => {
    const body = {
      StatisticSearch: {
        list_total_count: 2,
        row: [
          {
            STAT_CODE: "X",
            ITEM_CODE1: "A",
            TIME: "202401",
            DATA_VALUE: "1",
          },
          {
            STAT_CODE: "X",
            ITEM_CODE1: "B",
            TIME: "202402",
            DATA_VALUE: "2",
          },
        ],
      },
    };
    const result = parseEcosResponse("X", body);
    expect(result.item_code).toBeNull();
    expect(result.observations).toHaveLength(2);
  });

  it("sorts unsorted upstream rows into chronological order", () => {
    const body = {
      StatisticSearch: {
        list_total_count: 3,
        row: [
          { ITEM_CODE1: "A", TIME: "202403", DATA_VALUE: "3" },
          { ITEM_CODE1: "A", TIME: "202401", DATA_VALUE: "1" },
          { ITEM_CODE1: "A", TIME: "202402", DATA_VALUE: "2" },
        ],
      },
    };
    const result = parseEcosResponse("X", body, "A");
    expect(result.observations.map((o) => o.date)).toEqual([
      "2024-01-01",
      "2024-02-01",
      "2024-03-01",
    ]);
    expect(result.latest?.value).toBe(3);
  });
});

describe("parseEcosResponse — error envelopes", () => {
  it("maps INFO-100 (auth failure) to fetch_status error", () => {
    const body = {
      RESULT: {
        CODE: "INFO-100",
        MESSAGE: "인증키가 유효하지 않습니다.",
      },
    };
    const result = parseEcosResponse("722Y001", body, "0101000");
    expect(result.fetch_status).toBe("error");
    expect(result.error).toContain("INFO-100");
    expect(result.error).toContain("인증키");
    expect(result.observations).toEqual([]);
    expect(result.latest).toBeNull();
  });

  it("maps INFO-200 (no data in range) to fetch_status error", () => {
    const body = {
      RESULT: {
        CODE: "INFO-200",
        MESSAGE: "해당하는 데이터가 없습니다.",
      },
    };
    const result = parseEcosResponse("101Y004", body, undefined);
    expect(result.fetch_status).toBe("error");
    expect(result.error).toContain("INFO-200");
  });

  it("returns error on non-object body", () => {
    expect(parseEcosResponse("X", null).fetch_status).toBe("error");
    expect(parseEcosResponse("X", "string").fetch_status).toBe("error");
    expect(parseEcosResponse("X", 42).fetch_status).toBe("error");
  });

  it("returns error when StatisticSearch envelope is missing", () => {
    const result = parseEcosResponse("X", { unexpectedKey: 1 });
    expect(result.fetch_status).toBe("error");
    expect(result.error).toMatch(/StatisticSearch/);
  });

  it("returns error when row[] is missing", () => {
    const result = parseEcosResponse("X", {
      StatisticSearch: { list_total_count: 0 },
    });
    expect(result.fetch_status).toBe("error");
    expect(result.error).toMatch(/row/);
  });
});

describe("parseEcosResponse — partial / empty cases", () => {
  it("returns partial when row[] is empty", () => {
    const result = parseEcosResponse("X", {
      StatisticSearch: { row: [] },
    });
    expect(result.fetch_status).toBe("partial");
    expect(result.error).toMatch(/no observations/);
  });

  it("drops rows with empty DATA_VALUE", () => {
    const body = {
      StatisticSearch: {
        row: [
          { ITEM_CODE1: "A", TIME: "202401", DATA_VALUE: "" },
          { ITEM_CODE1: "A", TIME: "202402", DATA_VALUE: "1.0" },
        ],
      },
    };
    const result = parseEcosResponse("X", body, "A");
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0].date).toBe("2024-02-01");
  });

  it("drops rows with non-numeric DATA_VALUE", () => {
    const body = {
      StatisticSearch: {
        row: [
          { ITEM_CODE1: "A", TIME: "202401", DATA_VALUE: "not a number" },
          { ITEM_CODE1: "A", TIME: "202402", DATA_VALUE: "1.0" },
        ],
      },
    };
    const result = parseEcosResponse("X", body, "A");
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0].value).toBe(1.0);
  });

  it("drops rows whose TIME doesn't match a known cycle format", () => {
    const body = {
      StatisticSearch: {
        row: [
          { ITEM_CODE1: "A", TIME: "2024-01-01", DATA_VALUE: "1" }, // already ISO, not ECOS shape
          { ITEM_CODE1: "A", TIME: "2024/01", DATA_VALUE: "2" },
          { ITEM_CODE1: "A", TIME: "abc", DATA_VALUE: "3" },
          { ITEM_CODE1: "A", TIME: "20240101", DATA_VALUE: "4" }, // valid daily
        ],
      },
    };
    const result = parseEcosResponse("X", body, "A");
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0].date).toBe("2024-01-01");
  });
});

describe("ecosTimeToIsoDate", () => {
  it("converts daily YYYYMMDD", () => {
    expect(ecosTimeToIsoDate("20260427")).toBe("2026-04-27");
  });

  it("converts monthly YYYYMM to first of month", () => {
    expect(ecosTimeToIsoDate("202604")).toBe("2026-04-01");
  });

  it("converts quarterly YYYYQ# to first month of quarter", () => {
    expect(ecosTimeToIsoDate("2026Q1")).toBe("2026-01-01");
    expect(ecosTimeToIsoDate("2026Q2")).toBe("2026-04-01");
    expect(ecosTimeToIsoDate("2026Q3")).toBe("2026-07-01");
    expect(ecosTimeToIsoDate("2026Q4")).toBe("2026-10-01");
  });

  it("converts annual YYYY to Jan 1", () => {
    expect(ecosTimeToIsoDate("2026")).toBe("2026-01-01");
  });

  it("returns null on garbage input", () => {
    expect(ecosTimeToIsoDate("")).toBeNull();
    expect(ecosTimeToIsoDate("not a date")).toBeNull();
    expect(ecosTimeToIsoDate("20261301")).toBeNull(); // month 13
    expect(ecosTimeToIsoDate("2026Q5")).toBeNull(); // quarter 5
    expect(ecosTimeToIsoDate("2026-04-27")).toBeNull(); // ISO not ECOS
  });

  it("rejects impossible calendar dates (Feb 31, Jun 31, Apr 31, leap-year edge)", () => {
    expect(ecosTimeToIsoDate("20260229")).toBeNull(); // 2026 not leap
    expect(ecosTimeToIsoDate("20240229")).toBe("2024-02-29"); // 2024 IS leap
    expect(ecosTimeToIsoDate("20260231")).toBeNull(); // Feb 31
    expect(ecosTimeToIsoDate("20260631")).toBeNull(); // Jun 31
    expect(ecosTimeToIsoDate("20260431")).toBeNull(); // Apr 31
    expect(ecosTimeToIsoDate("20260931")).toBeNull(); // Sep 31
    expect(ecosTimeToIsoDate("20261131")).toBeNull(); // Nov 31
  });
});

describe("findEcosObservationAsOf", () => {
  const series: EcosObservation[] = [
    { date: "2026-04-01", value: 10 },
    { date: "2026-04-05", value: 12 },
    { date: "2026-04-10", value: null },
    { date: "2026-04-15", value: 15 },
    { date: "2026-04-20", value: 18 },
  ];

  it("returns the exact-match observation when present", () => {
    expect(findEcosObservationAsOf(series, "2026-04-05")).toEqual({
      date: "2026-04-05",
      value: 12,
    });
  });

  it("returns the latest observation strictly <= asOfDate", () => {
    expect(findEcosObservationAsOf(series, "2026-04-07")).toEqual({
      date: "2026-04-05",
      value: 12,
    });
  });

  it("skips null observations", () => {
    expect(findEcosObservationAsOf(series, "2026-04-10")).toEqual({
      date: "2026-04-05",
      value: 12,
    });
  });

  it("returns null before the first observation", () => {
    expect(findEcosObservationAsOf(series, "2026-03-01")).toBeNull();
  });

  it("returns null on empty input", () => {
    expect(findEcosObservationAsOf([], "2026-04-20")).toBeNull();
  });

  it("returns the final non-null observation when asOfDate is in the future", () => {
    expect(findEcosObservationAsOf(series, "2030-01-01")).toEqual({
      date: "2026-04-20",
      value: 18,
    });
  });
});
