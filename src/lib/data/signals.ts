import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { computeSignals, type SignalInputs } from "@/lib/score-engine/signals";
import { SIGNAL_RULES_VERSION } from "@/lib/score-engine/weights";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Tables } from "@/types/database";

import { CACHE_TAGS } from "./tags";

/**
 * Signal-events data layer — reader + writer + input loader for the
 * blueprint §4.5 Signal Alignment engine.
 *
 * Scope (by design):
 * - The WRITER ({@link writeSignalEvents}) is called from the tail-call
 *   block of every cron ingestion endpoint (blueprint §5 routing
 *   table), immediately after the main ingest writes succeed. It is
 *   idempotent per `(snapshot_date, signal_rules_version)` — the
 *   composite PK from migration 0006 — via `upsert`.
 * - The INPUT LOADER ({@link loadSignalInputs}) is likewise cron-only.
 *   It queries the four reading tables to build the {@link SignalInputs}
 *   bundle consumed by `computeSignals`. No cache directive (cron
 *   context is fully dynamic). Accepts the admin client as an argument
 *   so the cron doesn't pay for a second admin-client instantiation
 *   per run.
 * - The READER ({@link getLatestSignalEvent}) is the UI path. It lives
 *   inside a `'use cache'` scope with `cacheTag(CACHE_TAGS.signals)` +
 *   `cacheLife('hours')`, matching the Phase 2 hourly cadence (§3.3):
 *   each successful hourly cron run invalidates the tag, any call
 *   within the hour serves the cache.
 *
 * Admin-client inside `'use cache'` — same rationale as
 * `src/lib/data/indicators.ts`:
 * 1. signal_events rows are family-wide (not per-user).
 * 2. `'use cache'` can't safely call `cookies()`, which the user-auth
 *    Supabase client depends on.
 * 3. Captured values in a cached scope must be serializable; creating
 *    the admin client inside the function body avoids the issue.
 *
 * Blueprint §7.4 invariant check: this file imports from
 * `@/lib/score-engine/signals` (pure) and `@/lib/score-engine/weights`
 * (pure). It does NOT import from `@/lib/data/prices` (forbidden for
 * anything that feeds a score; signals count as scoring). Good.
 */

/** Row shape of the `signal_events` table (Supabase generated types). */
export type SignalEventRow = Tables<"signal_events">;

/**
 * Shape of {@link writeSignalEvents}'s input — we accept the admin
 * client from the cron (avoids a second instantiation) and the
 * already-computed {@link SignalComputation}-ish fields.
 */
type AdminClient = ReturnType<typeof getSupabaseAdminClient>;

/**
 * Upsert one `signal_events` row for `(snapshotDate, signalRulesVersion)`.
 *
 * Called from the cron tail-call block (blueprint §5 routing). The
 * composite PK `(snapshot_date, signal_rules_version)` from migration
 * 0006 + the RLS policies in migration 0007 (service_role INSERT +
 * UPDATE granted) mean `upsert` is the correct primitive here:
 *   - First cron of the day → INSERT
 *   - Subsequent crons of the same day under the same rules version →
 *     UPDATE (last-write-wins per blueprint §7.3 idempotency rule)
 *   - SIGNAL_RULES_VERSION bump → parallel row (preserves audit trail
 *     per blueprint §2.3 + §4.5)
 *
 * Throws on DB error so the cron can capture the message into
 * `ingest_runs.error_summary`. The caller wraps the call in try/catch
 * so a signals-tail failure never aborts an otherwise successful
 * ingest (silent-success-on-signals-tail is a deliberate plan §0.5
 * carve-out — the main ingestion already succeeded, signals are a
 * derived artifact).
 */
export async function writeSignalEvents(
  supabase: AdminClient,
  snapshotDate: string,
  computation: ReturnType<typeof computeSignals>,
): Promise<void> {
  const row = {
    snapshot_date: snapshotDate,
    signal_rules_version: computation.signalRulesVersion,
    // JSONB array of active signal names, e.g. ["EXTREME_FEAR", "LIQUIDITY_EASING"]
    active_signals: computation.active as unknown as Tables<"signal_events">["active_signals"],
    alignment_count: computation.active.length,
    // JSONB map: { EXTREME_FEAR: { state, inputs, threshold }, ... }
    per_signal_detail:
      computation.perSignal as unknown as Tables<"signal_events">["per_signal_detail"],
    // `computed_at` must be set explicitly on every write. Migration
    // 0006's `DEFAULT now()` fires only on INSERT, but `.upsert(...)`
    // can take the UPDATE branch when a row for
    // `(snapshot_date, signal_rules_version)` already exists. Without
    // this, re-runs keep the original INSERT time and contradict the
    // "last-write-wins" contract documented above.
    computed_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("signal_events")
    .upsert(row, { onConflict: "snapshot_date,signal_rules_version" });

  if (error) {
    throw new Error(
      `writeSignalEvents failed: ${error.message} (${error.code ?? "no code"})`,
    );
  }
}

// ---------------------------------------------------------------------------
// Input loader
// ---------------------------------------------------------------------------

/** FRED indicator keys sourced from `indicator_readings` for signals. */
const FRED_SIGNAL_KEYS = ["VIXCLS", "ICSA", "SAHMCURRENT", "BAMLH0A0HYM2", "WDTGAL"] as const;

/** On-chain indicator keys sourced from `onchain_readings` for signals. */
const ONCHAIN_SIGNAL_KEYS = ["CNN_FG", "MVRV_Z", "SOPR"] as const;

/** BAML 7-day history size (blueprint §4.5 SPREAD_REVERSAL). */
const BAML_HISTORY_DAYS = 7;

/** TGA 20-day SMA window size (blueprint §4.5 LIQUIDITY_EASING). */
const WDTGAL_HISTORY_DAYS = 20;

/**
 * SPY MACD history window for the MOMENTUM_TURN cross detection. We
 * need at least `withinDays + 1 = 8` rows for the cross-in-last-7-days
 * check; a generous 30 gives cushion for missing daily rows (KR/US
 * holidays) without starving the signal.
 */
const SPY_MACD_HISTORY_DAYS = 30;

/**
 * Load the full {@link SignalInputs} bundle for a given `snapshotDate`.
 *
 * Queries (all service-role):
 * 1. `indicator_readings` for VIXCLS + ICSA + SAHMCURRENT (latest
 *    observed_at ≤ snapshotDate) + BAMLH0A0HYM2 (last 8 observations:
 *    today + 7d history) + WDTGAL (last 21 observations: today + 20d
 *    history).
 * 2. `onchain_readings` for CNN_FG + MVRV_Z + SOPR (latest observed_at
 *    ≤ snapshotDate). `onchain_readings` rows are written at most
 *    daily; taking the latest row ≤ today handles upstream outages
 *    without silently passing stale data (the `observed_at` stays
 *    visible for UI staleness gating).
 * 3. `technical_readings` for SPY + QQQ DISPARITY (latest observed_at
 *    ≤ snapshotDate) and SPY MACD_12_26_9 (last ~30 observations for
 *    the cross-detection window).
 *
 * ─ `model_version` cross-version policy ─────────────────────────────
 *
 * These queries do NOT filter on `model_version` on the underlying
 * reading tables. Mirroring `src/lib/data/indicators.ts` (greenfield-
 * coexistence rationale), at the v1 → v2 cutover the two versions
 * never share an `observed_at` for the same indicator key — v1 covers
 * pre-cutover reads and v2 post-cutover. A cross-version scan is
 * therefore safe today. When Phase 3 introduces v3 with a different
 * coexistence policy (e.g. parallel-write during evaluation), each
 * query here needs a per-call `model_version` filter. Leaving this
 * explicit here so the next maintainer doesn't silently regress.
 *
 * Per the ingest-technical writer (route.ts:311), MACD rows store:
 *   - `value_raw` = histogram (not macd-line)
 *   - `raw_payload` = `{ macd: <macd-line>, signal: <signal-line>,
 *                        histogram: <histogram> }`
 * So we pull MACD data from `raw_payload.macd` and `.signal` — NOT
 * from `value_raw`. Verified against
 * `src/app/api/cron/ingest-technical/route.ts` §2b.
 *
 * Null propagation: any missing reading yields `null` for the
 * corresponding {@link SignalInputs} field. History arrays with fewer
 * usable entries than expected are still passed through — the
 * evaluators handle short-history cases by returning `state:"unknown"`.
 *
 * @param supabase admin client (cron-owned)
 * @param snapshotDate 'YYYY-MM-DD' — typically today from cron perspective
 */
export async function loadSignalInputs(
  supabase: AdminClient,
  snapshotDate: string,
): Promise<SignalInputs> {
  // ---- 1. indicator_readings ----
  //
  // Fetch a bounded window of rows then collapse in JS. We pull up to
  // WDTGAL_HISTORY_DAYS + 10 days of FRED rows to ensure even with
  // weekend/holiday gaps we capture ≥ 20 usable WDTGAL observations.
  // The upper bound of 30 × 5 = 150 rows (WDTGAL_HISTORY_DAYS + 10 ×
  // FRED_SIGNAL_KEYS.length) is cheap — a single indexed query on
  // `indicator_readings_dedup`.
  const {
    data: fredRows,
    error: fredErr,
  } = await supabase
    .from("indicator_readings")
    .select("indicator_key, observed_at, value_raw, fetch_status")
    .in("indicator_key", [...FRED_SIGNAL_KEYS])
    .lte("observed_at", snapshotDate)
    .order("observed_at", { ascending: false })
    .limit((WDTGAL_HISTORY_DAYS + 10) * FRED_SIGNAL_KEYS.length);
  if (fredErr) {
    throw new Error(
      `loadSignalInputs indicator_readings query failed: ${fredErr.message}`,
    );
  }

  const byKey = new Map<string, Array<{ observed_at: string; value_raw: number | null }>>();
  for (const row of fredRows ?? []) {
    // Only treat 'success' rows as providing a usable value. Error /
    // partial rows have value_raw=null anyway but we double-guard.
    if (row.fetch_status !== "success") continue;
    const bucket = byKey.get(row.indicator_key) ?? [];
    bucket.push({ observed_at: row.observed_at, value_raw: row.value_raw });
    byKey.set(row.indicator_key, bucket);
  }

  // Helper: latest value-raw for a key (observed_at DESC already applied).
  const latestValue = (key: string): number | null => {
    const bucket = byKey.get(key);
    if (!bucket || bucket.length === 0) return null;
    return bucket[0].value_raw;
  };

  // VIX, ICSA, SAHMCURRENT — latest only.
  const vix = latestValue("VIXCLS");
  const icsa = latestValue("ICSA");
  const sahmCurrent = latestValue("SAHMCURRENT");

  // BAMLH0A0HYM2 — today + last 7-day history (need 8 rows total).
  const bamlBucket = (byKey.get("BAMLH0A0HYM2") ?? []).slice(
    0,
    BAML_HISTORY_DAYS + 1,
  );
  // bamlBucket is newest-first. Today is index 0, history is 1..7.
  const bamlH0A0HYM2Today = bamlBucket[0]?.value_raw ?? null;
  // Reverse to chronological (oldest-first) per SignalInputs convention.
  const bamlH0A0HYM2History = bamlBucket
    .slice(1, BAML_HISTORY_DAYS + 1)
    .reverse()
    .map((r) => r.value_raw);

  // WDTGAL — today + last 20-day history.
  const wdtgalBucket = (byKey.get("WDTGAL") ?? []).slice(
    0,
    WDTGAL_HISTORY_DAYS + 1,
  );
  const wdtgalToday = wdtgalBucket[0]?.value_raw ?? null;
  const wdtgalHistory = wdtgalBucket
    .slice(1, WDTGAL_HISTORY_DAYS + 1)
    .reverse()
    .map((r) => r.value_raw);

  // ---- 2. onchain_readings ----
  const {
    data: onchainRows,
    error: onchainErr,
  } = await supabase
    .from("onchain_readings")
    .select("indicator_key, observed_at, value_raw, fetch_status")
    .in("indicator_key", [...ONCHAIN_SIGNAL_KEYS])
    .lte("observed_at", snapshotDate)
    .order("observed_at", { ascending: false })
    .limit(ONCHAIN_SIGNAL_KEYS.length * 3); // latest per key + headroom
  if (onchainErr) {
    throw new Error(
      `loadSignalInputs onchain_readings query failed: ${onchainErr.message}`,
    );
  }

  const latestOnchain = (key: string): number | null => {
    for (const row of onchainRows ?? []) {
      if (row.indicator_key === key && row.fetch_status === "success") {
        return row.value_raw;
      }
    }
    return null;
  };

  const cnnFg = latestOnchain("CNN_FG");
  const mvrvZ = latestOnchain("MVRV_Z");
  const sopr = latestOnchain("SOPR");

  // ---- 3a. technical_readings — SPY + QQQ DISPARITY (latest only) ----
  //
  // Split into two per-ticker queries (run in parallel). A single
  // `.in('ticker', ['SPY','QQQ']).limit(N)` risks starving the sparser
  // ticker: Supabase applies the limit AFTER unioning the two ticker
  // partitions, so if SPY has N+ recent rows and QQQ is sparse, QQQ
  // can fall out of the returned window entirely. Per-ticker queries
  // with `.limit(5)` (modest headroom for non-success rows to skip)
  // guarantee each ticker contributes its own latest row.
  const latestDisparityFor = async (ticker: string): Promise<number | null> => {
    const { data, error } = await supabase
      .from("technical_readings")
      .select("observed_at, value_raw, fetch_status")
      .eq("ticker", ticker)
      .eq("indicator_key", "DISPARITY")
      .lte("observed_at", snapshotDate)
      .order("observed_at", { ascending: false })
      .limit(5);
    if (error) {
      throw new Error(
        `loadSignalInputs technical_readings (DISPARITY ${ticker}) query failed: ${error.message}`,
      );
    }
    for (const row of data ?? []) {
      if (row.fetch_status === "success") return row.value_raw;
    }
    return null;
  };

  const [spyDisparity, qqqDisparity] = await Promise.all([
    latestDisparityFor("SPY"),
    latestDisparityFor("QQQ"),
  ]);

  // ---- 3b. technical_readings — SPY MACD_12_26_9 history ----
  //
  // Per ingest-technical writer (route.ts:311), each MACD row's
  // `raw_payload` is `{ macd, signal, histogram }`. We pull the last
  // SPY_MACD_HISTORY_DAYS observations and reconstruct the paired
  // macd-line and signal-line history arrays (oldest-first) that
  // `evaluateMomentumTurn` expects.
  const {
    data: macdRows,
    error: macdErr,
  } = await supabase
    .from("technical_readings")
    .select("observed_at, raw_payload, fetch_status")
    .eq("ticker", "SPY")
    .eq("indicator_key", "MACD_12_26_9")
    .lte("observed_at", snapshotDate)
    .order("observed_at", { ascending: false })
    .limit(SPY_MACD_HISTORY_DAYS);
  if (macdErr) {
    throw new Error(
      `loadSignalInputs technical_readings (MACD) query failed: ${macdErr.message}`,
    );
  }

  // macdRows is newest-first; reverse to chronological.
  const macdChronological = (macdRows ?? []).slice().reverse();
  const spyMacdLine: (number | null)[] = [];
  const spyMacdSignal: (number | null)[] = [];
  for (const row of macdChronological) {
    // Only pull MACD line/signal from success rows. Error/partial rows
    // have raw_payload=null (writer contract) or an {error: ...} shape —
    // either way we push null for both sides, and the aligned-null
    // guard in `evaluateMomentumTurn` handles it.
    if (row.fetch_status !== "success" || !row.raw_payload) {
      spyMacdLine.push(null);
      spyMacdSignal.push(null);
      continue;
    }
    const payload = row.raw_payload as Record<string, unknown>;
    const macd =
      typeof payload.macd === "number" && Number.isFinite(payload.macd)
        ? (payload.macd as number)
        : null;
    const signal =
      typeof payload.signal === "number" && Number.isFinite(payload.signal)
        ? (payload.signal as number)
        : null;
    spyMacdLine.push(macd);
    spyMacdSignal.push(signal);
  }

  return {
    vix,
    cnnFg,
    spyDisparity,
    qqqDisparity,
    icsa,
    sahmCurrent,
    bamlH0A0HYM2Today,
    bamlH0A0HYM2History,
    wdtgalToday,
    wdtgalHistory,
    spyMacdLine,
    spyMacdSignal,
    mvrvZ,
    sopr,
  };
}

// ---------------------------------------------------------------------------
// Reader (cacheable)
// ---------------------------------------------------------------------------

/**
 * Returns the most recent `signal_events` row ≤ `snapshotDate` (or
 * the overall latest when `snapshotDate` is omitted).
 *
 * Filters on `signal_rules_version = SIGNAL_RULES_VERSION` to keep the
 * UI consistent with the engine that's live in code. Cross-version
 * historical reads are a Phase 3 concern (similar to the composite
 * model_version story — see `src/lib/data/indicators.ts` for the
 * greenfield-coexistence rationale).
 *
 * Returns `null` when there is no matching row — the UI renders a
 * "signals not yet computed" placeholder rather than an empty card.
 *
 * Cache: `CACHE_TAGS.signals` + `cacheLife('hours')`. Invalidated by
 * every cron tail-call block (blueprint §5 routing table).
 */
export async function getLatestSignalEvent(
  snapshotDate?: string,
): Promise<SignalEventRow | null> {
  "use cache";
  cacheTag(CACHE_TAGS.signals);
  cacheLife("hours");

  const supabase = getSupabaseAdminClient();
  let query = supabase
    .from("signal_events")
    .select("*")
    .eq("signal_rules_version", SIGNAL_RULES_VERSION)
    // No secondary tie-break order needed here: migration 0006 PK is
    // `(snapshot_date, signal_rules_version)`, and the `.eq(...)` above
    // pins `signal_rules_version`. Within that filter there is at most
    // one row per `snapshot_date`, so the DESC `snapshot_date` order is
    // already deterministic. Copy-pasting this pattern to a reader
    // whose filter does NOT uniquely determine the row per date must
    // add a secondary `.order(...)` (see indicators reader for the idiom).
    .order("snapshot_date", { ascending: false })
    .limit(1);

  if (snapshotDate) {
    query = query.lte("snapshot_date", snapshotDate);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(
      `getLatestSignalEvent failed: ${error.message} (${error.code ?? "no code"})`,
    );
  }

  return data?.[0] ?? null;
}
