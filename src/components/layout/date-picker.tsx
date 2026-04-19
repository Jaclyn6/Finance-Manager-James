"use client";

import { CalendarIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  PROJECT_EPOCH,
  sanitizeDateParam,
  todayIsoUtc,
} from "@/lib/utils/date";

/**
 * Hybrid date picker (blueprint §6.1, v2.2).
 *
 * Single Client Component that renders BOTH the native `<input type="date">`
 * and the shadcn `Popover + Calendar` side by side, and relies on
 * Tailwind's `md:` breakpoint to hide/show the correct one per viewport:
 *
 * - `<md` (mobile, <768px): native input. iOS / Android replace this
 *   with their OS-native wheel / Material calendar picker — touch-native,
 *   zero extra JS, browser guarantees a valid `YYYY-MM-DD` value.
 * - `md+` (desktop): shadcn `Popover + Calendar` with mouse interaction
 *   and visual consistency with the rest of the header UI.
 *
 * Why CSS-based branching, not a `useMediaQuery` JS hook (deviation
 * from the blueprint's "media-query hook" wording): JS-based branching
 * needs one render with the wrong branch before `useEffect` fires,
 * which flashes the wrong picker on desktop first paint. Rendering
 * both and letting Tailwind's `md:hidden` / `hidden md:block` toggle
 * them is hydration-stable (server and client agree), flash-free, and
 * adapts instantly on iPad rotation without a JS listener. The blueprint's
 * intent ("same picker on mobile and desktop, branch on viewport")
 * is preserved; the mechanism is cleaner.
 *
 * URL contract — single source of truth lives in `?date=`:
 * - Absent → "latest" (page defaults to today).
 * - Present and valid → selected day.
 * - Invalid / out-of-range → silently dropped via `sanitizeDateParam`
 *   (blueprint §6.1 Phase 1 fallback).
 *
 * Selection handlers use `router.replace()` (not `push`) because a
 * date change isn't a new navigation intent — it's a filter within
 * the same logical page, so back/forward shouldn't accumulate every
 * scrubbed date. `scroll: false` preserves the user's scroll position.
 */
export function DatePicker() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const today = todayIsoUtc();
  const rawDate = searchParams.get("date") ?? undefined;
  const selected = sanitizeDateParam(rawDate, today);
  // The input's `value` attribute must always be a valid YYYY-MM-DD,
  // so when no date is selected (latest mode), we show today — the
  // effective anchor the dashboard is rendering against.
  const displayDate = selected ?? today;

  const updateDate = (next: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next && next !== today) {
      params.set("date", next);
    } else {
      // Picking "today" or clearing both collapse to "latest mode" —
      // represented by the absence of the param so the URL is short
      // and cache hits on latest are maximized.
      params.delete("date");
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  };

  return (
    <>
      {/* MOBILE: native OS picker.
          `h-11` satisfies the blueprint §6.2 44×44 touch-target rule.
          `md:hidden` removes this branch entirely on ≥768px. */}
      <input
        type="date"
        aria-label="날짜 선택"
        min={PROJECT_EPOCH}
        max={today}
        value={displayDate}
        onChange={(e) => updateDate(e.target.value || null)}
        className="h-11 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
      />

      {/* DESKTOP: shadcn Popover + Calendar.
          `hidden md:flex` mirrors the inverse breakpoint. */}
      <div className="hidden md:flex">
        <Popover>
          <PopoverTrigger
            render={
              <Button
                variant="outline"
                // Explicit `h-11` honors blueprint §6.2's universal
                // ≥44×44 touch-target rule — §6.2 lists "date picker"
                // verbatim without a viewport qualifier, so the
                // desktop trigger needs the same height as the mobile
                // native input. `size="default"` (h-8) and `size="sm"`
                // (h-7) are both below the threshold; overriding via
                // className keeps the shadcn cva intact for padding
                // and gap while forcing the height.
                className="h-11 gap-2"
                aria-label="날짜 선택"
              />
            }
          >
            <CalendarIcon aria-hidden="true" focusable="false" className="size-4" />
            <span className="tabular-nums">{displayDate}</span>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="single"
              selected={isoToLocalDate(displayDate)}
              defaultMonth={isoToLocalDate(displayDate)}
              onSelect={(date) => {
                if (date) updateDate(localDateToIso(date));
              }}
              disabled={{
                before: isoToLocalDate(PROJECT_EPOCH),
                after: isoToLocalDate(today),
              }}
              autoFocus
            />
          </PopoverContent>
        </Popover>
      </div>
    </>
  );
}

/**
 * Convert `YYYY-MM-DD` → `Date` at local midnight.
 *
 * Using `new Date(y, m-1, d)` (local constructor) instead of
 * `new Date("YYYY-MM-DDT00:00:00Z")` because react-day-picker
 * displays dates in the user's local timezone. A UTC-midnight Date in
 * any non-UTC zone represents the previous day in local time for
 * viewers west of UTC — the picker would highlight the wrong cell.
 * Local-midnight keeps the displayed day matching the URL param
 * across every timezone.
 */
function isoToLocalDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Convert `Date` → `YYYY-MM-DD` using local components.
 *
 * Mirrors `isoToLocalDate`: the `Date` we get back from
 * react-day-picker's `onSelect` is a local-timezone instant at
 * midnight. Pulling local getters recovers the day the user clicked
 * on regardless of timezone. `toISOString()` would pull UTC
 * components and drift by a day for non-UTC users.
 */
function localDateToIso(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
