/**
 * Phase 1 changelog stub. Real content (date-sorted score deltas with
 * band-change highlight + top-mover indicators) is Step 11's job.
 */
export default function ChangelogPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">변화 로그</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          일자별 점수 변화와 주요 기여 지표는 데이터 파이프라인이 가동된 뒤
          여기에 누적됩니다.
        </p>
      </div>
      <div className="rounded-lg border bg-card p-12 text-center text-sm text-muted-foreground">
        아직 기록된 변화가 없습니다.
      </div>
    </div>
  );
}
