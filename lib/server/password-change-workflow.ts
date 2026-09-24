export type VerificationResult = "valid" | "invalid" | "unavailable";
export type AuthUpdateResult = "changed" | "rejected" | "unknown";
export type PasswordChangeResult = "changed" | "rejected" | "unknown";

export type PasswordChangeDependencies = {
  verifyCurrent(userId: string, email: string, password: string): Promise<VerificationResult>;
  prepare(userId: string, tokenHash: string, authEpoch: number, recovery: boolean): Promise<string>;
  updateAuth(userId: string, newPassword: string): Promise<AuthUpdateResult>;
  finish(userId: string, attemptId: string, outcome: "changed" | "rejected"): Promise<void>;
  clearSession(): Promise<void>;
};

export async function performPasswordChange(input: {
  userId: string;
  email: string;
  tokenHash: string;
  authEpoch: number;
  recovery: boolean;
  currentPassword?: string;
  newPassword: string;
}, dependencies: PasswordChangeDependencies): Promise<PasswordChangeResult | "invalid_current" | "verification_unavailable"> {
  if (!input.recovery) {
    if (!input.currentPassword) return "invalid_current";
    const verification = await dependencies.verifyCurrent(input.userId, input.email, input.currentPassword);
    if (verification === "invalid") return "invalid_current";
    if (verification === "unavailable") return "verification_unavailable";
  }

  const attemptId = await dependencies.prepare(input.userId, input.tokenHash, input.authEpoch, input.recovery);
  try {
    const outcome = await dependencies.updateAuth(input.userId, input.newPassword);
    if (outcome === "unknown") return "unknown";
    if (outcome === "rejected") {
      await dependencies.finish(input.userId, attemptId, "rejected");
      return "rejected";
    }
    try {
      await dependencies.finish(input.userId, attemptId, "changed");
      return "changed";
    } catch {
      return "unknown";
    }
  } finally {
    await dependencies.clearSession();
  }
}
