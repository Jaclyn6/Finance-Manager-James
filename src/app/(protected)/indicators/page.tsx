import { Suspense } from "react";

import { IndicatorsContent } from "./indicators-content";
import { IndicatorsSkeleton } from "./indicators-skeleton";

/**
 * Phase 2 — Indicator glossary page (`/indicators`).
 *
 * Static shell + Suspense-gated content body, mirroring the
 * `/changelog` and `/dashboard` Partial Prerender pattern. The body
 * itself imports a pure module ({@link ../../lib/utils/indicator-glossary})
 * so it has no runtime data dependency, but the Suspense seam keeps
 * the shape consistent across protected routes and gives us room to
 * add per-user customization (e.g. "favorited indicators") later
 * without restructuring the page.
 *
 * Surfaces all 23 Phase 2 indicators grouped by category — macro,
 * macro_signal, regional_overlay, technical, onchain, sentiment —
 * with beginner-friendly Korean explanations, bullish/bearish cases,
 * typical thresholds, and source links.
 *
 * PRD §13.2 / §11.5 disclaimer is reinforced in the intro paragraph
 * so the user is reminded — even on this education-heavy surface —
 * that the framing is interpretive, never a guarantee.
 */
export default function IndicatorsPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 md:space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
          지표 사전
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          대시보드와 자산 페이지에서 점수에 반영되는 23개 지표를 카테고리별로
          모아 둔 용어 설명입니다. 각 항목의 상승·하락 시 자산 배분 시사점은
          역사적 평균에 기반한 해석이며, 확정적 투자 자문이 아닙니다. 모든
          투자 결정의 책임은 사용자에게 있습니다.
        </p>
      </div>

      <Suspense fallback={<IndicatorsSkeleton />}>
        <IndicatorsContent />
      </Suspense>
    </div>
  );
}
