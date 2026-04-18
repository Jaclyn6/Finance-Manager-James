/**
 * Phase 1 dashboard stub. Real content (composite state card, asset
 * cards, recent changes) is Step 10's job; for now this proves the
 * protected shell renders and navigation works.
 *
 * Typography leans Kraken-display: bold tracking-tight headline with a
 * near-black tone, muted secondary line, and a calm placeholder card.
 */
export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="text-4xl font-bold tracking-tight">오늘의 상태</h1>
        <p className="mt-2 max-w-2xl text-base text-muted-foreground">
          매크로 코어와 자산군별 합성 점수가 데이터 파이프라인 가동 이후
          여기에 표시됩니다.
        </p>
      </div>
      <div className="rounded-2xl border bg-card p-12 text-center text-sm text-muted-foreground">
        아직 수집된 스냅샷이 없습니다. 크론이 처음 실행되면 오늘의 상태가
        표시됩니다.
      </div>
    </div>
  );
}
