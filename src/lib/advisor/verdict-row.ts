import type { Json, TablesInsert } from "@/types/database";

import type { AdvisorVerdict } from "./types";
import { ADVISOR_ENGINE_VERSION } from "./verdict";

/**
 * Serializes one computed verdict into an `advisor_verdicts` insert
 * row. Pure (types-only imports), so the cron write path's mapping is
 * unit-testable without Supabase mocks.
 *
 * Column mapping:
 * - scalars (`label`, `net_score`, `confidence`, `drawdown_pct`,
 *   `peak_date`) are lifted out of the verdict so timeline / flip
 *   queries never parse JSONB;
 * - `evidence` keeps the FULL verdict object (headline, evidence
 *   sentences, per-pillar breakdown, drawdown state) for forensics
 *   and future UI — regenerating it later is impossible once the
 *   inputs' caches roll;
 * - `verdict_date` is the COMPUTATION day (caller passes the same
 *   endDate the advisor was asked to judge), not the last price date:
 *   weekend rows honestly repeat Friday's judgment rather than
 *   leaving timeline gaps.
 */
export function verdictToRow(
  assetType: TablesInsert<"advisor_verdicts">["asset_type"],
  verdictDate: string,
  verdict: AdvisorVerdict,
): TablesInsert<"advisor_verdicts"> {
  return {
    asset_type: assetType,
    verdict_date: verdictDate,
    engine_version: ADVISOR_ENGINE_VERSION,
    label: verdict.label,
    net_score: verdict.netScore,
    confidence: verdict.confidence,
    drawdown_pct: verdict.drawdown?.drawdownPct ?? null,
    peak_date: verdict.drawdown?.peakDate ?? null,
    evidence: verdict as unknown as Json,
  };
}
