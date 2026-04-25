import { describe, expect, it } from "vitest";

import { GROUP_ORDER, NAV_ITEMS } from "./nav-items";

/**
 * Drift guards for the shared nav configuration. Sidebar (desktop) and
 * MobileNav both iterate over GROUP_ORDER + NAV_ITEMS — a stale group
 * here would silently hide entries on one surface and not the other,
 * so we lock the contract:
 *
 * 1. Every NAV_ITEMS entry's `group` is present in GROUP_ORDER.
 * 2. The reference glossary entry (`/indicators` under "참고") exists,
 *    catching accidental deletion if someone refactors NAV_ITEMS.
 */

describe("NAV_ITEMS / GROUP_ORDER", () => {
  it("every NAV_ITEMS group is present in GROUP_ORDER", () => {
    const known = new Set<string>(GROUP_ORDER);
    for (const item of NAV_ITEMS) {
      expect(known.has(item.group), `unknown group: ${item.group}`).toBe(true);
    }
  });

  it("includes the indicator glossary nav entry under 참고", () => {
    const entry = NAV_ITEMS.find((i) => i.href === "/indicators");
    expect(entry, "/indicators nav entry should exist").toBeDefined();
    expect(entry?.group).toBe("참고");
    expect(entry?.label).toBe("지표 사전");
  });
});
