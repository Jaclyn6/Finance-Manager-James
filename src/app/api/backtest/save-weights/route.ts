import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Phase 3.4 Step 7b — `POST /api/backtest/save-weights`.
 *
 * Persists a custom EngineWeights snapshot (a wrapper around per-asset
 * categoryWeights produced by the tuning slider panel) under a
 * user-supplied name. UPSERT on (user_id, name) so saving the same
 * name overwrites.
 *
 * Returns the saved row id so the panel can switch the
 * `customWeightsId` selector to it.
 *
 * Auth: per-request server client cookie. RLS enforces owner-only
 * INSERT/UPDATE.
 */

interface PostBody {
  name?: string;
  payload?: unknown;
  description_ko?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 60) {
    return NextResponse.json(
      { error: "name is required and must be ≤ 60 chars" },
      { status: 400 },
    );
  }
  if (
    !body.payload ||
    typeof body.payload !== "object" ||
    Array.isArray(body.payload)
  ) {
    return NextResponse.json(
      { error: "payload must be an object" },
      { status: 400 },
    );
  }
  // Defense-in-depth: validate the payload's `categoryWeights` shape
  // so a malformed blob can never enter `user_weights.payload` and be
  // deserialized as `EngineWeights` later by the run route.
  const payloadCheck = validateEngineWeightsShape(body.payload);
  if (payloadCheck) {
    return NextResponse.json({ error: payloadCheck }, { status: 400 });
  }
  const description = body.description_ko?.slice(0, 280) ?? null;

  const { data, error } = await supabase
    .from("user_weights")
    .upsert(
      {
        user_id: user.id,
        name,
        payload: body.payload as never,
        description_ko: description,
      },
      { onConflict: "user_id,name" },
    )
    .select("id, name")
    .single();
  if (error || !data) {
    return NextResponse.json(
      { error: `user_weights upsert failed: ${error?.message ?? "no row"}` },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { id: data.id, name: data.name },
    { status: 200 },
  );
}

const ALLOWED_ASSET_KEYS = new Set([
  "us_equity",
  "kr_equity",
  "crypto",
  "global_etf",
  "common",
]);

const MAX_ASSET_KEYS = ALLOWED_ASSET_KEYS.size;
const MAX_CATEGORY_KEYS = 20;

/**
 * Returns null when the payload's categoryWeights shape is acceptable,
 * or a human-readable error string otherwise. Mirrors the shape check
 * in `/api/backtest/run` `validateRequest` so a saved row can always
 * be replayed without a separate sanity check at run time.
 */
function validateEngineWeightsShape(payload: object): string | null {
  const cw = (payload as { categoryWeights?: unknown }).categoryWeights;
  if (!cw || typeof cw !== "object" || Array.isArray(cw)) {
    return "payload.categoryWeights must be an object";
  }
  const assetKeys = Object.keys(cw);
  if (assetKeys.length === 0) {
    return "payload.categoryWeights must have at least one assetType";
  }
  if (assetKeys.length > MAX_ASSET_KEYS) {
    return `payload.categoryWeights has too many assetType keys (max ${MAX_ASSET_KEYS})`;
  }
  for (const [aType, weightMap] of Object.entries(cw as Record<string, unknown>)) {
    if (!ALLOWED_ASSET_KEYS.has(aType)) {
      return `payload.categoryWeights has unknown assetType: ${aType}`;
    }
    if (
      !weightMap ||
      typeof weightMap !== "object" ||
      Array.isArray(weightMap)
    ) {
      return `payload.categoryWeights[${aType}] must be an object`;
    }
    const catKeys = Object.keys(weightMap as Record<string, unknown>);
    if (catKeys.length > MAX_CATEGORY_KEYS) {
      return `payload.categoryWeights[${aType}] has too many categories (max ${MAX_CATEGORY_KEYS})`;
    }
    for (const [cat, w] of Object.entries(
      weightMap as Record<string, unknown>,
    )) {
      if (typeof w !== "number" || !Number.isFinite(w) || w < 0 || w > 200) {
        return `payload.categoryWeights[${aType}][${cat}] must be a number in [0, 200]`;
      }
    }
  }
  return null;
}
