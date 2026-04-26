import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import {
  loadOriginalSnapshots,
} from "@/lib/data/backtest-inputs";
import {
  buildInclusiveDateRange,
  filterToWeekdays,
  runBacktest,
  type BacktestRequest,
  type BacktestResult,
} from "@/lib/score-engine/backtest";
import { hashBacktestRequest } from "@/lib/score-engine/backtest-hash";
import {
  CURRENT_WEIGHTS_VERSION,
  WEIGHTS_REGISTRY,
  getWeights,
  type EngineWeights,
} from "@/lib/score-engine/weights-registry";
import { MODEL_VERSION } from "@/lib/score-engine/weights";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/types/database";

/**
 * Phase 3.4 Step 4 — `POST /api/backtest/run` route handler.
 *
 * Reference: docs/phase3_4_backtest_blueprint.md §2.3, §9 Step 4
 *
 * Pipeline:
 *   1. Auth via per-request server client cookie. RLS-protected, but
 *      we also explicitly fetch the user.id so we can stamp the
 *      `backtest_runs.user_id` column.
 *   2. Validate request body shape + 365-day cap.
 *   3. Compute request_hash for memoization. If a row exists with
 *      `(request_hash, user_id)` → load + reconstruct the
 *      BacktestResult from the persisted run + snapshots and return
 *      (no recomputation).
 *   4. Otherwise, look up EngineWeights from the registry (or load
 *      the user's custom-weights row if `customWeightsId` provided).
 *   5. Load OriginalSnapshots from `composite_snapshots` for the
 *      asset_type + range + model_version.
 *   6. Build the calendar date list (skip weekends for equity-class
 *      asset types; full-week for crypto).
 *   7. Call `runBacktest` (pure orchestrator).
 *   8. Insert backtest_runs (parent) + backtest_snapshots (children)
 *      transactionally via the admin client (service-role bypass for
 *      backtest_snapshots which has no user-side INSERT policy).
 *   9. Return the `BacktestResult`.
 *
 * Error model:
 *   - 401 if no authenticated session.
 *   - 400 for malformed body / range > 365 / unknown weights version.
 *   - 500 for DB-side failures.
 *
 * Vercel runtime budget:
 *   - `maxDuration = 60` is plenty — replay is pure JS over <365 rows.
 *   - No external HTTP calls; no fetch budget concerns.
 */

export const maxDuration = 60;

const MAX_RANGE_DAYS = 365;

type SupabaseAdmin = ReturnType<typeof getSupabaseAdminClient>;

interface PostBody {
  weightsVersion?: string;
  /** When `weightsVersion === "custom"`, this points to a `user_weights.id`. */
  customWeightsId?: string;
  modelVersion?: string;
  assetType?: Database["public"]["Enums"]["asset_type_enum"];
  dateRange?: { from?: string; to?: string };
}

const ASSET_TYPES: ReadonlyArray<
  Database["public"]["Enums"]["asset_type_enum"]
> = ["us_equity", "kr_equity", "crypto", "global_etf", "common"];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ---- 1. Auth ----
  const userClient = await getSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser();
  if (authError || !user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  // ---- 2. Validate body ----
  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const validation = validateRequest(body);
  if ("error" in validation) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const { request: backtestRequest, customWeightsId } = validation;

  // ---- 3. Memoization lookup ----
  const requestHash = hashBacktestRequest(backtestRequest);
  const admin = getSupabaseAdminClient();

  const cached = await loadCachedRun(admin, requestHash, user.id);
  if (cached) {
    return NextResponse.json(cached, { status: 200 });
  }

  // ---- 4. Resolve weights ----
  let weights: EngineWeights;
  let resolvedUserWeightsId: string | null = null;
  if (customWeightsId) {
    const customRow = await admin
      .from("user_weights")
      .select("id, payload, user_id")
      .eq("id", customWeightsId)
      .maybeSingle();
    if (customRow.error) {
      return NextResponse.json(
        { error: `user_weights lookup failed: ${customRow.error.message}` },
        { status: 500 },
      );
    }
    if (!customRow.data) {
      return NextResponse.json(
        { error: `user_weights row not found: ${customWeightsId}` },
        { status: 400 },
      );
    }
    weights = customRow.data.payload as unknown as EngineWeights;
    resolvedUserWeightsId = customRow.data.id;
  } else {
    if (!WEIGHTS_REGISTRY[backtestRequest.weightsVersion]) {
      return NextResponse.json(
        {
          error: `Unknown weightsVersion: ${backtestRequest.weightsVersion}. Known: ${Object.keys(
            WEIGHTS_REGISTRY,
          ).join(", ")}`,
        },
        { status: 400 },
      );
    }
    weights = getWeights(backtestRequest.weightsVersion);
  }

  // ---- 5. Load originals ----
  const startMs = Date.now();
  const originalsByDate = await loadOriginalSnapshots(
    admin,
    backtestRequest.assetType,
    backtestRequest.dateRange,
    backtestRequest.modelVersion,
  );

  // ---- 6. Build date list (weekends skipped for equity-class) ----
  const allDates = buildInclusiveDateRange(
    backtestRequest.dateRange.from,
    backtestRequest.dateRange.to,
  );
  const dateList =
    backtestRequest.assetType === "crypto"
      ? allDates
      : filterToWeekdays(allDates);

  // ---- 7. Run replay ----
  const result = runBacktest(
    backtestRequest,
    weights,
    originalsByDate,
    dateList,
  );
  const durationMs = Date.now() - startMs;

  // ---- 8. Persist parent + children ----
  await persistRun(
    admin,
    user.id,
    requestHash,
    result,
    durationMs,
    resolvedUserWeightsId,
  );

  // ---- 9. Return ----
  return NextResponse.json(result, { status: 200 });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateRequest(
  body: PostBody,
):
  | { request: BacktestRequest; customWeightsId: string | null }
  | { error: string } {
  // assetType
  if (!body.assetType || !ASSET_TYPES.includes(body.assetType)) {
    return {
      error: `assetType is required and must be one of: ${ASSET_TYPES.join(", ")}`,
    };
  }
  // dateRange
  const from = body.dateRange?.from;
  const to = body.dateRange?.to;
  if (!from || !ISO_DATE.test(from)) {
    return { error: "dateRange.from must be YYYY-MM-DD" };
  }
  if (!to || !ISO_DATE.test(to)) {
    return { error: "dateRange.to must be YYYY-MM-DD" };
  }
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    return { error: "dateRange contains invalid date" };
  }
  if (toMs < fromMs) {
    return { error: "dateRange.to must be >= dateRange.from" };
  }
  const days = Math.ceil((toMs - fromMs) / (1000 * 60 * 60 * 24)) + 1;
  if (days > MAX_RANGE_DAYS) {
    return {
      error: `Date range exceeds ${MAX_RANGE_DAYS} days (got ${days})`,
    };
  }

  // weightsVersion + customWeightsId mutual exclusivity
  const weightsVersion = body.weightsVersion ?? CURRENT_WEIGHTS_VERSION;
  const customWeightsId = body.customWeightsId ?? null;
  if (
    customWeightsId &&
    !/^[0-9a-f-]{36}$/i.test(customWeightsId)
  ) {
    return { error: "customWeightsId must be a UUID" };
  }

  // modelVersion (optional, defaults to current MODEL_VERSION)
  const modelVersion = body.modelVersion ?? MODEL_VERSION;

  return {
    request: {
      weightsVersion: customWeightsId
        ? `custom-${customWeightsId.slice(0, 8)}`
        : weightsVersion,
      modelVersion,
      assetType: body.assetType,
      dateRange: { from, to },
    },
    customWeightsId,
  };
}

async function loadCachedRun(
  admin: SupabaseAdmin,
  requestHash: string,
  userId: string,
): Promise<BacktestResult | null> {
  const { data: runRow, error } = await admin
    .from("backtest_runs")
    .select("id, request_json")
    .eq("request_hash", requestHash)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return null;
  if (!runRow) return null;

  const { data: snapshotRows, error: snapErr } = await admin
    .from("backtest_snapshots")
    .select(
      "snapshot_date, replay_score, replay_band, original_score, original_model_version, delta, contributing, gaps",
    )
    .eq("run_id", runRow.id)
    .order("snapshot_date", { ascending: true });
  if (snapErr) return null;
  if (!snapshotRows) return null;

  const snapshots = snapshotRows.map((r) => ({
    date: r.snapshot_date,
    replayScore: numericOrNull(r.replay_score),
    replayBand: r.replay_band,
    replayContributing:
      r.contributing && typeof r.contributing === "object" && !Array.isArray(r.contributing)
        ? (r.contributing as Record<string, never>)
        : {},
    originalScore: numericOrNull(r.original_score),
    originalModelVersion: r.original_model_version,
    delta: numericOrNull(r.delta),
    gaps: r.gaps ?? [],
  }));

  const summary = await loadCachedSummary(admin, runRow.id);
  if (!summary) return null;

  return {
    request: runRow.request_json as unknown as BacktestRequest,
    snapshots: snapshots as BacktestResult["snapshots"],
    summary,
  };
}

async function loadCachedSummary(
  admin: SupabaseAdmin,
  runId: string,
): Promise<BacktestResult["summary"] | null> {
  const { data, error } = await admin
    .from("backtest_runs")
    .select(
      "total_days, days_with_replay, days_missing_inputs, avg_abs_delta, max_abs_delta, days_above_5pp",
    )
    .eq("id", runId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    totalDays: data.total_days,
    daysWithReplay: data.days_with_replay,
    daysMissingInputs: data.days_missing_inputs,
    avgAbsDelta: numericOrNull(data.avg_abs_delta),
    maxAbsDelta: numericOrNull(data.max_abs_delta),
    daysAboveFivePp: data.days_above_5pp,
  };
}

async function persistRun(
  admin: SupabaseAdmin,
  userId: string,
  requestHash: string,
  result: BacktestResult,
  durationMs: number,
  userWeightsId: string | null,
): Promise<void> {
  const { request, summary, snapshots } = result;

  // Upsert the parent run row.
  const { data: runRow, error: runErr } = await admin
    .from("backtest_runs")
    .upsert(
      {
        user_id: userId,
        request_hash: requestHash,
        request_json: request as unknown as Json,
        asset_type: request.assetType,
        date_from: request.dateRange.from,
        date_to: request.dateRange.to,
        model_version: request.modelVersion,
        weights_version: request.weightsVersion,
        user_weights_id: userWeightsId,
        total_days: summary.totalDays,
        days_with_replay: summary.daysWithReplay,
        days_missing_inputs: summary.daysMissingInputs,
        avg_abs_delta: summary.avgAbsDelta,
        max_abs_delta: summary.maxAbsDelta,
        days_above_5pp: summary.daysAboveFivePp,
        duration_ms: durationMs,
      },
      { onConflict: "request_hash,user_id" },
    )
    .select("id")
    .single();
  if (runErr || !runRow) {
    throw new Error(
      `backtest_runs upsert failed: ${runErr?.message ?? "no row"}`,
    );
  }

  // Wipe + reinsert snapshot rows. CASCADE delete via FK.
  await admin.from("backtest_snapshots").delete().eq("run_id", runRow.id);
  if (snapshots.length === 0) return;

  const rows = snapshots.map((s) => ({
    run_id: runRow.id,
    snapshot_date: s.date,
    replay_score: s.replayScore,
    replay_band: s.replayBand,
    original_score: s.originalScore,
    original_model_version: s.originalModelVersion,
    delta: s.delta,
    contributing: s.replayContributing as unknown as Json,
    signal_state: null,
    gaps: s.gaps as unknown as string[],
  }));

  const { error: snapErr } = await admin
    .from("backtest_snapshots")
    .insert(rows);
  if (snapErr) {
    throw new Error(`backtest_snapshots insert failed: ${snapErr.message}`);
  }
}

function numericOrNull(v: number | null | string): number | null {
  if (v === null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}
