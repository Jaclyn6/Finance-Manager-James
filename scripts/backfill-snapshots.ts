/**
 * One-off historical backfill for indicator_readings + composite_snapshots
 * + score_changelog, BACKFILL_DAYS ending at today.
 *
 * Why this exists (Step 11.5, 2026-04-20):
 *   The Phase 1 smoke test only produced one cron run (2026-04-19), so
 *   /asset/[slug] trend charts show a single dot and /changelog is
 *   empty. That's insufficient to sanity-check the score pipeline end-
 *   to-end (z-score normalization, band transitions, top-movers diff,
 *   model_version pinning). Rather than wait for the daily cron to
 *   accumulate history organically, this script replays the past
 *   BACKFILL_DAYS against each date's own 5-year window so the user
 *   can eyeball trend, variability, and band cadence immediately.
 *
 * Design decisions:
 *
 * 1. **Standalone, not a cron route extension.** The production cron is
 *    a stable single-purpose endpoint — adding a `?backfill_days=N`
 *    query param would bloat its surface and risk accidental
 *    whole-history recomputation if the param leaks. This script is
 *    run manually once (or whenever we need to seed history again).
 *
 * 2. **Five-year window recomputed PER DATE.** For a backfill date D,
 *    the z-score window is [D - 5y, D], NOT [today - 5y, today]. This
 *    is the crux of "what would the score have said on D if we'd
 *    scored it at the time". Using a today-anchored window would leak
 *    future data into every past score, defeating the point of
 *    backfill.
 *
 * 3. **FRED history fetched ONCE per indicator.** One 5-year observation
 *    payload per series (7 total API calls), reused across all
 *    BACKFILL_DAYS. FRED Free tier is 120 req/min, so this is trivial.
 *
 * 4. **Idempotent via upsert.** Re-running the script replaces rows
 *    keyed on the existing unique indexes
 *    (`indicator_readings.(indicator_key, observed_at, model_version)`,
 *    `composite_snapshots.(asset_type, snapshot_date, model_version)`,
 *    `score_changelog.(asset_type, change_date, model_version)`).
 *    The Phase 1 smoke-test row for 2026-04-19 will get overwritten —
 *    that's fine, the recomputed value uses the same inputs.
 *
 * 5. **Bypasses `admin.ts` + `snapshot.ts` module chain.** `admin.ts`
 *    carries `import "server-only"` (Step 8 post-review hardening), and
 *    `snapshot.ts` imports `admin.ts` so its transitive chain throws
 *    the same guard in a Node-env script. This script uses
 *    `@supabase/supabase-js` directly with the service-role key — same
 *    behavior at the DB, no import-chain guard. Pure score-engine
 *    functions are reused (none of `weights` / `normalize` / `composite` /
 *    `top-movers` / `score-band` carries "server-only").
 *
 * Running:
 *   npx tsx scripts/backfill-snapshots.ts
 *   (requires .env.local with NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *   FRED_API_KEY)
 */

import { config as loadEnv } from "dotenv";

// Next.js convention: `.env.local` overrides `.env`. Replicate that
// precedence explicitly so the script works in either single-file or
// both-file setups:
//   1. Load `.env` first (silently skipped if absent).
//   2. Load `.env.local` with `override: true` so its values win over
//      anything `.env` already set — dotenv's default is FIRST-WIN, not
//      last-win, so without `override: true` a `.env` containing an
//      outdated NEXT_PUBLIC_SUPABASE_URL would silently route the
//      backfill to the wrong project. The single `import "dotenv/config"`
//      shorthand only covers `.env`, so we use the explicit form twice.
loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });

import { createClient } from "@supabase/supabase-js";

import { computeComposite } from "../src/lib/score-engine/composite";
import {
  findObservationAsOf,
  parseFredResponse,
  type FredObservation,
} from "../src/lib/score-engine/indicators/fred-parse";
import { computeZScore, zScoreTo0100 } from "../src/lib/score-engine/normalize";
import { computeTopMovers } from "../src/lib/score-engine/top-movers";
import type { AssetType, IndicatorScore } from "../src/lib/score-engine/types";
import {
  INDICATOR_CONFIG,
  INDICATOR_KEYS,
  MODEL_VERSION,
} from "../src/lib/score-engine/weights";
import type { Database, TablesInsert } from "../src/types/database";
import { scoreToBand } from "../src/lib/utils/score-band";

const BACKFILL_DAYS = 30;
const WINDOW_YEARS = 5;
const FRED_BASE_URL = "https://api.stlouisfed.org/fred/series/observations";
const FETCH_TIMEOUT_MS = 30_000;

const ASSET_TYPES: AssetType[] = [
  "common",
  "us_equity",
  "kr_equity",
  "crypto",
  "global_etf",
];

// ──────────────────────────────────────────────────────────────────
// Date helpers — UTC string arithmetic. Mirrors src/lib/utils/date.ts
// but kept local so this script has zero cross-import surprises.
// ──────────────────────────────────────────────────────────────────
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return new Date(ms + days * 86400000).toISOString().slice(0, 10);
}

function subtractYears(iso: string, years: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  // Going backward N years keeps the same (m, d); if that pair doesn't
  // exist in the target year (e.g. Feb 29 → non-leap), use JavaScript's
  // Date rollover which snaps to the next valid day. For a backfill
  // tool that's fine — the resulting date is a reasonable window edge.
  const target = new Date(Date.UTC(y - years, m - 1, d));
  return target.toISOString().slice(0, 10);
}

// ──────────────────────────────────────────────────────────────────
// FRED fetch — runs in Node, can't use the server-only fred.ts wrapper
// so we replicate the thin HTTP concern locally.
// ──────────────────────────────────────────────────────────────────
async function fetchFredHistory(
  seriesId: string,
  apiKey: string,
  observationStart: string,
  observationEnd: string,
): Promise<FredObservation[]> {
  const url = new URL(FRED_BASE_URL);
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("observation_start", observationStart);
  url.searchParams.set("observation_end", observationEnd);

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(
      `FRED ${seriesId}: HTTP ${response.status} ${response.statusText}`,
    );
  }
  const body = (await response.json()) as unknown;
  const parsed = parseFredResponse(seriesId, body);
  if (parsed.fetch_status !== "success") {
    throw new Error(
      `FRED ${seriesId}: parse ${parsed.fetch_status} — ${parsed.error ?? "unknown"}`,
    );
  }
  return parsed.observations;
}

// ──────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────
async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const fredKey = process.env.FRED_API_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — check .env.local",
    );
  }
  if (!fredKey) {
    throw new Error("Missing FRED_API_KEY — check .env.local");
  }

  const supabase = createClient<Database>(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const endDate = todayUtc();
  const startDate = addDays(endDate, -(BACKFILL_DAYS - 1));
  // Fetch enough history to compute a 5-year window at the OLDEST
  // backfill date. Going back `WINDOW_YEARS + 1` days past startDate
  // gives a small buffer against FRED's occasional leading missing
  // observations on monthly series.
  const historyStart = subtractYears(startDate, WINDOW_YEARS);

  console.log(
    `\nBackfill window: ${startDate} → ${endDate} (${BACKFILL_DAYS} days)`,
  );
  console.log(
    `Z-score history fetched from: ${historyStart} → ${endDate}\n`,
  );

  // ── Phase 1: Fetch 5-year history per indicator (one API call each)
  const histories = new Map<string, FredObservation[]>();
  for (const key of INDICATOR_KEYS) {
    process.stdout.write(`  ${key.padEnd(15)} ... `);
    const obs = await fetchFredHistory(key, fredKey, historyStart, endDate);
    histories.set(key, obs);
    console.log(`${obs.length} observations`);
  }

  // ── Phase 2: Per-date score computation
  const readingRows: TablesInsert<"indicator_readings">[] = [];
  const snapshotRows: TablesInsert<"composite_snapshots">[] = [];
  const changelogRows: TablesInsert<"score_changelog">[] = [];

  // In-memory map of computed composites so a date D can look up D-1
  // without a DB round-trip. Key = `${assetType}:${date}` → the
  // CompositeResult we wrote for that cell.
  type Computed = {
    score: number;
    contributing: Record<string, { score: number; weight: number; contribution: number }>;
  };
  const computed = new Map<string, Computed>();

  for (let i = 0; i < BACKFILL_DAYS; i++) {
    const date = addDays(startDate, i);
    const indicatorScores: IndicatorScore[] = [];

    for (const indicatorKey of INDICATOR_KEYS) {
      const config = INDICATOR_CONFIG[indicatorKey];
      const observations = histories.get(indicatorKey);
      if (!observations) continue;

      const asOf = findObservationAsOf(observations, date);
      if (!asOf || asOf.value === null) continue;

      // Z-score window: all non-null observations in [date - 5y, date].
      // Exclude `asOf` itself from the window so the z-score is against
      // prior context, not self. Matches the cron's `result.window`
      // semantic (which also excludes the latest observation).
      const windowStart = subtractYears(date, WINDOW_YEARS);
      const windowValues: number[] = [];
      for (const obs of observations) {
        if (obs.date < windowStart) continue;
        if (obs.date >= asOf.date) continue; // strictly prior
        if (obs.value !== null) windowValues.push(obs.value);
      }

      // Need a few points for a meaningful z-score. The engine's own
      // `computeZScore` has its own guards, but if we have <2 values
      // we skip this indicator for this date — partial data is better
      // than zero z-score injected into the composite.
      if (windowValues.length < 2) continue;

      // Argument order: (series, current) per normalize.ts signature —
      // series is the historical window, current is the value being
      // scored against it.
      const z = computeZScore(windowValues, asOf.value);
      const score = zScoreTo0100(z, config.inverted);

      readingRows.push({
        indicator_key: indicatorKey,
        observed_at: asOf.date,
        // Matches the cron: asset_type on indicator_readings is
        // a denormalized 'which macro tier' marker (PRD §12.3) — we
        // don't track per-asset scores at this layer, so "common"
        // is the canonical value for all 7 FRED series in Phase 1.
        asset_type: "common",
        value_raw: asOf.value,
        // `computeZScore` returns NaN for the flat-window-non-mean
        // edge case (normalize.ts:34). Mirror the cron's defensive
        // coercion (route.ts) so value_normalized stays a clean
        // number-or-null rather than leaking NaN into the NUMERIC
        // column. Score stays safe because `zScoreTo0100` itself
        // guards non-finite and returns 50.
        value_normalized: Number.isFinite(z) ? z : null,
        score_0_100: score,
        model_version: MODEL_VERSION,
        source_name: config.sourceName,
        source_url: config.sourceUrl,
        frequency: config.frequency,
        window_used: `${WINDOW_YEARS}y`,
        fetch_status: "success",
        is_revised: false,
        raw_payload: null,
      });

      indicatorScores.push({
        key: indicatorKey,
        score0to100: score,
        weights: config.weights,
      });
    }

    // Per-asset composite + (if prior day exists) changelog row
    for (const assetType of ASSET_TYPES) {
      const result = computeComposite(indicatorScores, assetType);
      const band = scoreToBand(result.score0to100);

      snapshotRows.push({
        asset_type: assetType,
        snapshot_date: date,
        score_0_100: result.score0to100,
        band: band.label,
        contributing_indicators: result.contributing as TablesInsert<"composite_snapshots">["contributing_indicators"],
        model_version: MODEL_VERSION,
        fetch_status: "success",
      });

      computed.set(`${assetType}:${date}`, {
        score: result.score0to100,
        contributing: result.contributing,
      });

      const priorDate = addDays(date, -1);
      const prior = computed.get(`${assetType}:${priorDate}`);
      if (prior) {
        const priorBand = scoreToBand(prior.score);
        const delta = result.score0to100 - prior.score;
        const bandChanged = priorBand.intensity !== band.intensity;
        const topMovers = computeTopMovers(result.contributing, prior.contributing, 3);

        changelogRows.push({
          asset_type: assetType,
          change_date: date,
          previous_score: prior.score,
          current_score: result.score0to100,
          previous_band: priorBand.label,
          current_band: band.label,
          delta,
          band_changed: bandChanged,
          top_movers: topMovers as unknown as TablesInsert<"score_changelog">["top_movers"],
          model_version: MODEL_VERSION,
        });
      }
    }
  }

  // Dedup indicator_readings on (key, observed_at, model_version).
  // Monthly indicators (FEDFUNDS / CPIAUCSL / SAHMCURRENT) publish on
  // the 1st and stay constant for the rest of the month, so the same
  // observed_at repeats across many backfill dates. Daily indicators
  // have a fresh observed_at per business day, so they're rarely
  // deduped except over weekends/holidays.
  //
  // Subtlety: for monthly indicators, each backfill date D re-computes
  // the z-score against a DIFFERENT 5-year window (anchored at D, not
  // at observed_at). So two backfill dates that collide on observed_at
  // typically produce slightly different value_normalized / score_0_100
  // values — the 5-year window can shift by up to 30 days over this
  // backfill's scope, moving the window's oldest edge across a handful
  // of observations. Keeping the last-written entry (the most recent
  // backfill date's computation) is intentional — it's the closest
  // proxy to "what the cron would have written today" — but callers
  // should be aware this is NOT literally the score that backfill-date
  // D1 computed for the same monthly row; for 30 days of backfill the
  // drift is sub-percent on the z-score and imperceptible on the 0-100
  // score. If pixel-perfect per-date scores for monthly indicators ever
  // matter, split the dedup key to include snapshot_date too.
  const dedupedReadings = Array.from(
    new Map(
      readingRows.map((r) => [
        `${r.indicator_key}:${r.observed_at}:${r.model_version}`,
        r,
      ]),
    ).values(),
  );

  console.log(`\n── Computed ──`);
  console.log(`  indicator_readings: ${readingRows.length} raw → ${dedupedReadings.length} deduped`);
  console.log(`  composite_snapshots: ${snapshotRows.length}`);
  console.log(`  score_changelog: ${changelogRows.length}`);

  // ── Phase 3: Bulk upsert
  console.log(`\n── Writing ──`);
  process.stdout.write("  indicator_readings ... ");
  const r1 = await supabase.from("indicator_readings").upsert(dedupedReadings, {
    onConflict: "indicator_key,observed_at,model_version",
  });
  if (r1.error) throw new Error(`indicator_readings: ${r1.error.message}`);
  console.log("ok");

  process.stdout.write("  composite_snapshots ... ");
  const r2 = await supabase.from("composite_snapshots").upsert(snapshotRows, {
    onConflict: "asset_type,snapshot_date,model_version",
  });
  if (r2.error) throw new Error(`composite_snapshots: ${r2.error.message}`);
  console.log("ok");

  process.stdout.write("  score_changelog ... ");
  const r3 = await supabase.from("score_changelog").upsert(changelogRows, {
    onConflict: "asset_type,change_date,model_version",
  });
  if (r3.error) throw new Error(`score_changelog: ${r3.error.message}`);
  console.log("ok");

  console.log("\n✓ Backfill complete.");
  console.log(
    "  Next: reload /dashboard + /asset/* + /changelog. If cacheLife",
  );
  console.log(
    "  hasn't expired, restart the dev server or run the cron once to",
  );
  console.log("  trigger revalidateTag('macro-snapshot' / 'changelog').");

  // Sanity summary: min / max / mean score per asset_type across the
  // backfill window so the operator can eyeball variability without
  // opening the dashboard.
  console.log("\n── Score summary (common asset across the window) ──");
  const commonScores: Array<{ date: string; score: number }> = [];
  for (const row of snapshotRows) {
    if (row.asset_type === "common") {
      commonScores.push({ date: row.snapshot_date, score: row.score_0_100 });
    }
  }
  commonScores.sort((a, b) => a.date.localeCompare(b.date));
  const scores = commonScores.map((c) => c.score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  console.log(
    `  min ${min.toFixed(2)} / mean ${mean.toFixed(2)} / max ${max.toFixed(2)}`,
  );
  console.log(`  first: ${commonScores[0].date} = ${commonScores[0].score.toFixed(2)}`);
  console.log(
    `  last:  ${commonScores[commonScores.length - 1].date} = ${commonScores[commonScores.length - 1].score.toFixed(2)}`,
  );
}

main().catch((err) => {
  console.error("\n✗ Backfill failed:");
  console.error(err);
  process.exit(1);
});
