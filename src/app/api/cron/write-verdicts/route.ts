import "server-only";

import { revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";

import { verifyCronSecret } from "@/lib/auth/cron-secret";
import { proxyToOnchainRow } from "@/lib/advisor/proxy-row";
import { verdictToRow } from "@/lib/advisor/verdict-row";
import { getAdvisorViews, getStockFgProxy } from "@/lib/data/advisor";
import { writeIngestRun } from "@/lib/data/snapshot";
import { CACHE_TAGS } from "@/lib/data/tags";
import { ADVISOR_ENGINE_VERSION } from "@/lib/advisor/verdict";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { DASHBOARD_ASSET_ORDER } from "@/lib/utils/asset-labels";
import type { TablesInsert } from "@/types/database";

/**
 * Daily advisor-verdict persistence — verdict history part 2/3
 * (migration 0015; docs/advisor_pivot_blueprint.md §6).
 *
 * Runs as the THIRD step of the cron-technical workflow, strictly
 * AFTER ingest-technical + ingest-prices have written the day's final
 * bars and invalidated their tags. Being a separate REQUEST matters:
 * `getAdvisorViews`' cached readers recompute fresh here, whereas a
 * tail inside the ingest route could still observe same-request
 * pre-invalidation cache entries.
 *
 * Pipeline:
 *   1. Authenticate `Authorization: Bearer ${CRON_SECRET}`.
 *   2. `getAdvisorViews(today)` — the exact views the dashboard
 *      renders (same engine, same inputs; a persisted verdict can
 *      never disagree with what the family saw that day).
 *   3. Serialize via `verdictToRow` and upsert on
 *      (asset_type, verdict_date, engine_version) — same-day reruns
 *      overwrite with the latest computation, matching every other
 *      idempotent writer in the pipeline.
 *   4. `ingest_runs` audit row (always, even on failure).
 *   5. `revalidateTag(advisorVerdicts, { expire: 0 })` on success.
 *
 * Scale: 5 asset types × 1 row/day. Trivial.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const startMs = Date.now();

  const authResult = verifyCronSecret(request);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.reason }, { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);

  let rowsWritten = 0;
  // Intended scope, not observed scope: if getAdvisorViews throws, the
  // audit row must still say how many verdicts SHOULD have been
  // written — a 0/0 row would hide the failure's scale (Trigger 2
  // review note, 2026-07-08).
  let attempted = DASHBOARD_ASSET_ORDER.length;
  let errorSummary: string | null = null;

  try {
    const views = await getAdvisorViews(today);
    attempted = views.length;

    const rows: TablesInsert<"advisor_verdicts">[] = views.map((view) =>
      verdictToRow(view.assetType, today, view.verdict),
    );

    const supabase = getSupabaseAdminClient();
    const { error } = await supabase
      .from("advisor_verdicts")
      .upsert(rows, { onConflict: "asset_type,verdict_date,engine_version" });
    if (error) {
      throw new Error(
        `advisor_verdicts upsert failed: ${error.message} (${error.code ?? "no code"})`,
      );
    }
    rowsWritten = rows.length;

    // Persist today's STOCK_FG_PROXY alongside the verdicts (raw-only
    // provenance row — see proxyToOnchainRow). Soft-failure: proxy
    // history is enrichment; the verdict rows above already landed.
    try {
      const proxy = await getStockFgProxy(today);
      const { error: proxyError } = await supabase
        .from("onchain_readings")
        .upsert(proxyToOnchainRow(proxy, today), {
          onConflict: "indicator_key,observed_at,model_version",
        });
      if (proxyError) {
        throw new Error(
          `STOCK_FG_PROXY upsert failed: ${proxyError.message} (${proxyError.code ?? "no code"})`,
        );
      }
    } catch (proxyErr) {
      const msg =
        proxyErr instanceof Error ? proxyErr.message : String(proxyErr);
      console.error("[cron write-verdicts] proxy persist failed:", msg);
      errorSummary = errorSummary
        ? `${errorSummary}; proxy_persist: ${msg}`
        : `proxy_persist: ${msg}`;
    }
  } catch (err) {
    errorSummary = err instanceof Error ? err.message : String(err);
    console.error("[cron write-verdicts] failed:", errorSummary);
  }

  const durationMs = Date.now() - startMs;

  // Audit row — reuses the shared ingest_runs shape: attempted/success
  // count VERDICTS here (engine_version in model_version keeps these
  // rows distinguishable from FRED/technical ingest rows).
  try {
    await writeIngestRun({
      model_version: ADVISOR_ENGINE_VERSION,
      indicators_attempted: attempted,
      indicators_success: rowsWritten,
      indicators_failed: attempted - rowsWritten,
      snapshots_written: rowsWritten,
      error_summary: errorSummary,
      duration_ms: durationMs,
    });
  } catch (auditErr) {
    console.error("[cron write-verdicts] audit write failed:", auditErr);
  }

  if (rowsWritten > 0) {
    revalidateTag(CACHE_TAGS.advisorVerdicts, { expire: 0 });
  }

  const status: "success" | "error" = errorSummary ? "error" : "success";
  return NextResponse.json(
    {
      status,
      verdict_date: today,
      engine_version: ADVISOR_ENGINE_VERSION,
      verdicts_attempted: attempted,
      verdicts_written: rowsWritten,
      duration_ms: durationMs,
      error_summary: errorSummary,
    },
    { status: status === "error" ? 500 : 200 },
  );
}
