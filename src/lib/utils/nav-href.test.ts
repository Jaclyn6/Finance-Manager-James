import { describe, expect, it } from "vitest";

import { buildNavHref } from "./nav-href";

describe("buildNavHref", () => {
  it("returns the path unchanged when no date is given", () => {
    expect(buildNavHref("/dashboard", null)).toBe("/dashboard");
    expect(buildNavHref("/dashboard", undefined)).toBe("/dashboard");
    expect(buildNavHref("/dashboard", "")).toBe("/dashboard");
  });

  it("appends ?date= when the path has no existing query", () => {
    expect(buildNavHref("/dashboard", "2026-04-19")).toBe(
      "/dashboard?date=2026-04-19",
    );
  });

  it("appends &date= when the path already has a query", () => {
    expect(buildNavHref("/asset/us-equity?view=score", "2026-04-19")).toBe(
      "/asset/us-equity?view=score&date=2026-04-19",
    );
  });

  it("URL-encodes the date value (defense in depth)", () => {
    // Real dates are YYYY-MM-DD and need no encoding, but the helper
    // is resilient if a malformed upstream value slips through.
    expect(buildNavHref("/x", "20:26")).toBe("/x?date=20%3A26");
  });

  it("works for nested asset paths", () => {
    expect(buildNavHref("/asset/kr-equity", "2026-04-20")).toBe(
      "/asset/kr-equity?date=2026-04-20",
    );
  });
});
