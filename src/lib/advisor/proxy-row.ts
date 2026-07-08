import type { Json, TablesInsert } from "@/types/database";

import type { StockFgProxyResult } from "./stock-fg-proxy";
import { STOCK_FG_PROXY_KEY } from "./stock-fg-proxy";
import { ADVISOR_ENGINE_VERSION } from "./verdict";

/**
 * Serializes a computed STOCK_FG_PROXY into an `onchain_readings`
 * insert row (the table CNN_FG itself lives in), so the proxy
 * accrues its own daily history — future percentile context and
 * hit-rate work need to know what the proxy SAID, not just what it
 * would say recomputed against revised inputs.
 *
 * RAW-ONLY row: `score_0_100`/`value_normalized` stay null — the
 * proxy is NOT a composite input (§4.5 tenet 1: no synthesized
 * scores outside the composite path; wiring it into the sentiment
 * category is an explicitly deferred product decision, see backlog).
 * `model_version` carries ADVISOR_ENGINE_VERSION for honest
 * provenance: this number came from the advisor's rule-set, not the
 * composite engine's.
 *
 * A null proxy value (all four components uncomputable) writes a
 * `partial` row with the component detail in raw_payload — a dark
 * day should be visible in the history, not a silent gap.
 */
export function proxyToOnchainRow(
  proxy: StockFgProxyResult,
  observedAt: string,
): TablesInsert<"onchain_readings"> {
  return {
    indicator_key: STOCK_FG_PROXY_KEY,
    asset_type: "common",
    observed_at: observedAt,
    model_version: ADVISOR_ENGINE_VERSION,
    source_name: "in_house_proxy",
    fetch_status: proxy.value === null ? "partial" : "success",
    value_raw: proxy.value,
    value_normalized: null,
    score_0_100: null,
    raw_payload: {
      components: proxy.components,
      missing: proxy.missing,
    } as unknown as Json,
  };
}
