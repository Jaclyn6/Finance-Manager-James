import { describe, expect, it } from "vitest";

import {
  parseActiveSignals,
  parsePerSignalDetail,
} from "./signal-alignment-card";

/**
 * Defensive-parser tests for the two Json-typed DB columns that feed
 * the SignalAlignmentCard. Render-level tests are skipped — the card
 * is a Client Component using `@base-ui/react` Tooltip primitives, and
 * there's no `@testing-library/react` dep installed (see package.json).
 * Every piece of logic that could crash on corrupt JSONB lives in
 * these two parsers, so this is where the testing value is.
 */

describe("parsePerSignalDetail", () => {
  it("returns {} for null / non-object / array input", () => {
    expect(parsePerSignalDetail(null)).toEqual({});
    expect(parsePerSignalDetail(undefined)).toEqual({});
    expect(parsePerSignalDetail("not a map")).toEqual({});
    expect(parsePerSignalDetail([])).toEqual({});
    expect(parsePerSignalDetail(42)).toEqual({});
  });

  it("extracts well-formed signal detail entries verbatim", () => {
    const raw = {
      EXTREME_FEAR: {
        state: "active",
        inputs: { vix: 37.2, cnnFg: 18 },
        threshold: "VIX >= 35 || CNN_FG < 25",
      },
      LIQUIDITY_EASING: {
        state: "unknown",
        inputs: { tgaToday: null, sma20: 620000 },
        threshold: "TGA_today < SMA20(TGA)",
      },
    };
    const parsed = parsePerSignalDetail(raw);
    expect(parsed.EXTREME_FEAR?.state).toBe("active");
    expect(parsed.EXTREME_FEAR?.inputs.vix).toBe(37.2);
    expect(parsed.LIQUIDITY_EASING?.state).toBe("unknown");
    expect(parsed.LIQUIDITY_EASING?.inputs.tgaToday).toBeNull();
  });

  it("drops entries with unrecognized state", () => {
    const raw = {
      EXTREME_FEAR: { state: "bogus", inputs: {}, threshold: "" },
      DISLOCATION: { state: "active", inputs: {}, threshold: "" },
    };
    const parsed = parsePerSignalDetail(raw);
    expect(parsed.EXTREME_FEAR).toBeUndefined();
    expect(parsed.DISLOCATION?.state).toBe("active");
  });

  it("filters non-number non-null input values out", () => {
    const raw = {
      EXTREME_FEAR: {
        state: "active",
        inputs: {
          vix: 37,
          bad: "nope",
          nan: Number.NaN,
          inf: Number.POSITIVE_INFINITY,
          nullable: null,
        },
        threshold: "",
      },
    };
    const parsed = parsePerSignalDetail(raw);
    expect(parsed.EXTREME_FEAR?.inputs).toEqual({
      vix: 37,
      nullable: null,
    });
  });
});

describe("parseActiveSignals", () => {
  it("returns empty Set for non-array input", () => {
    expect(parseActiveSignals(null).size).toBe(0);
    expect(parseActiveSignals({}).size).toBe(0);
    expect(parseActiveSignals("EXTREME_FEAR").size).toBe(0);
  });

  it("coerces string-array entries into a Set", () => {
    const result = parseActiveSignals([
      "EXTREME_FEAR",
      "LIQUIDITY_EASING",
      42, // ignored
      { name: "ECONOMY_INTACT" }, // ignored
    ]);
    expect(result.has("EXTREME_FEAR")).toBe(true);
    expect(result.has("LIQUIDITY_EASING")).toBe(true);
    expect(result.size).toBe(2);
  });

  it("ignores duplicates", () => {
    const result = parseActiveSignals([
      "EXTREME_FEAR",
      "EXTREME_FEAR",
      "EXTREME_FEAR",
    ]);
    expect(result.size).toBe(1);
  });
});
