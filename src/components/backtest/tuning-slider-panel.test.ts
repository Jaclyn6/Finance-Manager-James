import { describe, expect, it } from "vitest";

import {
  isSliderDirty,
  numericBaseline,
  weightsDraftDiffers,
} from "./tuning-slider-panel";

/**
 * The dirty-state hint ("슬라이더 변경이 아직 미적용") hinges on this
 * decision — a false negative silently reproduces the +0.00 trap it
 * exists to prevent (UX 실사 + Trigger 2, 2026-08-03).
 */
describe("isSliderDirty", () => {
  const baseline = { macro: 45, technical: 35 };

  it("no override: moved sliders are dirty, baseline sliders are not", () => {
    expect(
      isSliderDirty({
        draft: { macro: 70, technical: 35 },
        appliedDraft: null,
        baseline,
        active: false,
      }),
    ).toBe(true);
    expect(
      isSliderDirty({
        draft: { ...baseline },
        appliedDraft: null,
        baseline,
        active: false,
      }),
    ).toBe(false);
  });

  it("active override: dirty exactly when sliders moved since the 적용", () => {
    const applied = { macro: 70, technical: 35 };
    expect(
      isSliderDirty({
        draft: { macro: 70, technical: 35 },
        appliedDraft: applied,
        baseline,
        active: true,
      }),
    ).toBe(false);
    expect(
      isSliderDirty({
        draft: { macro: 80, technical: 35 },
        appliedDraft: applied,
        baseline,
        active: true,
      }),
    ).toBe(true);
  });

  it("active without a recorded 적용 (stale-parent race): never dirty — no hint rather than a wrong one", () => {
    expect(
      isSliderDirty({
        draft: { macro: 99, technical: 1 },
        appliedDraft: null,
        baseline,
        active: true,
      }),
    ).toBe(false);
  });
});

describe("weightsDraftDiffers", () => {
  it("equal records are not dirty", () => {
    expect(
      weightsDraftDiffers(
        { macro: 45, technical: 35 },
        { macro: 45, technical: 35 },
      ),
    ).toBe(false);
  });

  it("a moved slider or a mismatched category set is dirty", () => {
    expect(
      weightsDraftDiffers(
        { macro: 70, technical: 35 },
        { macro: 45, technical: 35 },
      ),
    ).toBe(true);
    expect(weightsDraftDiffers({ macro: 45 }, { macro: 45, onchain: 35 })).toBe(
      true,
    );
    expect(weightsDraftDiffers({ macro: 45, onchain: 35 }, { macro: 45 })).toBe(
      true,
    );
  });
});

describe("numericBaseline", () => {
  it("drops non-numeric (absent) categories", () => {
    expect(numericBaseline({ macro: 45, technical: 35 } as never)).toEqual({
      macro: 45,
      technical: 35,
    });
  });
});
