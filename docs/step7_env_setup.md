# Phase C Step 7 — Environment setup

New environment variables introduced by the Step 7 cron overhaul.
Read once per provisioning — do not block other work on this.

## FINNHUB_API_KEY (new)

The Step 7 ingest-news cron endpoint (`/api/cron/ingest-news`) requires
a Finnhub API token. Free tier: 60 calls/minute, 60 calls/month for
news sentiment.

### 1. Obtain the key

Register at <https://finnhub.io/register> (free) → Dashboard → API Key.

### 2. Add to local env

```bash
echo 'FINNHUB_API_KEY=<your-key>' >> .env.local
```

### 3. Add to Vercel Production

```bash
vercel env add FINNHUB_API_KEY production
# paste key when prompted
vercel env pull .env.vercel
```

### 4. GitHub repo Actions secrets — NOT needed

Only `CRON_SECRET` needs to be in GitHub Actions secrets — the Finnhub
key is read by the Vercel function itself, not the Actions runner. No
GHA secret update is needed for this key.

### 5. Graceful degradation before key is set

If `FINNHUB_API_KEY` is unset when `/api/cron/ingest-news` runs, the
endpoint:

- Returns HTTP 200 (not 500) so the hourly workflow's other steps
  (onchain + cnn-fg) do not get aborted by the `set -e` default in GHA
  step runners.
- Writes a single `ingest_runs` audit row with
  `error_summary="FINNHUB_API_KEY unset — news sentiment skipped this run"`.
- Writes NO rows to `news_sentiment` (distinct from the "empty sentiment
  run" vs "partial sentiment run" cases — search ingest_runs by that
  exact string to find skipped runs).

This graceful-skip pattern is deliberate: blocking the hourly workflow
on a missing key would make provisioning the key cost a full hour of
onchain / CNN F&G staleness.

Once the key is provisioned to Vercel production (step 3 above), the
NEXT hourly run will auto-start writing `news_sentiment` rows — no
deploy, no restart.

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
