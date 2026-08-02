import { describe, expect, it } from "vitest";

import { weightsDraftDiffers } from "./tuning-slider-panel";

/**
 * The dirty-state hint ("슬라이더 변경이 아직 미적용") hinges on this
 * comparison — a false negative silently reproduces the +0.00 trap
 * it exists to prevent (UX 실사 2026-08-03).
 */
describe("weightsDraftDiffers", () => {
  it("equal records are not dirty", () => {
    expect(
      weightsDraftDiffers({ macro: 45, technical: 35 }, { macro: 45, technical: 35 }),
    ).toBe(false);
  });

  it("a moved slider is dirty", () => {
    expect(
      weightsDraftDiffers({ macro: 70, technical: 35 }, { macro: 45, technical: 35 }),
    ).toBe(true);
  });

  it("a category present on one side only is dirty", () => {
    expect(weightsDraftDiffers({ macro: 45 }, { macro: 45, onchain: 35 })).toBe(
      true,
    );
    expect(weightsDraftDiffers({ macro: 45, onchain: 35 }, { macro: 45 })).toBe(
      true,
    );
  });
});
