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
