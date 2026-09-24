import { NextRequest, NextResponse } from "next/server";
import { api, assertSameOrigin } from "@/lib/server/http";
import { getServiceClient, rpc } from "@/lib/server/db";
import { requireSession } from "@/lib/server/session";
import { consumeRateLimits } from "@/lib/server/security";
import { readAvatarBody, transformAvatar } from "@/lib/server/avatar";

export const dynamic = "force-dynamic";

export const POST = api(async (request: NextRequest) => {
  assertSameOrigin(request);
  const { session, tokenHash } = await requireSession();
  await consumeRateLimits([{ key: "account:" + session.id + ":avatar-upload", limit: 10, windowSeconds: 3600 }]);
  const input = await readAvatarBody(request);
  const output = await transformAvatar(input, request.headers.get("content-type"));
  const { error } = await getServiceClient().storage.from("avatars").upload(`${session.id}/avatar.webp`, output, {
    contentType: "image/webp", upsert: true, cacheControl: "0",
  });
  if (error) throw new Error("avatar storage upload failed");
  const avatarVersion = await rpc<number>("app_increment_avatar_version", { p_session_hash: tokenHash });
  return NextResponse.json({ ok: true, avatarVersion }, { headers: { "Cache-Control": "no-store" } });
});
