import { NextRequest } from "next/server";
import { api, json } from "@/lib/server/http";
import { AppError } from "@/lib/server/errors";
import { rpc } from "@/lib/server/db";
import { requireSession } from "@/lib/server/session";
import { requireWeekParam } from "@/lib/server/pagination";

export const dynamic = "force-dynamic";

export const GET = api(async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const { tokenHash } = await requireSession();
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new AppError(404, "not_found", "找不到这位用户。");
  }
  const week = requireWeekParam(request.nextUrl.searchParams.get("week"));
  const profile = await rpc<{ user: { id: string; display_name: string; avatar_version: number }; week_key: string; items: Array<{
    id: string; day_index: number; slot_index: number; nickname: string; location: string; note: string; created_at: string;
  }> }>("app_user_week", { p_session_hash: tokenHash, p_user_id: id, p_week_key: week });
  return json({ ...profile, serverTime: new Date().toISOString() });
});
