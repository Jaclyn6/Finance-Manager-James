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
 * `(auth)/login/page.tsx`: the outer page is synchronous and passes
 * the `params` Promise down into a Suspense-wrapped child where the
 * await happens.
 *
 * Status-code caveat: `notFound()` fires inside the Suspense-wrapped
 * slot. By the time the slot resolves and calls `notFound()`, Next.js
 * has already committed a 200 response header via the streaming
 * prerender — so unknown slugs render the not-found UI but with HTTP
 * 200, not 404. The user experience is correct (they see the 404
 * page); only the status code is wrong. Accepted as a Phase 1 tradeoff
 * for a private family dashboard where SEO and link-checker behavior
 * don't matter. The conventional fix (`export const dynamicParams =
 * false` alongside `generateStaticParams`) is rejected by Next 16
 * under `cacheComponents: true`.
 *
 * `generateStaticParams` is still declared so the four known slugs
 * are prerendered at build time (faster first render) and so the
 * whitelist is machine-checkable in one place.
 *
 * When real data fetching lands in Step 10, the inner slot can adopt
 * `'use cache'` + `cacheTag('macro-snapshot')` + `cacheLife('days')`
 * — but only with the resolved slug passed as a serializable string
 * arg into the cached helper, not the Promise itself.
 */
const ASSET_LABELS: Record<string, string> = {
  "us-equity": "미국주식",
  "kr-equity": "한국주식",
  crypto: "암호화폐",
  "global-etf": "글로벌 ETF",
};

type AssetParams = Promise<{ slug: string }>;

export function generateStaticParams() {
  return Object.keys(ASSET_LABELS).map((slug) => ({ slug }));
}

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

  // `Object.hasOwn` check (instead of `ASSET_LABELS[slug]` directly)
  // closes a prototype-pollution hole where `/asset/toString`,
  // `/asset/constructor`, etc. would resolve to the inherited
  // `Object.prototype` member — a truthy function value — and bypass
  // the `!label` 404 guard.
  const label = Object.hasOwn(ASSET_LABELS, slug) ? ASSET_LABELS[slug] : undefined;

  if (!label) {
    notFound();
  }

  return (
    <div className="space-y-6 md:space-y-8">
      <div>
        <div className="inline-flex rounded-md bg-brand-subtle px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand-dark">
          자산군
        </div>
        <h1 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">
          {label}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          자산군별 합성 점수·기여 지표·30일 추이 차트는 Step 10에서 연결됩니다.
        </p>
      </div>
      <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground md:p-12">
        이 자산군에 대한 스냅샷은 아직 집계되지 않았습니다.
      </div>
    </div>
  );
}

function AssetDetailSkeleton() {
  return (
    <div className="space-y-6 md:space-y-8">
      <div className="space-y-2">
        <Skeleton className="h-4 w-16 rounded-md" />
        <Skeleton className="h-8 w-40 md:h-9" />
        <Skeleton className="h-4 w-full max-w-[420px]" />
      </div>
      <Skeleton className="h-48 w-full rounded-2xl" />
    </div>
  );
}
