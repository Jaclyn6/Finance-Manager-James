/**
 * Persistent disclaimer banner required by PRD §11.5 and §2.3. Renders
 * at the top of every protected page so the user is never more than a
 * glance away from knowing this is a reference/interpretation tool,
 * not a definitive financial recommendation.
 *
 * Kraken-inspired styling: calm neutral surface with a purple "참고용"
 * chip and near-black body. The Kraken aesthetic reserves alarmist
 * colors for real problems; a standing reminder should feel
 * trustworthy, not jittery.
 */
export function DisclaimerBanner() {
  return (
    <div className="border-b bg-muted/60 px-4 py-2 text-xs text-foreground/75">
      <div className="mx-auto flex max-w-7xl items-center gap-3">
        <span className="inline-flex items-center rounded-md bg-brand-subtle px-2 py-0.5 text-[11px] font-semibold tracking-wide text-brand-dark uppercase">
          참고용
        </span>
        <span>
          매크로·기술적·온체인 데이터를 결합한 해석 도구입니다. 확정적 투자
          자문이 아니며, 모든 투자 결정의 책임은 사용자에게 있습니다.
        </span>
      </div>
    </div>
  );
}
