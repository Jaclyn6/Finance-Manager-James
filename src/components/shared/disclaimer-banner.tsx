import { Badge } from "@/components/ui/badge";

/**
 * Persistent disclaimer banner required by PRD §11.5 and §2.3. Renders
 * at the top of every protected page so the user is never more than a
 * glance away from knowing this is a reference/interpretation tool,
 * not a definitive financial recommendation.
 *
 * Styling uses amber tokens to draw the eye without screaming.
 */
export function DisclaimerBanner() {
  return (
    <div className="border-b border-amber-500/30 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
      <div className="mx-auto flex max-w-7xl items-center gap-2">
        <Badge variant="outline" className="border-amber-500/50 bg-transparent">
          참고용
        </Badge>
        <span>
          이 대시보드는 매크로·기술적·온체인 데이터를 결합한 해석 도구입니다.
          확정적 투자 자문이 아니며, 모든 투자 결정의 책임은 사용자에게 있습니다.
        </span>
      </div>
    </div>
  );
}
