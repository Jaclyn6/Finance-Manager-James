/**
 * Numeric-aware version-string comparison.
 *
 * The pipeline tiebreaks same-date rows by "newest version wins"
 * (model_version on reading tables, engine_version on
 * advisor_verdicts). Byte-wise string comparison silently breaks the
 * moment any version component reaches two digits — "v2.10.0" sorts
 * BEFORE "v2.9.0", so an ascending-sort/last-wins collapse would keep
 * the OLDER row on exactly the cutover days the tiebreak exists for
 * (Trigger 2 review 2026-07-08; same defect class as 34df3e6 and
 * 90ff598).
 *
 * Comparison rule: split both strings into digit / non-digit chunks;
 * compare digit chunks numerically, non-digit chunks lexicographically,
 * left to right. "adv-1.1.9" < "adv-1.1.10", "v2.9.0" < "v2.10.0".
 */
/**
 * Picks the authoritative "latest" row from a small per-key result
 * set: newest `observed_at` wins; among rows sharing that date (a
 * model/engine-version cutover day) the numerically-newest version
 * wins. Pure — extracted so the reading-table readers' selection rule
 * is unit-testable without Supabase.
 */
export function pickLatestByDateThenVersion<
  T extends { observed_at: string; model_version: string },
>(rows: ReadonlyArray<T>): T | null {
  let best: T | null = null;
  for (const row of rows) {
    if (best === null) {
      best = row;
      continue;
    }
    const dateA = String(row.observed_at).slice(0, 10);
    const dateB = String(best.observed_at).slice(0, 10);
    if (dateA > dateB) {
      best = row;
    } else if (
      dateA === dateB &&
      compareVersionsNumeric(row.model_version, best.model_version) > 0
    ) {
      best = row;
    }
  }
  return best;
}

export function compareVersionsNumeric(a: string, b: string): number {
  const chunksA = a.split(/(\d+)/).filter((c) => c.length > 0);
  const chunksB = b.split(/(\d+)/).filter((c) => c.length > 0);
  const len = Math.max(chunksA.length, chunksB.length);

  for (let i = 0; i < len; i++) {
    const ca = chunksA[i];
    const cb = chunksB[i];
    if (ca === undefined) return -1; // shorter = older ("v2" < "v2.1")
    if (cb === undefined) return 1;
    if (ca === cb) continue;

    const na = /^\d+$/.test(ca) ? Number(ca) : null;
    const nb = /^\d+$/.test(cb) ? Number(cb) : null;
    if (na !== null && nb !== null) return na - nb;
    // Mixed or both non-numeric: plain lexicographic.
    return ca < cb ? -1 : 1;
  }
  return 0;
}
