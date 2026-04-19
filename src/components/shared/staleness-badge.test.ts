import { describe, expect, it } from "vitest";

import { computeAgeDays, resolveStaleness } from "./staleness-badge";

describe("resolveStaleness", () => {
  it("returns 최신 for fresh success (0 or 1 days old)", () => {
    expect(resolveStaleness("success", 0).label).toBe("최신");
    expect(resolveStaleness("success", 1).label).toBe("최신");
    expect(resolveStaleness("success", 0).variant).toBe("secondary");
  });

  it("returns amber '지연' for 2-6 day old success rows", () => {
    expect(resolveStaleness("success", 2).label).toBe("2일 지연");
    expect(resolveStaleness("success", 6).label).toBe("6일 지연");
    expect(resolveStaleness("success", 3).variant).toBe("outline");
    expect(resolveStaleness("success", 3).className).toMatch(/amber/);
  });

  it("escalates to destructive for ≥7 day old success rows", () => {
    expect(resolveStaleness("success", 7).variant).toBe("destructive");
    expect(resolveStaleness("success", 30).label).toBe("30일 지연");
  });

  it("maps non-success fetch_status to dedicated labels", () => {
    expect(resolveStaleness("partial", 0).label).toBe("부분 수집");
    expect(resolveStaleness("stale", 0).label).toBe("이전 값 사용");
    expect(resolveStaleness("error", 0).label).toBe("수집 실패");
    expect(resolveStaleness("error", 0).variant).toBe("destructive");
  });

  it("non-success status dominates age (partial today still reads 부분 수집)", () => {
    expect(resolveStaleness("partial", 0).label).toBe("부분 수집");
    expect(resolveStaleness("partial", 30).label).toBe("부분 수집");
  });

  it("tolerates NaN / negative age by clamping to 0", () => {
    expect(resolveStaleness("success", Number.NaN).label).toBe("최신");
    expect(resolveStaleness("success", -5).label).toBe("최신");
  });
});

describe("computeAgeDays", () => {
  it("returns 0 for same-day", () => {
    expect(computeAgeDays("2026-04-20", "2026-04-20")).toBe(0);
  });

  it("returns positive count for past snapshots", () => {
    expect(computeAgeDays("2026-04-19", "2026-04-20")).toBe(1);
    expect(computeAgeDays("2026-04-10", "2026-04-20")).toBe(10);
  });

  it("clamps future-dated snapshots to 0 (clock skew tolerance)", () => {
    expect(computeAgeDays("2026-04-25", "2026-04-20")).toBe(0);
  });

  it("returns 0 on invalid input rather than throwing", () => {
    expect(computeAgeDays("not-a-date", "2026-04-20")).toBe(0);
    expect(computeAgeDays("2026-04-20", "bogus")).toBe(0);
  });

  it("handles month-boundary correctly", () => {
    // March (31 days) → April: 31 → Apr 1 = 1 day
    expect(computeAgeDays("2026-03-31", "2026-04-01")).toBe(1);
    expect(computeAgeDays("2026-02-28", "2026-03-01")).toBe(1);
  });
});
