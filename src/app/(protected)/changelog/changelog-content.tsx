import { connection } from "next/server";

import { ChangelogRow } from "@/components/changelog/changelog-row";
import { getChangelogAroundDate } from "@/lib/data/changelog";
import { sanitizeDateParam, todayIsoUtc } from "@/lib/utils/date";

/**
 * Dynamic body of `/changelog` — ±14-day window of score_changelog
 * rows around the selected (or latest) anchor date.
 *
 * PRD §11.3 표면화 대상:
 * - 날짜별 점수 변화  → row's change_date + previous/current score
 * - 변화 원인 지표    → ChangelogRow's 주요 변동 지표 section
 * - 상태 전환 전/후   → previous_band → current_band + band-change highlight
 * - 데이터 지연/실패  → currently implied by fetch_status on the
 *                        upstream snapshots; the changelog itself
 *                        doesn't carry a status column in Phase 1
 *
 * Window stays 14 days either side regardless of selected date —
 * gives ~4 weeks of surrounding context, matching the dashboard's
 * RecentChanges window so the two surfaces feel consistent.
 */
const CHANGELOG_WINDOW_DAYS = 14;

export async function ChangelogContent({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  const sp = await searchParams;
  const today = todayIsoUtc();
  const selectedDate = sanitizeDateParam(sp.date, today);

  if (selectedDate === null) {
    await connection();
  }

  const anchorDate = selectedDate ?? today;
  const rows = await getChangelogAroundDate(anchorDate, CHANGELOG_WINDOW_DAYS);

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground md:p-12">
        {anchorDate} 기준 ±{CHANGELOG_WINDOW_DAYS}일 범위 내 변화 기록이
        없습니다. 최초 크론 실행 직후에는 이전 비교 대상이 없어 변화 로그가
        비어 있을 수 있습니다.
      </div>
    );
  }

  return (
    <div className="space-y-3 md:space-y-4">
      {rows.map((row) => (
        <ChangelogRow key={row.id} row={row} />
      ))}
    </div>
  );
}
