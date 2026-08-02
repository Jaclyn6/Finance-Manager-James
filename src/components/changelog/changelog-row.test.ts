import { describe, expect, it } from "vitest";

import {
  MIN_VISIBLE_MOVER_DELTA,
  parseTopMovers,
} from "./changelog-row";

describe("parseTopMovers", () => {
  it("drops sub-threshold movers — a rendered mover can never read ±0.0", () => {
    // Quiet-day rows carried "+0.0 / −0.0" blocks (UX 실사 2026-08-03).
    const movers = parseTopMovers([
      { key: "VIXCLS", delta: 0.04 },
      { key: "DGS10", delta: -0.04 },
      { key: "T10Y2Y", delta: 0.0 },
    ] as never);
    expect(movers).toEqual([]);
  });

  it("keeps movers at or above the display threshold", () => {
    const movers = parseTopMovers([
      { key: "VIXCLS", delta: 1.7 },
      { key: "BAMLH0A0HYM2", delta: -MIN_VISIBLE_MOVER_DELTA },
    ] as never);
    expect(movers.map((m) => m.key)).toEqual(["VIXCLS", "BAMLH0A0HYM2"]);
  });

  it("defensively drops malformed entries", () => {
    const movers = parseTopMovers([
      null,
      "junk",
      { key: 42, delta: 1 },
      { key: "VIXCLS", delta: Number.NaN },
      { key: "VIXCLS", delta: 1.2 },
    ] as never);
    expect(movers).toEqual([{ key: "VIXCLS", delta: 1.2 }]);
  });

  it("returns empty for non-array JSONB", () => {
    expect(parseTopMovers(null)).toEqual([]);
    expect(parseTopMovers({} as never)).toEqual([]);
  });
});
