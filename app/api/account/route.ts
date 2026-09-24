import { NextRequest } from "next/server";
import { accountProfileSchema } from "@/lib/server/validation";
import { api, assertSameOrigin, json, readJson } from "@/lib/server/http";
import { rpc } from "@/lib/server/db";
import { requireSession } from "@/lib/server/session";
import { consumeRateLimits } from "@/lib/server/security";

export const dynamic = "force-dynamic";

export const GET = api(async () => {
  const { tokenHash } = await requireSession({ allowPasswordChange: true });
  const profile = await rpc<{ id: string; username: string; display_name: string; avatar_version: number; role: "user" | "admin"; must_change_password: boolean }>(
    "app_account_profile", { p_session_hash: tokenHash },
  );
  return json({ profile });
});

export const PATCH = api(async (request: NextRequest) => {
  assertSameOrigin(request);
  const input = await readJson(request, accountProfileSchema);
  const { session, tokenHash } = await requireSession();
  await consumeRateLimits([{ key: "account:" + session.id + ":profile-write", limit: 20, windowSeconds: 900 }]);
  const profile = await rpc<{ display_name: string }>("app_update_display_name", {
    p_session_hash: tokenHash, p_display_name: input.display_name,
  });
  return json({ profile });
});
