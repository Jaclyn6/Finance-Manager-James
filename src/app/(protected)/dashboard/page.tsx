/**
 * Phase 1 dashboard stub. Real content (composite state card, asset
 * cards, recent changes) is Step 10's job; for now this just proves
 * the protected shell renders and navigation works.
 */
export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">대시보드</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          매크로 코어 + 자산군별 점수 카드는 데이터 파이프라인이 완성되면
          여기에 표시됩니다.
        </p>
      </div>
      <div className="rounded-lg border bg-card p-12 text-center text-sm text-muted-foreground">
        아직 수집된 스냅샷이 없습니다. 크론이 처음 실행되면 오늘의 상태가
        표시됩니다.
      </div>
    </div>
  );
}
