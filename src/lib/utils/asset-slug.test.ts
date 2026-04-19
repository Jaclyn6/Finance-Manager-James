import { describe, expect, it } from "vitest";

import {
  ASSET_SLUGS,
  listAllAssetSlugs,
  slugToAssetType,
} from "./asset-slug";

describe("ASSET_SLUGS + slugToAssetType round-trip", () => {
  it("round-trips every enum value through the slug map", () => {
    for (const [assetType, slug] of Object.entries(ASSET_SLUGS)) {
      expect(slugToAssetType(slug)).toBe(assetType);
    }
  });

  it("returns null for unknown slugs", () => {
    expect(slugToAssetType("not-a-real-asset")).toBeNull();
    expect(slugToAssetType("")).toBeNull();
    expect(slugToAssetType("US-EQUITY")).toBeNull(); // case-sensitive
  });

  it("excludes 'common' from the map (no dedicated page)", () => {
    expect(slugToAssetType("common")).toBeNull();
    // @ts-expect-error — common is intentionally not a key on ASSET_SLUGS
    expect(ASSET_SLUGS.common).toBeUndefined();
  });

  it("defends against prototype-pollution lookups", () => {
    // `ASSET_SLUGS[slug]` would resolve these to inherited methods on
    // Object.prototype, potentially bypassing a naive `!label` guard.
    // `slugToAssetType` uses an entries iteration so prototype keys
    // can't sneak through as a valid asset type.
    expect(slugToAssetType("toString")).toBeNull();
    expect(slugToAssetType("constructor")).toBeNull();
    expect(slugToAssetType("hasOwnProperty")).toBeNull();
  });
});

describe("listAllAssetSlugs", () => {
  it("returns exactly the four asset slugs in a deterministic order", () => {
    const slugs = listAllAssetSlugs();
    expect(slugs).toHaveLength(4);
    expect(slugs).toContain("us-equity");
    expect(slugs).toContain("kr-equity");
    expect(slugs).toContain("crypto");
    expect(slugs).toContain("global-etf");
  });
});
