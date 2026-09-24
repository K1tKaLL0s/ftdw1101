import { NextRequest } from "next/server";
import { api, json } from "@/lib/server/http";
import { AppError } from "@/lib/server/errors";
import { rpc } from "@/lib/server/db";
import { requireSession } from "@/lib/server/session";
import { consumeRateLimits } from "@/lib/server/security";
import { decodeUuidCursor, encodeCursor } from "@/lib/server/pagination";

export const dynamic = "force-dynamic";
type ResetRequest = { id: string; user_id: string; username: string; status: string; requested_at: string };
type Page = { items: ResetRequest[]; total: number; hasMore: boolean };

export const GET = api(async (request: NextRequest) => {
  const { session, tokenHash } = await requireSession();
  if (!session.isAdmin) throw new AppError(403, "forbidden", "没有权限查看管理员收件箱。");
  const cursor = decodeUuidCursor(request.nextUrl.searchParams.get("cursor"));
  await consumeRateLimits([{ key: "account:" + session.id + ":admin-read", limit: 120, windowSeconds: 900 }]);
  const page = await rpc<Page>("app_admin_list_password_reset_requests", {
    p_session_hash: tokenHash, p_before_requested_at: cursor?.createdAt ?? null, p_before_id: cursor?.id ?? null, p_page_size: 30,
  });
  const last = page.items.at(-1);
  return json({ ...page, nextCursor: page.hasMore && last ? encodeCursor(last.requested_at, last.id) : null });
});
