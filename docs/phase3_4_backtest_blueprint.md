# Phase 3.4 — Backtest UI Blueprint

**Authored:** 2026-04-26
**Scope:** PRD §18 Phase 3 module #4. The "replay current scoring math against past raw indicator data, compare versions" UI. Independent from Phase 3.1 (regime), 3.2 (portfolio), 3.3 (personalization).
**Recommended position in Phase 3 sequence:** FIRST product module after Phase 3.0 — backtest validates the engine on existing data, gives the user confidence in scoring math BEFORE we add a regime layer or portfolio overlay on top.
**Estimated effort:** 2-3 sessions (1 schema/data, 1 engine refactor + replay route, 1 UI).
**Dependencies:** Phase 3.0 (data recovery — completed 2026-04-26). Existing `raw_payload` JSONB columns on `indicator_readings` + `technical_readings` + `onchain_readings` + `news_sentiment` (preserved from Phase 1 schema).

---

## §0 — Tenets

1. **Replay never mutates history.** A backtest run reads historical raw inputs and writes a SEPARATE `backtest_runs` row keyed by `(model_version, snapshot_date_range, run_id)`. The original `composite_snapshots` row from that date stays exactly as it was — the user's point of comparison is "what the engine SAID then" vs "what TODAY's engine WOULD HAVE said".
2. **Pure replay engine.** The scoring math (composite-v2.ts + category-aggregators.ts + signals.ts + technical.ts + onchain.ts + normalize.ts) is already pure. No DB, no Next runtime. Phase 3.4 wraps these in a single `runBacktest()` orchestrator that takes raw inputs + a target MODEL_VERSION + WEIGHTS_VERSION and emits scored snapshots. No new core math.
3. **Versioned weights.** Today the engine reads weights from `src/lib/score-engine/weights.ts` at module-load time. Phase 3.4 extracts weights into a versioned object (`WEIGHTS_v2_0_0`, `WEIGHTS_v2_1_0`, ...) so a backtest can run "today's data through v2.0.0 weights" or "yesterday's data through v2.1.0 weights" symmetrically. No DB schema for weights — they remain code constants, but with a registry.
4. **No new ingestion.** Phase 3.4 does not fetch any new external data. It reads what's already in `technical_readings` / `onchain_readings` / `indicator_readings` / `news_sentiment` from prior cron runs.
5. **Memoize, don't redo.** Backtest output is deterministic given (raw inputs, MODEL_VERSION, WEIGHTS_VERSION). A `backtest_runs` table memoizes replay results per `(date, asset_type, model_version, weights_version)` so re-opening the page doesn't recompute. Re-runs are explicit (a "Re-run" button) — not silent.
6. **Loud failure.** Missing raw inputs for a date range yield `null` scored snapshots with a structured `gaps` array — never a fabricated value. UI shows the gap as a grey row.

---

## §1 — Problem statement

PRD §18 Phase 3.4: "현재 산식을 과거 `raw_payload`에 재실행해 버전 간 비교 (§11.6 Phase 3 범위). 단순 '그 시점 결과 조회'는 Phase 1에서 이미 제공되므로 이 UI는 replay·튜닝에 집중한다."

What we have today:
- `composite_snapshots` rows for every (asset_type, snapshot_date, model_version) since Phase 1 launch. Each row carries the score that the engine produced at THAT point in time, with the model_version active at that point.
- `technical_readings` / `onchain_readings` / `indicator_readings` / `news_sentiment` rows preserve the raw inputs that fed those scores.

What we want:
- Take the raw inputs from a past date range, run TODAY's engine on them, produce a parallel set of "as-if today" scores.
- Plot the original score line vs the replay score line on the same chart.
- Show a per-date deviation table ("on 2026-02-14, then-score 47, now-score 53, delta +6").
- Allow comparing two model versions side-by-side ("v2.0.0 vs v2.1.0 on the same data").
- (Stretch) Allow editing weights in-browser to see live replay deltas.

---

## §2 — Architecture

### §2.1 New module: `src/lib/score-engine/backtest.ts`

Pure orchestrator. Consumes raw input rows, returns a `BacktestResult`:

```ts
export interface BacktestRequest {
  modelVersion: string;            // e.g. "v2.0.0" or "v2.1.0"
  weightsVersion: string;          // matches a key in WEIGHTS_REGISTRY
  assetType: AssetType;            // single asset per run for clarity
  dateRange: { from: string; to: string }; // ISO YYYY-MM-DD
}

export interface BacktestSnapshot {
  date: string;
  // Reconstructed inputs used by the replay (proves the math is reproducible).
  rawInputs: {
    macro: Partial<Record<MacroIndicatorKey, number | null>>;
    technical: Partial<Record<string, number | null>>;
    onchain: Partial<Record<OnchainIndicatorKey, number | null>>;
    sentiment: number | null;
  };
  // Replay output.
  replayScore: number | null;
  replayBand: ScoreBand | null;
  replayContributing: CompositeContribution;
  replaySignals: SignalComputation | null;
  // For comparison.
  originalScore: number | null;       // from composite_snapshots if available
  originalModelVersion: string | null;
  // Loud failure surface.
  gaps: ReadonlyArray<string>;        // e.g. ["MA_200 missing for SPY", "MVRV_Z stale"]
}

export interface BacktestResult {
  request: BacktestRequest;
  snapshots: BacktestSnapshot[];
  summary: {
    totalDays: number;
    daysWithReplay: number;
    daysMissingInputs: number;
    avgAbsDelta: number;            // |replayScore - originalScore| averaged
    maxAbsDelta: number;
    daysAboveThreshold: number;     // delta > 5pp count (model_version cutover trigger)
  };
}
```

The orchestrator's pseudo-flow:
```
1. Build the date list (skip weekends for equity asset types).
2. For each date, load raw inputs from each readings table.
3. If sufficient inputs exist, score with current engine + chosen weights version.
4. Look up `composite_snapshots` for the same (asset_type, date) — that's `originalScore`.
5. Emit a `BacktestSnapshot`. Accumulate gaps loudly.
6. Compute summary stats; return.
```

### §2.2 Weights registry: `src/lib/score-engine/weights-registry.ts`

```ts
export const WEIGHTS_REGISTRY: Record<string, EngineWeights> = {
  "v2.0.0-baseline": WEIGHTS_v2_0_0,    // current production
  // Future versions added here as we tune.
};

export type EngineWeights = {
  category_weights: Record<AssetType, CategoryWeightSet>;
  indicator_score_thresholds: ScoreThresholds;
  signal_thresholds: SignalThresholds;
};
```

Today's weights live as scattered constants in `src/lib/score-engine/weights.ts`. Step 2 of Phase 3.4 consolidates them into the registry without changing any value (drift = 0).

### §2.3 New route: `POST /api/backtest/run`

```
Request body:  BacktestRequest
Response body: BacktestResult
Auth:          regular family-account auth (NOT cron secret — this is user-triggered)
Cache:         no-store; backtests are explicit
Rate limit:    1 concurrent request per user (db row lock)
```

The route:
1. Validates the date range (≤ 365 days max).
2. Calls `runBacktest()`.
3. Memoizes result into `backtest_runs` keyed by `(asset_type, from, to, model_version, weights_version, run_id)`.
4. Returns the result.

### §2.4 New schema: `backtest_runs` table

```sql
CREATE TABLE public.backtest_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  request_hash    TEXT NOT NULL,        -- sha256(canonical(request)) for memoization
  request_json    JSONB NOT NULL,
  result_json     JSONB NOT NULL,       -- full BacktestResult
  duration_ms     INT  NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX backtest_runs_hash_idx ON public.backtest_runs (request_hash, user_id);

-- RLS: family members only see their own backtest runs. Read everyone's
-- runs (within family) is also fine since the data isn't sensitive — but
-- write+update only your own. Mirror the Phase 1 RLS pattern.
ALTER TABLE public.backtest_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "family read all backtests" ON public.backtest_runs FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "family write own backtests" ON public.backtest_runs FOR INSERT WITH CHECK (user_id = auth.uid());
```

### §2.5 New route surface: `/backtest` page

Sidebar nav adds a `백테스트 / Backtest` group.

Page layout:
```
+-----------------------------------------------------------+
| Header                                                    |
+-----------------------------------------------------------+
| Backtest controls                                         |
|   - Asset type selector (radio: us / kr / global / btc)   |
|   - Date range picker (from / to, defaults: last 90d)     |
|   - Model version selector (defaults: current)            |
|   - Weights version selector (defaults: current)          |
|   - [Run backtest] button                                 |
+-----------------------------------------------------------+
| Result chart                                              |
|   Recharts dual-line:                                     |
|     - Then-score (faded)                                  |
|     - Now-score (vivid)                                   |
|   x-axis = date, y-axis = 0-100                           |
|   tooltip = both scores + delta                           |
+-----------------------------------------------------------+
| Summary cards                                             |
|   - 평균 절대 차이 (avg |Δ|)                              |
|   - 최대 차이 (max |Δ|)                                   |
|   - 5pp 초과 일수 (model_version cutover trigger count)   |
|   - 입력 데이터 결손 일수                                 |
+-----------------------------------------------------------+
| Per-day deviation table (paginated, 30 rows/page)         |
|   columns: date | 그때 점수 | 지금 점수 | 차이 | gaps     |
+-----------------------------------------------------------+
| (Stretch) Tuning panel                                    |
|   - Editable weight sliders                               |
|   - "Apply & Re-run" → new backtest_run row                |
+-----------------------------------------------------------+
```

UI tenets:
- 색상 외 redundancy 유지 (then=점선, now=실선; 차이 +/-는 색 + arrow icon).
- 결손 일수는 회색 row + ⚠ 아이콘.
- 5pp 임계값은 `MODEL_VERSION` cutover 트리거이므로 "지금 v2.0.0 → v2.1.0 검토 권장" 안내 카피가 임계값 초과 시 노출.

---

## §3 — Schema changes

### §3.1 `backtest_runs` migration (NEW)

`supabase/migrations/0011_backtest_runs.sql` (single migration):
- Table per §2.4.
- RLS policies per §2.4.
- Index on `(request_hash, user_id)` for memoization lookup.
- Index on `(user_id, created_at DESC)` for "my recent backtests" reader.

### §3.2 No changes to existing tables

Phase 3.4 does NOT modify `composite_snapshots`, `technical_readings`, `onchain_readings`, `indicator_readings`, `news_sentiment`, `signal_events`. The replay reads them but never writes.

### §3.3 Optional: `signal_replays` (DEFERRED to Phase 3.4.1)

If the user wants to backtest the SIGNAL ALIGNMENT engine separately from the composite engine, we can add a `signal_replays` table later. For Phase 3.4 base, signals are computed inline and embedded in the `BacktestSnapshot.replaySignals` field; not persisted as a separate row.

---

## §4 — Build sequence

### Step 1 — Weights registry refactor
- Extract weights from `src/lib/score-engine/weights.ts` into a versioned `WEIGHTS_REGISTRY` keyed by version string.
- Add a `getCurrentWeightsVersion()` helper.
- Verify drift = 0 by comparing serialized constants before/after.
- Tests: 1 test asserting `WEIGHTS_REGISTRY["v2.0.0-baseline"]` matches the prior monolithic constants exactly.

### Step 2 — Backtest engine module
- Create `src/lib/score-engine/backtest.ts`:
  - `runBacktest(request: BacktestRequest, rawInputsByDate): BacktestResult`
  - Pure function. Accepts pre-loaded raw inputs (so it can be unit-tested without DB).
- Create `src/lib/data/backtest-inputs.ts`:
  - `loadRawInputsForDateRange(from, to, assetType)` — DB reader. Returns the structure expected by `runBacktest`.
- Tests: synthetic 7-day fixture, verify replay scores match a known reference.

### Step 3 — Schema migration + RLS
- `supabase/migrations/0011_backtest_runs.sql` (per §3.1).
- Apply via `supabase db push` (local) → manually via supabase MCP migration tool (prod).
- Generate types: `supabase gen types typescript --project-id hhohrclmfsvpkigbdpsb > src/types/database.ts`.
- Tests: verify the migration applied + RLS denies anon reads.

### Step 4 — API route
- `src/app/api/backtest/run/route.ts` POST handler.
- Auth via existing `proxy.ts` family gate (NOT cron secret).
- Memoization via `backtest_runs` upsert on `request_hash`.
- Tests: 1 e2e-style test hitting the route with a fixture request, assert a `BacktestResult` shape returns.

### Step 5 — UI scaffolding
- `src/app/(protected)/backtest/page.tsx` (static shell, Suspense boundary).
- `src/app/(protected)/backtest/backtest-content.tsx` (Server Component for initial load).
- `src/components/backtest/BacktestControls.tsx` (Client Component — form).
- `src/components/backtest/BacktestChart.tsx` (Client Component — Recharts dual-line).
- `src/components/backtest/BacktestSummary.tsx` (Server-renderable summary cards).
- `src/components/backtest/BacktestDeviationTable.tsx` (table + pagination).

### Step 6 — Sidebar nav addition
- `src/components/layout/nav-items.ts`: add `백테스트 / Backtest` group with `/backtest` link under "참고" or new "분석" section.

### Step 7 — Documentation + acceptance
- Update PRD §18 Phase 3.4 from 예정 → 출하.
- Update `docs/phase2_acceptance_matrix.md` with Phase 3.4 completion noted.
- Update `docs/handoff.md`.
- New file `docs/phase3_4_acceptance_matrix.md` with verifiable SQL queries.

### Step 8 (Stretch) — Tuning panel
- Editable weight sliders that POST a request body with custom weights, rerun and write a new `backtest_runs` row keyed by a new version string `v2.0.0-custom-{hash}`.
- Persistent custom-weights store DEFERRED to Phase 3.4.1 (out of base scope).

---

## §5 — Acceptance criteria

Each verifiable by SQL or UI check post-implementation:

1. **Weights registry drift = 0**: `WEIGHTS_REGISTRY["v2.0.0-baseline"]` deep-equals the pre-refactor `CATEGORY_WEIGHTS` + `INDICATOR_CONFIG` + `SIGNAL_THRESHOLDS` constants exactly. Snapshot test.

2. **`runBacktest` reproduces a known snapshot**: replaying `2026-04-25` raw inputs through `runBacktest({modelVersion:"v2.0.0", weightsVersion:"v2.0.0-baseline", assetType:"us_equity", dateRange:{from:"2026-04-25",to:"2026-04-25"}})` yields a score within 0.01pp of `composite_snapshots.score_0_100` for the same row.

3. **Date range cap**: requests with `to - from > 365 days` return HTTP 400 with `error: "Date range exceeds 365 days"`.

4. **Memoization**: posting the same request twice returns the same `result_json` and only inserts ONE row in `backtest_runs` (or 1 INSERT + 1 cached read).

5. **Gaps surface**: if a date in the range has no `technical_readings` rows for the asset, that day's snapshot has `replayScore: null` and `gaps: ["technical_readings missing for ..."]`. UI shows a grey row.

6. **`/backtest` page renders**: visiting `/backtest` (authenticated) returns 200; an unauthenticated request 307s to `/login` per the existing proxy.

7. **End-to-end UX**: select us_equity + 90 days + run → chart renders 60+ data points (excluding weekends), summary cards show non-zero `avgAbsDelta`, deviation table sortable.

8. **RLS**: anon Supabase client cannot SELECT from `backtest_runs`; authenticated user can read all family rows but only INSERT their own.

9. **Lighthouse PWA score on `/backtest`** ≥ 85 (slightly relaxed vs dashboard 90+ since `/backtest` has heavy interactive controls).

10. **Trigger 2 5-agent review** runs clean (per CLAUDE.md mandate before push to main).

---

## §6 — Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Replay engine drift from production engine | Medium | Step 2 test asserts replayScore matches `composite_snapshots.score_0_100` for known dates. CI gates new commits against this snapshot. |
| Backtest run takes too long for 365-day range | Medium | Server-side cap at 365 days. Plus client-side date-picker enforces the cap. Memoization avoids re-runs. Worst case: 365 days × 4 asset types × ~5ms math = 7s. |
| Weights registry drifts during future tuning | Low | Each weights version is immutable (registry is `as const`). New tuning = new version string; old versions stay reproducible. |
| `raw_payload` JSONB shape changes break replay for old dates | Medium | Replay engine reads tolerant of missing fields. Old MA_200 nulls (pre-Phase-3.0) replay as gaps. Documented behavior. |
| `backtest_runs` table grows unbounded | Low | Family of 3 → ~30 backtests/month max. Add a 90-day TTL via Supabase scheduled job in Phase 3.4.1 if needed. |
| Tuning panel scope-creep | High | Stretch goal in Step 8. Must be cut if base 7 steps run long. The base value is already validated by replay alone. |
| Engine math is shared between cron + replay → a bug in replay leaks to production | Low | The orchestrator (`backtest.ts`) is NEW; it CALLS the existing `composite-v2.ts` etc. We don't modify the cron-side engine code. Risk localized to the replay orchestrator. |

---

## §7 — Out of scope for 3.4 (deferred)

- **Tuning persistence** — saving custom weights as a named version. Phase 3.4.1.
- **Backtest sharing across family members** — Phase 3.4.1 (RLS allows family-wide reads but no UI for it yet).
- **Signal-only backtest** — `signal_replays` separate table. Phase 3.4.1.
- **Multi-asset overlay** — running backtest for ALL asset types in one chart. Phase 3.4.1.
- **DART / ECOS replay** — those adapters aren't built yet (Phase 3.1 / 3.2). Backtest replays only what's in the existing tables.
- **`/changelog` integration** — the changelog continues to show actual historical scores; backtest is a distinct "what-if" surface.

---

## §8 — Approval gate

Before any Phase 3.4 step is implemented, user must approve:

- [ ] §2.4 schema choice (`backtest_runs` JSONB-blob result vs normalized columns) — JSONB chosen for flexibility; trade-off is harder ad-hoc SQL queries on results.
- [ ] §3.1 single-table memoization (vs per-day rows) — single-table chosen for simpler API.
- [ ] §5 acceptance criterion 2 (replay vs original score within 0.01pp) — strict tolerance; bumps to 0.1pp if floating-point drift surfaces.
- [ ] §7 deferred items — confirm tuning panel + multi-asset overlay are 3.4.1.
- [ ] Step 8 stretch — confirm whether to attempt the tuning panel in this phase or defer.

---

## §9 — Concrete next action (post-approval)

1. **Step 1 (weights registry)**: refactor `weights.ts` into `WEIGHTS_REGISTRY` keyed by version string. Snapshot test asserts drift = 0. Single commit.
2. **Step 2 (backtest engine)**: pure orchestrator + DB loader + 7-day fixture test. Single commit.
3. **Step 3 (migration)**: `0011_backtest_runs.sql` + RLS + types regen. Single commit.
4. Continue Steps 4-7 in subsequent commits.
5. Trigger 2 5-agent review on the full 3.4 diff before push.
6. Production deploy + Chrome MCP visual verify of `/backtest` page.

Estimated total: 6 commits + 1 review fix commit. 2-3 sessions.

---

*This file is the canonical Phase 3.4 design doc. Implementation commits reference back to specific §§.*
