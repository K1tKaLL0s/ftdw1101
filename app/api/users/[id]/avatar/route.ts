import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { api } from "@/lib/server/http";
import { AppError } from "@/lib/server/errors";
import { getServiceClient, rpc } from "@/lib/server/db";
import { requireSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export const GET = api(async (_request: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const { tokenHash } = await requireSession();
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new AppError(404, "not_found", "找不到这位用户。");
  }
  const avatarVersion = await rpc<number>("app_active_avatar_version", { p_session_hash: tokenHash, p_user_id: id });
  const headers = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" };
  const fallback = async () => new NextResponse(await readFile(join(process.cwd(), "public", "default-avatar.png")), {
    headers: { ...headers, "Content-Type": "image/png" },
  });
  if (avatarVersion === 0) return fallback();
  const { data, error } = await getServiceClient().storage.from("avatars").download(`${id}/avatar.webp`);
  if (error || !data) return fallback();
  return new NextResponse(await data.arrayBuffer(), { headers: { ...headers, "Content-Type": "image/webp" } });
});
