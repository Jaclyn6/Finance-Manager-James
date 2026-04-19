import { Suspense } from "react";

import { listAllAssetSlugs } from "@/lib/utils/asset-slug";

import { AssetContent } from "./asset-content";
import { AssetSkeleton } from "./asset-skeleton";

/**
 * Phase 1 Step 11 — Asset detail page (date-aware).
 *
 * Same Partial Prerender pattern as the dashboard: static shell
 * (minimal, since the real heading comes from the resolved asset
 * label) + `<Suspense>`-gated `AssetContent` that awaits both
 * `params` and `searchParams`. Both Promises are passed down
 * unawaited from this function so the static shell can prerender
 * under `cacheComponents: true`.
 *
 * `generateStaticParams` still declares the four known slugs so
 * build-time prerenders exist for them and the whitelist is
 * machine-checkable in one place.
 *
 * Status-code caveat unchanged from the Step 6 stub: unknown slugs
 * render the not-found UI but with HTTP 200, because by the time the
 * Suspense slot resolves and calls `notFound()`, Next.js has already
 * committed the response header. Accepted Phase 1 tradeoff for a
 * private family dashboard where SEO doesn't matter.
 */
export function generateStaticParams() {
  return listAllAssetSlugs().map((slug) => ({ slug }));
}

export default function AssetDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  return (
    <div className="mx-auto max-w-5xl">
      <Suspense fallback={<AssetSkeleton />}>
        <AssetContent params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
