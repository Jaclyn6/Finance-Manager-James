# Phase 3.4 — Backtest UI Blueprint

**Authored:** 2026-04-26 · **§8 gate approved 2026-04-27** (user decisions resolved — see §8).
**Scope:** PRD §18 Phase 3 module #4. The "replay current scoring math against past raw indicator data, compare versions" UI. Independent from Phase 3.1 (regime), 3.2 (portfolio), 3.3 (personalization).
**Recommended position in Phase 3 sequence:** FIRST product module after Phase 3.0 — backtest validates the engine on existing data, gives the user confidence in scoring math BEFORE we add a regime layer or portfolio overlay on top.
**Estimated effort:** 3-4 sessions (1 schema/data, 1 engine refactor + replay route, 1 UI base, 1 tuning slider + family share + closeout). Increased from initial 2-3 estimate after user approved tuning slider in scope.
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

### §2.4 New schema: `backtest_runs` + `backtest_snapshots` (Hybrid 2-table per §8 decision #1)

User decision 2026-04-27 (§8 gate): use **normalized per-day rows for analytics access**, but keep a small `backtest_runs` table for memoization metadata. This hybrid is best of both: per-request memoization stays cheap, per-day analytics SQL stays clean.

Capacity check (Supabase Free 500 MB DB ceiling): 30 backtests/month × 60 trading days = 1,800 detail rows/month + 30 meta rows/month ≈ 2.1 MB/month → ~25 MB/year → 5% of free-tier ceiling. No squeeze.

```sql
-- Memoization metadata + summary stats (one row per backtest run).
CREATE TABLE public.backtest_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  request_hash    TEXT NOT NULL,        -- sha256(canonical(request)) for memoization
  request_json    JSONB NOT NULL,       -- the full BacktestRequest (asset_type, range, model_version, weights_version, optional custom_weights)
  -- Summary stats (small set, normalized so dashboards can SELECT directly).
  asset_type      asset_type_enum NOT NULL,
  date_from       DATE NOT NULL,
  date_to         DATE NOT NULL,
  model_version   TEXT NOT NULL,
  weights_version TEXT NOT NULL,
  total_days      INT  NOT NULL,
  days_with_replay INT NOT NULL,
  days_missing_inputs INT NOT NULL,
  avg_abs_delta   NUMERIC(6,3),
  max_abs_delta   NUMERIC(6,3),
  days_above_5pp  INT NOT NULL,
  duration_ms     INT  NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX backtest_runs_hash_user_idx ON public.backtest_runs (request_hash, user_id);
CREATE INDEX backtest_runs_user_recent_idx ON public.backtest_runs (user_id, created_at DESC);

-- Per-day replay results (one row per [run_id, date]).
CREATE TABLE public.backtest_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          UUID NOT NULL REFERENCES public.backtest_runs(id) ON DELETE CASCADE,
  snapshot_date   DATE NOT NULL,
  replay_score    NUMERIC(6,3),
  replay_band     TEXT,
  original_score  NUMERIC(6,3),
  original_model_version TEXT,
  delta           NUMERIC(6,3),         -- replay_score - original_score (when both present)
  raw_inputs      JSONB,                -- the macro/technical/onchain/sentiment dict used
  contributing    JSONB,                -- replay's per-category breakdown
  signal_state    JSONB,                -- replay signals (compact form)
  gaps            TEXT[]                -- structured gap reasons (e.g. {"MA_200 missing for SPY"})
);
CREATE UNIQUE INDEX backtest_snapshots_run_date_idx ON public.backtest_snapshots (run_id, snapshot_date);
CREATE INDEX backtest_snapshots_date_idx ON public.backtest_snapshots (snapshot_date);

-- RLS: §8 decision #4 brought "family share read" into scope.
-- All authenticated family members can READ all backtest_runs +
-- backtest_snapshots (the data isn't sensitive within the family).
-- Only the original creator can INSERT/DELETE their own runs.
ALTER TABLE public.backtest_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "family read all backtests" ON public.backtest_runs FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "family write own backtests" ON public.backtest_runs FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "family delete own backtests" ON public.backtest_runs FOR DELETE USING (user_id = auth.uid());

ALTER TABLE public.backtest_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "family read all snapshots" ON public.backtest_snapshots FOR SELECT USING (auth.role() = 'authenticated');
-- INSERTs into backtest_snapshots happen server-side via service-role
-- key (the API route uses the admin client to write the per-day rows
-- transactionally with the parent run). No user-side INSERT policy.
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

## §7 — In scope vs out of scope for 3.4

**In scope (per §8 gate decisions 2026-04-27):**
- Backtest core (replay engine, weights registry, schema, API route, /backtest page).
- **Tuning slider panel (Step 8)** — sliders for per-asset weights + per-signal thresholds; on "Apply & Re-run" the route is invoked with `customWeights` field. Custom-weights NOT persisted as named versions in 3.4 base — they POST inline and the resulting `backtest_runs.weights_version` is `"v2.0.0-baseline"` plus a derived `custom_hash` suffix (e.g. `"v2.0.0-baseline+c7a2"`).
- **Tuning persistence** (formerly OOS #1) — saving custom weights with a user-supplied name (e.g. "내 v3 가설"). Implemented as a small `user_weights` table referenced by `backtest_runs.weights_version`. Lets the user iterate over custom weights without re-typing every slider.
- **Backtest family sharing** (formerly OOS #2) — RLS opens read-all to authenticated family. UI adds a "다른 가족이 만든 백테스트" reader on `/backtest` so the user can browse jw.byun's, edc0422's, and odete4's runs.

**Deferred to Phase 3.4.1:**
- **Signal-only backtest** — `signal_replays` separate table. Out of base scope.
- **Multi-asset overlay** — single chart with all 4 asset_types. Out of base scope.
- **DART / ECOS replay** — adapters arrive in Phase 3.1 / 3.2; backtest replays only what's in existing tables.

**Out of scope permanently (different surface):**
- **`/changelog` integration** — changelog shows actual historical scores; backtest is distinct "what-if" surface.

---

## §8 — Approval gate (RESOLVED 2026-04-27)

User decisions:

- [x] **§2.4 schema** — **Hybrid 2-table** (orchestrator-revised): `backtest_runs` for metadata + summary (1 row per request, memoization key) + `backtest_snapshots` for per-day rows (analytics-friendly normalized columns). Combines user's "normalize for analytics" preference with engineering's "single-row memoization is simpler" preference. Capacity 5% of Supabase Free DB ceiling at expected 30 backtests/month family usage.
- [x] **§3.1 memoization** — **Per-request via `request_hash`**, single row per (request, user). Confirmed.
- [x] **§5 acceptance criterion 2** — **0.01pp strict** to start. If floating-point drift surfaces in CI, relax to 0.1pp with a documented commit. Confirmed.
- [x] **§7 deferred items** — **OOS #1 (tuning persistence) + OOS #2 (family sharing) NOW IN SCOPE for 3.4.** OOS #3 (signal-only backtest), #4 (multi-asset overlay), #5 (DART/ECOS replay) stay deferred to 3.4.1.
- [x] **Step 8 tuning slider** — **IN SCOPE for 3.4.** Implemented as live-controlled sliders + "Apply & Re-run" button.

---

## §9 — Build sequence (post-approval, IN PROGRESS 2026-04-27)

Updated for §8 in-scope additions (tuning slider, custom-weights persistence, family sharing read).

1. **Step 1 (weights registry)**: refactor `weights.ts` into `WEIGHTS_REGISTRY` keyed by version string. Snapshot test asserts drift = 0. Single commit.
2. **Step 2 (backtest engine)**: pure orchestrator + DB loader + 7-day fixture test. Single commit.
3. **Step 3 (migration)**: `0011_backtest_runs.sql` + `backtest_snapshots` + `user_weights` (for tuning persistence) + RLS + types regen. Single commit.
4. **Step 4 (API route)**: `POST /api/backtest/run` with hybrid 2-table write transaction + custom-weights inline support. Single commit.
5. **Step 5 (UI scaffolding)**: `/backtest` page with controls + chart + summary + deviation table. Single commit.
6. **Step 6 (sidebar nav)**: "분석 / 백테스트" group entry. Single commit.
7. **Step 7 (tuning slider panel)**: editable sliders + "Apply & Re-run" + "이름 붙여 저장" → `user_weights` row. Single commit.
8. **Step 8 (family sharing reader)**: side-panel listing other family members' recent backtests; click loads. Single commit.
9. **Step 9 (docs + acceptance)**: PRD §18 update, matrix entry, handoff snapshot. Single commit.
10. **Trigger 2 5-agent review** on the full 3.4 diff before push.
11. **Production deploy + Chrome MCP visual verify** of `/backtest` page.

Estimated total: 9 commits + 1 review fix commit. 3-4 sessions.

---

*This file is the canonical Phase 3.4 design doc. Implementation commits reference back to specific §§.*
