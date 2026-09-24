import { NextRequest } from "next/server";
import { z } from "zod";
import { api, assertSameOrigin, json, readJson } from "@/lib/server/http";
import { AppError } from "@/lib/server/errors";
import { rpc } from "@/lib/server/db";
import { requireSession } from "@/lib/server/session";
import { consumeRateLimits } from "@/lib/server/security";
import { resetRequestActionSchema } from "@/lib/server/validation";
import { updateAuthPasswordToDefault } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
type Prepared = { target_user_id: string; reset_attempt: string };

export const PATCH = api(async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(request);
  const input = await readJson(request, resetRequestActionSchema);
  const { id } = await context.params;
  const parsedId = z.string().uuid().safeParse(id);
  if (!parsedId.success) throw new AppError(422, "invalid_request", "请求编号无效。");
  const { session, tokenHash } = await requireSession();
  if (!session.isAdmin) throw new AppError(403, "forbidden", "没有权限处理管理员收件箱。");
  await consumeRateLimits([{ key: "account:" + session.id + ":admin-write", limit: 30, windowSeconds: 900 }]);
  if (input.action === "dismiss") {
    await rpc<number>("app_admin_dismiss_password_reset_request", { p_session_hash: tokenHash, p_request_id: parsedId.data });
    return json({ ok: true, status: "dismissed" });
  }

  const prepared = await rpc<Prepared>("app_admin_prepare_request_password_reset", {
    p_session_hash: tokenHash, p_request_id: parsedId.data,
  });
  if (!prepared.reset_attempt || !prepared.target_user_id) {
    throw new AppError(409, "reset_already_pending", "该账号已有待核验流程；保持停用，需先完成核验。");
  }
  const outcome = await updateAuthPasswordToDefault(prepared.target_user_id);
  if (outcome === "unknown") {
    throw new AppError(503, "reset_outcome_unknown", "密码更新结果暂时无法确认；账号保持停用，申请保留待核验。");
  }
  if (outcome === "rejected") {
    await rpc<number>("app_admin_fail_password_reset", {
      p_session_hash: tokenHash, p_target_user_id: prepared.target_user_id, p_attempt_id: prepared.reset_attempt,
    });
    throw new AppError(422, "password_rejected", "认证服务拒绝了重置；该申请仍保留，请核验后再试。");
  }
  await rpc("app_admin_finish_password_reset_with_change", {
    p_session_hash: tokenHash, p_target_user_id: prepared.target_user_id,
    p_attempt_id: prepared.reset_attempt, p_reason: input.reason,
  });
  return json({ ok: true, status: "resolved", mustChangePassword: true });
});
