import { NextRequest } from "next/server";
import { api, assertSameOrigin, json, readJson } from "@/lib/server/http";
import { AppError } from "@/lib/server/errors";
import { rpc } from "@/lib/server/db";
import { requireSession, clearAppSessionCookie } from "@/lib/server/session";
import { consumeRateLimits } from "@/lib/server/security";
import { selfPasswordChangeSchema } from "@/lib/server/validation";
import { updateAuthPassword, verifyCurrentPassword } from "@/lib/server/auth";
import { performPasswordChange } from "@/lib/server/password-change-workflow";

export const dynamic = "force-dynamic";

export const POST = api(async (request: NextRequest) => {
  assertSameOrigin(request);
  const input = await readJson(request, selfPasswordChangeSchema);
  const { session, tokenHash } = await requireSession({ allowPasswordChange: true });
  await consumeRateLimits([{ key: "account:" + session.id + ":password-change", limit: 5, windowSeconds: 900 }]);
  const recovery = session.canChangePasswordWithoutCurrent;
  if (!recovery && !input.current_password) {
    throw new AppError(422, "current_password_required", "请填写当前密码。");
  }
  const outcome = await performPasswordChange({
    userId: session.id,
    email: session.authEmail,
    tokenHash,
    authEpoch: session.authEpoch,
    recovery,
    currentPassword: input.current_password,
    newPassword: input.new_password,
  }, {
    verifyCurrent: verifyCurrentPassword,
    prepare: (_userId, currentTokenHash, epoch, isRecovery) => rpc<string>(
      isRecovery ? "app_prepare_recovery_password_change" : "app_prepare_self_password_change",
      { p_session_hash: currentTokenHash, p_expected_auth_epoch: epoch },
    ),
    updateAuth: updateAuthPassword,
    finish: async (userId, attemptId, result) => {
      await rpc("app_finish_self_password_change", { p_user_id: userId, p_attempt_id: attemptId, p_outcome: result });
    },
    clearSession: clearAppSessionCookie,
  });

  if (outcome === "invalid_current") throw new AppError(401, "current_password_invalid", "当前密码不正确。");
  if (outcome === "verification_unavailable") throw new AppError(503, "password_verification_unavailable", "暂时无法验证当前密码，请稍后重试。");
  if (outcome === "rejected") throw new AppError(422, "password_rejected", recovery
    ? "新密码未生效，本次恢复流程已结束，请联系网站维护者。"
    : "认证服务拒绝了新密码。流程已结束，请重新登录后再试。");
  if (outcome === "unknown") throw new AppError(503, "password_change_unknown", "密码更新结果暂时无法确认，请联系网站维护者核验后再登录。");
  return json({ ok: true, reauthenticationRequired: true });
});
