import { Suspense } from "react";

import { notFound } from "next/navigation";

import { Skeleton } from "@/components/ui/skeleton";

/**
 * Phase 1 asset-detail stub. Valid slugs map to asset_type_enum values
 * from the Supabase schema; unknown slugs 404 so typos don't silently
 * render empty shells.
 *
 * Under `cacheComponents: true`, awaiting a page's `params` Promise at
 * the top-level turns the route into blocking dynamic content and
 * fails the prerender. The fix is the same pattern we use at
 * `(auth)/login/page.tsx`: the outer page is synchronous and just
 * passes the `params` Promise down into a Suspense-wrapped child
 * where the await happens.
 *
 * When real data fetching lands in Step 10, the inner slot can adopt
 * `'use cache'` + `cacheTag('macro-snapshot')` + `cacheLife('days')`
 * — but only with the resolved slug passed as a serializable string
 * arg into the cached helper, not the Promise itself.
 */
const ASSET_LABELS: Record<string, string> = {
  "us-equity": "미국주식",
  "kr-equity": "한국주식",
  btc: "BTC",
  "global-etf": "글로벌 ETF",
};

type AssetParams = Promise<{ slug: string }>;

export default function AssetDetailPage({ params }: { params: AssetParams }) {
  return (
    <div className="mx-auto max-w-5xl">
      <Suspense fallback={<AssetDetailSkeleton />}>
        <AssetDetailSlot params={params} />
      </Suspense>
    </div>
  );
}

async function AssetDetailSlot({ params }: { params: AssetParams }) {
  const { slug } = await params;
  const label = ASSET_LABELS[slug];

  if (!label) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{label}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          자산군별 합성 점수·기여 지표·30일 추이 차트는 Step 10에서 연결됩니다.
        </p>
      </div>
      <div className="rounded-lg border bg-card p-12 text-center text-sm text-muted-foreground">
        이 자산군에 대한 스냅샷은 아직 집계되지 않았습니다.
      </div>
    </div>
  );
}

function AssetDetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-96" />
      </div>
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
