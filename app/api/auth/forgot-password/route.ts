import { NextRequest } from "next/server";
import { api, assertSameOrigin, json, readJson } from "@/lib/server/http";
import { rpc } from "@/lib/server/db";
import { consumeRateLimits, sourceLimitKey, usernameLimitKey } from "@/lib/server/security";
import { forgotPasswordSchema } from "@/lib/server/validation";

export const dynamic = "force-dynamic";
const responseMessage = "如果此用户名对应可用账号，管理员会收到重置请求。";

export const POST = api(async (request: NextRequest) => {
  assertSameOrigin(request);
  const { username } = await readJson(request, forgotPasswordSchema);
  await consumeRateLimits([
    { key: sourceLimitKey(request) + ":forgot-password", limit: 5, windowSeconds: 900 },
    { key: usernameLimitKey(username) + ":forgot-password", limit: 3, windowSeconds: 3600 },
  ]);
  await rpc<boolean>("app_request_password_reset", { p_username: username });
  return json({ message: responseMessage });
});
