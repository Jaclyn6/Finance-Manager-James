import { connection } from "next/server";

import { BacktestPanel } from "@/components/backtest/backtest-panel";
import { FamilyRunsReader } from "@/components/backtest/family-runs-reader";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  CURRENT_WEIGHTS_VERSION,
  WEIGHTS_REGISTRY_KEYS,
} from "@/lib/score-engine/weights-registry";
import { MODEL_VERSION } from "@/lib/score-engine/weights";
import { todayIsoUtc } from "@/lib/utils/date";

/**
 * Phase 3.4 Step 5 — Backtest page server-rendered shell.
 *
 * Reads searchParams to determine initial form state, then renders a
 * Client Component panel that owns the form + chart + summary + table.
 * The panel POSTs to `/api/backtest/run` on submit and re-renders
 * with the result.
 *
 * Default range when no searchParams provided: last 90 days from today.
 * Default asset_type: us_equity. Default weights: CURRENT_WEIGHTS_VERSION.
 */
export async function BacktestContent({
  searchParams,
}: {
  searchParams: Promise<{
    asset?: string;
    from?: string;
    to?: string;
    weights?: string;
  }>;
}) {
  const sp = await searchParams;
  // Wall-clock today is dynamic — opt out of cache for this subtree.
  await connection();

  const today = todayIsoUtc();
  const ninetyDaysAgo = isoMinusDays(today, 90);

  const initialAssetType =
    typeof sp.asset === "string" &&
    ["us_equity", "kr_equity", "crypto", "global_etf"].includes(sp.asset)
      ? (sp.asset as "us_equity" | "kr_equity" | "crypto" | "global_etf")
      : "us_equity";
  const initialFrom =
    typeof sp.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.from)
      ? sp.from
      : ninetyDaysAgo;
  const initialTo =
    typeof sp.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.to)
      ? sp.to
      : today;
  const initialWeightsVersion =
    typeof sp.weights === "string" && WEIGHTS_REGISTRY_KEYS.includes(sp.weights)
      ? sp.weights
      : CURRENT_WEIGHTS_VERSION;

  return (
    <>
      <div>
        <Eyebrow />
        <h1 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">
          백테스트
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          과거 점수를 현재 산식 또는 선택한 가중치로 다시 계산해 비교합니다.
          가중치를 직접 조정해 점수가 어떻게 달라지는지 실험할 수도 있습니다.
        </p>
      </div>

      <BacktestPanel
        initial={{
          assetType: initialAssetType,
          dateRange: { from: initialFrom, to: initialTo },
          weightsVersion: initialWeightsVersion,
        }}
        modelVersion={MODEL_VERSION}
        availableWeightsVersions={WEIGHTS_REGISTRY_KEYS}
      />

      {/* Step 8 — family-shared backtest reader */}
      <FamilyRunsReaderServer />
    </>
  );
}

async function FamilyRunsReaderServer() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: rows } = await supabase
    .from("backtest_runs")
    .select(
      "id, user_id, asset_type, date_from, date_to, weights_version, avg_abs_delta, days_above_5pp, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(20);

  // Resolve user_id → email best-effort. RLS lets us read the
  // backtest row but auth.users is not directly readable; we use a
  // placeholder until a future iteration plumbs user metadata
  // through a dedicated reader.
  const initial = (rows ?? []).map((r) => ({
    ...r,
    avg_abs_delta:
      typeof r.avg_abs_delta === "number"
        ? r.avg_abs_delta
        : r.avg_abs_delta === null
          ? null
          : Number(r.avg_abs_delta),
    user_email: r.user_id ? r.user_id.slice(0, 8) : null,
  }));

  return (
    <FamilyRunsReader initialRows={initial} currentUserId={user?.id ?? null} />
  );
}

function Eyebrow() {
  return (
    <div className="inline-flex rounded-md bg-brand-subtle px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand-dark">
      분석
    </div>
  );
}

function isoMinusDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
