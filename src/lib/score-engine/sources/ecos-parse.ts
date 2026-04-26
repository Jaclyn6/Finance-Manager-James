/**
 * Pure ECOS (한국은행 OpenAPI) response parser + observation helpers.
 *
 * Split out of `ecos.ts` so Vitest and any backfill tooling can run the
 * parser without the `"server-only"` guard the wrapper carries.
 *
 * ECOS quirks (verified against the live API 2026-04-27):
 *
 * 1. **Many `STAT_CODE`s are stat-GROUPS, not single series.** A single
 *    `722Y001` query returns BOK base rate, 정부대출금금리, 자금조정 대출/예금
 *    금리 etc. flattened into one `row[]` and disambiguated by
 *    `ITEM_CODE1`. Callers must pass `itemCode` to pin the specific
 *    series they want, otherwise the parser returns every row.
 * 2. **`TIME` format depends on cycle.** Daily = `YYYYMMDD`, monthly =
 *    `YYYYMM`, quarterly = `YYYYQ#`, annual = `YYYY`. We normalize all
 *    of these to ISO `YYYY-MM-DD`. Monthly => first-of-month;
 *    quarterly => first-month-of-quarter, first day; annual => Jan 1.
 * 3. **No `"."` sentinel.** Unlike FRED, ECOS just omits rows for dates
 *    it doesn't have data for. Empty / missing `DATA_VALUE` is a parse
 *    error and the row is dropped.
 * 4. **Two error envelopes**: `INFO-100` = auth failure, `INFO-200` =
 *    "no data in this range". Both surface as `fetch_status: "error"`
 *    per blueprint §2.3 loud-failure tenet.
 */

export interface EcosObservation {
  /** Calendar date of the observation, ISO `YYYY-MM-DD`. */
  date: string;
  /** Parsed numeric value; null when the upstream value didn't parse as finite. */
  value: number | null;
}

export type EcosFetchStatus = "success" | "error" | "stale" | "partial";

export interface EcosFetchResult {
  series_code: string;
  /** ITEM_CODE1 the parser filtered by, or null when caller didn't filter. */
  item_code: string | null;
  /** All observations in the requested window, chronological ascending. */
  observations: EcosObservation[];
  /** The most recent observation whose value is non-null, or null. */
  latest: EcosObservation | null;
  /** Historical values excluding `latest`. Nulls are dropped. */
  window: number[];
  fetch_status: EcosFetchStatus;
  /** Populated when fetch_status !== "success". */
  error?: string;
  /** ISO timestamp of fetch completion (success or failure). */
  fetched_at: string;
}

interface EcosRawRow {
  STAT_CODE?: unknown;
  ITEM_CODE1?: unknown;
  TIME?: unknown;
  DATA_VALUE?: unknown;
}

/**
 * Pure parser. Safe to call with any `unknown` payload.
 *
 * @param seriesCode  ECOS stat code (echoed into the result).
 * @param body        the raw JSON parsed from the API.
 * @param itemCode    optional ITEM_CODE1 filter — required when the
 *                    upstream stat groups multiple series under one
 *                    `STAT_CODE`. When omitted the parser includes
 *                    every row.
 */
export function parseEcosResponse(
  seriesCode: string,
  body: unknown,
  itemCode?: string,
): EcosFetchResult {
  if (!body || typeof body !== "object") {
    return makeErrorResult(seriesCode, itemCode, "ECOS response was not an object");
  }

  const resultEnvelope = (body as { RESULT?: unknown }).RESULT;
  if (resultEnvelope && typeof resultEnvelope === "object") {
    const r = resultEnvelope as { CODE?: unknown; MESSAGE?: unknown };
    const code = typeof r.CODE === "string" ? r.CODE : "UNKNOWN";
    const message = typeof r.MESSAGE === "string" ? r.MESSAGE : "ECOS error";
    return makeErrorResult(seriesCode, itemCode, `ECOS ${code}: ${message}`);
  }

  const search = (body as { StatisticSearch?: unknown }).StatisticSearch;
  if (!search || typeof search !== "object") {
    return makeErrorResult(
      seriesCode,
      itemCode,
      "ECOS response missing StatisticSearch envelope",
    );
  }

  const rawRows = (search as { row?: unknown }).row;
  if (!Array.isArray(rawRows)) {
    return makeErrorResult(seriesCode, itemCode, "ECOS response missing row[]");
  }

  const observations: EcosObservation[] = [];
  for (const item of rawRows) {
    if (!item || typeof item !== "object") continue;
    const rec = item as EcosRawRow;
    if (typeof rec.TIME !== "string" || rec.TIME.length === 0) continue;
    if (typeof rec.DATA_VALUE !== "string" || rec.DATA_VALUE.length === 0) continue;

    if (itemCode != null) {
      if (typeof rec.ITEM_CODE1 !== "string" || rec.ITEM_CODE1 !== itemCode) {
        continue;
      }
    }

    const isoDate = ecosTimeToIsoDate(rec.TIME);
    if (isoDate == null) continue;

    const parsed = Number(rec.DATA_VALUE);
    if (!Number.isFinite(parsed)) continue;

    observations.push({ date: isoDate, value: parsed });
  }

  if (observations.length === 0) {
    return {
      series_code: seriesCode,
      item_code: itemCode ?? null,
      observations: [],
      latest: null,
      window: [],
      fetch_status: "partial",
      error: "no observations after parsing",
      fetched_at: new Date().toISOString(),
    };
  }

  // ECOS responses are not guaranteed chronological — sort ascending so
  // the latest-pick + window math below is reliable.
  observations.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  let latestIndex = -1;
  for (let i = observations.length - 1; i >= 0; i--) {
    if (observations[i].value !== null) {
      latestIndex = i;
      break;
    }
  }

  if (latestIndex === -1) {
    return {
      series_code: seriesCode,
      item_code: itemCode ?? null,
      observations,
      latest: null,
      window: [],
      fetch_status: "partial",
      error: "all observations are missing",
      fetched_at: new Date().toISOString(),
    };
  }

  const latest = observations[latestIndex];
  const window: number[] = [];
  for (let i = 0; i < latestIndex; i++) {
    const v = observations[i].value;
    if (v !== null) window.push(v);
  }

  return {
    series_code: seriesCode,
    item_code: itemCode ?? null,
    observations,
    latest,
    window,
    fetch_status: "success",
    fetched_at: new Date().toISOString(),
  };
}

export function makeErrorResult(
  seriesCode: string,
  itemCode: string | undefined,
  message: string,
): EcosFetchResult {
  return {
    series_code: seriesCode,
    item_code: itemCode ?? null,
    observations: [],
    latest: null,
    window: [],
    fetch_status: "error",
    error: message,
    fetched_at: new Date().toISOString(),
  };
}

/**
 * Convert an ECOS `TIME` field to ISO `YYYY-MM-DD`.
 * Returns null on unrecognized format so the caller drops the row.
 */
export function ecosTimeToIsoDate(time: string): string | null {
  // Daily: YYYYMMDD
  if (/^\d{8}$/.test(time)) {
    const y = time.slice(0, 4);
    const m = time.slice(4, 6);
    const d = time.slice(6, 8);
    if (!isValidYmd(y, m, d)) return null;
    return `${y}-${m}-${d}`;
  }
  // Monthly: YYYYMM => first-of-month
  if (/^\d{6}$/.test(time)) {
    const y = time.slice(0, 4);
    const m = time.slice(4, 6);
    if (!isValidYmd(y, m, "01")) return null;
    return `${y}-${m}-01`;
  }
  // Quarterly: YYYYQ# => first month of quarter, first day
  const quarterMatch = /^(\d{4})Q([1-4])$/.exec(time);
  if (quarterMatch) {
    const y = quarterMatch[1];
    const q = Number(quarterMatch[2]);
    const m = String((q - 1) * 3 + 1).padStart(2, "0");
    return `${y}-${m}-01`;
  }
  // Annual: YYYY => Jan 1
  if (/^\d{4}$/.test(time)) {
    return `${time}-01-01`;
  }
  return null;
}

function isValidYmd(y: string, m: string, d: string): boolean {
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (!Number.isInteger(year) || year < 1900 || year > 2999) return false;
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  if (!Number.isInteger(day) || day < 1 || day > 31) return false;
  // Reject impossible calendar dates (Feb 31, Jun 31, etc.) — `Date`
  // silently rolls them over (Feb 31 → Mar 3), so a string-bound check
  // alone would let an ECOS typo poison the batch upsert when Postgres
  // rejects `2026-02-31` as `invalid input syntax for type date`.
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/**
 * Most recent non-null observation with `date <= asOfDate`, or null.
 * Mirrors `findObservationAsOf` in fred-parse.ts.
 */
export function findEcosObservationAsOf(
  observations: EcosObservation[],
  asOfDate: string,
): EcosObservation | null {
  let latest: EcosObservation | null = null;
  for (const obs of observations) {
    if (obs.date > asOfDate) break;
    if (obs.value !== null) latest = obs;
  }
  return latest;
}
