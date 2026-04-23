# Phase C Step 7 — Environment setup

New environment variables introduced by the Step 7 cron overhaul.
Read once per provisioning — do not block other work on this.

## Alpha Vantage NEWS_SENTIMENT (Phase 2 news source)

Phase 2 uses Alpha Vantage's `NEWS_SENTIMENT` endpoint for per-ticker
news sentiment — NOT Finnhub's `/news-sentiment` (which is paid-only;
the production smoke test against the free tier returned
`{"error":"You don't have access to this resource."}`). Re-uses the
existing `ALPHA_VANTAGE_API_KEY` already provisioned at Phase 1, so no
new env variable work is required for this pipeline.

Daily AV budget usage:

```
  19 calls  technical (daily bars)
   2 calls  news sentiment (7 tickers in 2 groups of 4 + 3)
   ─────
  21 calls  total (under 25/day free-tier cap, 4 headroom)
```

The (4, 3) ticker grouping was discovered empirically during live
probing: 7-ticker `NEWS_SENTIMENT` calls silently return `items=0`
(apparent hidden per-call ticker cap), while (4, 3) returns full
coverage. If you change the ticker list in
`src/app/api/cron/ingest-news/route.ts`, re-probe AV to confirm the
grouping still works.

Finnhub adapter files (`src/lib/score-engine/sources/finnhub*`) stay
in place as a future fallback if we ever move to a paid Finnhub plan.
The source-name registered in `news_sentiment.source_name` reads
`alpha_vantage` under the current pipeline.

### Graceful degradation before key is set

If `ALPHA_VANTAGE_API_KEY` is unset when `/api/cron/ingest-news` runs,
the endpoint:

- Returns HTTP 200 (not 500) so the hourly workflow's other steps
  (onchain + cnn-fg) do not get aborted by the `set -e` default in GHA
  step runners.
- Writes a single `ingest_runs` audit row with
  `error_summary="ALPHA_VANTAGE_API_KEY unset — news sentiment skipped this run"`.
- Writes NO rows to `news_sentiment` (distinct from the "empty sentiment
  run" vs "partial sentiment run" cases — search `ingest_runs` by that
  exact string to find skipped runs).

Under normal operation the key IS set (Phase 1 provisioning), so this
branch exists only as a defensive guard against an accidental Vercel-env
regression.

## PRODUCTION_URL (new GHA secret)

The three new GHA workflows introduced at Step 7
(`cron-technical.yml`, `cron-hourly.yml`, `cron-prices.yml`) use
`${{ secrets.PRODUCTION_URL }}` as the base URL for curl-ing the cron
endpoints. Set it to the current production alias:

```text
PRODUCTION_URL=https://finance-manager-james.vercel.app
```

(per handoff §8 "Vercel" — production alias maintained post-Phase-1
Step 12 deploy). If the alias changes, update this GHA secret.

### Add to GitHub Actions secrets

```bash
gh secret set PRODUCTION_URL --body "https://finance-manager-james.vercel.app"
```

or via the GitHub web UI: Settings → Secrets and variables → Actions
→ New repository secret.
