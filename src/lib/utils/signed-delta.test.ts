import { describe, expect, it } from "vitest";

import { formatSignedDelta, isDisplayZeroDelta } from "./signed-delta";

/**
 * Pins the invariant every delta badge relies on: sign and neutral
 * styling follow the DISPLAYED one-decimal value, so a rendered badge
 * can never read "+0.0" or "−0.0" (UX 실사 + Trigger 2, 2026-08-03).
 * Also locks the float boundary MIN_VISIBLE_MOVER_DELTA's doc comment
 * cites (0.05 → "+0.1").
 */
describe("formatSignedDelta", () => {
  it("sub-display-precision deltas render as unsigned 0.0", () => {
    expect(formatSignedDelta(0.03)).toBe("0.0");
    expect(formatSignedDelta(-0.03)).toBe("0.0");
    expect(formatSignedDelta(0)).toBe("0.0");
    expect(formatSignedDelta(-0)).toBe("0.0");
  });

  it("the 0.05 boundary rounds up to a signed 0.1 — never a signed zero", () => {
    expect(formatSignedDelta(0.05)).toBe("+0.1");
    expect(formatSignedDelta(-0.05)).toBe("−0.1");
    expect(formatSignedDelta(0.049999999999999996)).toBe("0.0");
  });

  it("ordinary deltas keep sign and one-decimal magnitude (half-magnitudes round away from zero)", () => {
    expect(formatSignedDelta(1.74)).toBe("+1.7");
    expect(formatSignedDelta(-4.25)).toBe("−4.3");
    expect(formatSignedDelta(4.25)).toBe("+4.3");
  });
});

describe("isDisplayZeroDelta", () => {
  it("matches exactly the values formatSignedDelta renders as 0.0", () => {
    for (const v of [0, 0.03, -0.049, 0.0499]) {
      expect(isDisplayZeroDelta(v)).toBe(true);
      expect(formatSignedDelta(v)).toBe("0.0");
    }
    for (const v of [0.05, -0.05, 0.1, -1.7]) {
      expect(isDisplayZeroDelta(v)).toBe(false);
      expect(formatSignedDelta(v)).not.toBe("0.0");
    }
  });
});
