import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * "시장 날씨" strip — the six raw gauges the advisor pillars read,
 * shown as compact chips so the family can sanity-check the verdict
 * cards against the underlying numbers in one glance.
 *
 * Tone semantics are CONTRARIAN where the pillar logic is (F&G:
 * extreme fear = emerald opportunity), and conventional where it
 * isn't (Sahm trigger / curve inversion / HY stress = red). The
 * thresholds mirror `src/lib/advisor/pillars.ts` — if a pillar
 * threshold moves, move it here too so the chip color never
 * contradicts the evidence sentence next to it.
 *
 * VIX and HY-spread chips additionally show the 7-day direction
 * (▲/▼) when `deltas` provides one — the same `computeWowDelta`
 * number the pillars judge, so arrow and evidence can't diverge. An
 * HY spread ≥4 that has turned down (≤ −0.1%p) upgrades the note to
 * the 꺾임 buy-window callout instead of plain "주의/스트레스".
 *
 * Missing readings render a muted "—" chip (loud-failure tenet: an
 * absent gauge should look absent, not silently disappear).
 */
export interface MarketWeatherStripProps {
  /** `getLatestIndicatorReadings()` output. */
  readings: Record<string, number | null>;
  /** `getWeatherDeltas()` output — 7-day change per indicator_key. */
  deltas?: Record<string, number | null>;
  /**
   * `getWeatherPercentiles()` output — 5y percentile rank (0-1) of
   * the current value per indicator_key. Null/absent = no context
   * line (series not deep enough yet).
   */
  percentiles?: Record<string, number | null>;
  /**
   * `getStockFgProxy().value` — shown on the 공포·탐욕(미국) chip
   * ONLY when CNN_FG itself has no fresh reading, with an explicit
   * "자체 프록시" tag (never passed off as CNN).
   */
  stockFgProxy?: number | null;
}

type Tone = "emerald" | "amber" | "red" | "muted";

interface GaugeSpec {
  key: string;
  label: string;
  format: (v: number) => string;
  tone: (v: number, delta: number | null) => Tone;
  note: (v: number, delta: number | null) => string;
  /** Renders the ▲/▼ 7-day chip when a delta exists. */
  formatDelta?: (d: number) => string;
  /** Semantic direction: is a RISING value good or bad for buyers? */
  risingIsBad?: boolean;
  /** Show the "5년 상위 X%" context line when a percentile exists. */
  showPercentile?: boolean;
}

/** Mirrors HY_DANGER_FLOOR / HY_TURN_EPS in `src/lib/advisor/pillars.ts`. */
const HY_DANGER_FLOOR = 4;
const HY_TURN_EPS = 0.1;

const GAUGES: GaugeSpec[] = [
  {
    key: "VIXCLS",
    label: "VIX",
    format: (v) => v.toFixed(1),
    tone: (v) => (v >= 30 ? "red" : v >= 18 ? "amber" : "emerald"),
    note: (v, d) => {
      if (v >= 30 && d !== null && d <= -2) return "패닉 정점 통과 신호";
      return v >= 30 ? "패닉" : v >= 18 ? "긴장" : "안정";
    },
    formatDelta: (d) => `${d >= 0 ? "+" : ""}${d.toFixed(1)}`,
    risingIsBad: true,
    showPercentile: true,
  },
  {
    // F&G delta semantics are contrarian like the level: RISING F&G =
    // drifting toward greed = a worsening entry for the discount
    // hunter (red ▲); falling toward fear = opportunity building.
    key: "CNN_FG",
    label: "공포·탐욕(미국)",
    format: (v) => v.toFixed(0),
    tone: (v) => (v <= 25 ? "emerald" : v >= 75 ? "red" : "muted"),
    note: (v) => (v <= 25 ? "극단적 공포" : v >= 75 ? "과열" : "중립"),
    formatDelta: (d) => `${d >= 0 ? "+" : ""}${d.toFixed(0)}`,
    risingIsBad: true,
  },
  {
    key: "CRYPTO_FG",
    label: "공포·탐욕(크립토)",
    format: (v) => v.toFixed(0),
    tone: (v) => (v <= 25 ? "emerald" : v >= 75 ? "red" : "muted"),
    note: (v) => (v <= 25 ? "극단적 공포" : v >= 75 ? "과열" : "중립"),
    formatDelta: (d) => `${d >= 0 ? "+" : ""}${d.toFixed(0)}`,
    risingIsBad: true,
  },
  {
    key: "SAHMCURRENT",
    label: "삼 룰",
    format: (v) => v.toFixed(2),
    tone: (v) => (v >= 0.5 ? "red" : "emerald"),
    note: (v) => (v >= 0.5 ? "침체 트리거" : "침체 신호 없음"),
  },
  {
    key: "T10Y2Y",
    label: "장단기금리차",
    format: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%p`,
    tone: (v) => (v < 0 ? "red" : "emerald"),
    note: (v) => (v < 0 ? "역전" : "정상"),
  },
  {
    key: "BAMLH0A0HYM2",
    label: "HY 스프레드",
    format: (v) => `${v.toFixed(1)}%p`,
    tone: (v, d) => {
      if (v >= HY_DANGER_FLOOR && d !== null && d <= -HY_TURN_EPS)
        return "emerald";
      return v >= 5 ? "red" : v >= HY_DANGER_FLOOR ? "red" : v >= 3 ? "amber" : "emerald";
    },
    note: (v, d) => {
      if (v >= HY_DANGER_FLOOR && d !== null && d <= -HY_TURN_EPS)
        return "고점 꺾임 — 매수 신호 구간";
      if (v >= HY_DANGER_FLOOR)
        return d !== null && d >= HY_TURN_EPS ? "스트레스 확대 중" : "신용 스트레스";
      return v >= 3 ? "주의" : "안정";
    },
    formatDelta: (d) => `${d >= 0 ? "+" : ""}${d.toFixed(2)}%p`,
    risingIsBad: true,
    showPercentile: true,
  },
];

/**
 * "5년 상위 X%" line. percentile is the SHARE OF HISTORY AT OR BELOW
 * the current value (0.88 → higher than 88% of the window → 상위
 * 12%). Only rendered for gauges where "elevated vs own history" is
 * the natural read (VIX, HY spread — both risingIsBad).
 */
function formatPercentileKo(percentile: number): string {
  const topPct = Math.max(0, Math.min(100, (1 - percentile) * 100));
  return `5년 상위 ${topPct.toFixed(0)}%`;
}

const TONE_DOT_CLASS: Record<Tone, string> = {
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  muted: "bg-muted-foreground/40",
};

export function MarketWeatherStrip({
  readings,
  deltas = {},
  percentiles = {},
  stockFgProxy = null,
}: MarketWeatherStripProps) {
  return (
    <Card size="sm" className="p-4 md:p-5">
      <CardContent className="space-y-3 p-0">
        <p className="text-xs font-medium text-muted-foreground">시장 날씨</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {GAUGES.map((gauge) => {
            // CNN outage fallback: the 미국 F&G chip shows the in-house
            // proxy when CNN has no fresh reading — tagged, never silent.
            const viaProxy =
              gauge.key === "CNN_FG" &&
              (readings[gauge.key] ?? null) === null &&
              stockFgProxy !== null;
            const value = viaProxy
              ? stockFgProxy
              : (readings[gauge.key] ?? null);
            // No delta arrow on the proxy path: deltas[CNN_FG] is
            // computed from CNN's own (stale, pre-outage) series and
            // has no relation to the proxy figure shown as the value —
            // pairing them would break the "arrow and evidence can't
            // diverge" invariant (Trigger 2 review, 2026-07-08).
            const delta = viaProxy ? null : (deltas[gauge.key] ?? null);
            const percentile = gauge.showPercentile
              ? (percentiles[gauge.key] ?? null)
              : null;
            return (
              <div key={gauge.key} className="min-w-0">
                <p className="truncate text-[11px] text-muted-foreground">
                  {gauge.label}
                </p>
                {value === null ? (
                  <p className="mt-0.5 text-sm font-semibold text-muted-foreground">
                    —
                  </p>
                ) : (
                  <>
                    <p className="mt-0.5 flex items-baseline gap-1.5 text-sm font-semibold text-foreground">
                      {gauge.format(value)}
                      {delta !== null && gauge.formatDelta && (
                        <span
                          className={cn(
                            "text-[10px] font-medium",
                            delta === 0
                              ? "text-muted-foreground"
                              : (delta > 0) === (gauge.risingIsBad ?? false)
                                ? "text-red-600 dark:text-red-400"
                                : "text-emerald-600 dark:text-emerald-400",
                          )}
                          title="최근 7일 변화"
                        >
                          {delta > 0 ? "▲" : delta < 0 ? "▼" : "—"}{" "}
                          {gauge.formatDelta(delta)}
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                      <span
                        aria-hidden
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          TONE_DOT_CLASS[gauge.tone(value, delta)],
                        )}
                      />
                      {gauge.note(value, delta)}
                      {viaProxy && (
                        <span className="rounded bg-muted px-1 text-[9px] font-medium text-muted-foreground">
                          자체 프록시
                        </span>
                      )}
                    </p>
                    {percentile !== null && (
                      <p className="mt-0.5 text-[10px] text-muted-foreground/70">
                        {formatPercentileKo(percentile)}
                      </p>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
