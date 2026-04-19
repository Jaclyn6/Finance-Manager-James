/**
 * Phase 1 dashboard stub. Real content (composite state card, asset
 * cards, recent changes) is Step 10's job; for now this proves the
 * protected shell renders and navigation works.
 *
 * Typography leans Kraken-display: bold tracking-tight headline with a
 * near-black tone, muted secondary line, and a calm placeholder card.
 *
 * Responsive tokens (blueprint §6.2, v2.2): mobile-first scale —
 * `text-2xl` headline and tighter card padding at `<md`, scaling to
 * `text-3xl` and roomier padding at `md+`.
 */
export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 md:space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
          오늘 시장 상황
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          매크로 코어와 자산군별 합성 점수가 데이터 파이프라인 가동 이후
          여기에 표시됩니다.
        </p>
      </div>
      <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground md:p-12">
        아직 수집된 스냅샷이 없습니다. 크론이 처음 실행되면 오늘의 상태가
        표시됩니다.
      </div>
    </div>
  );
}
