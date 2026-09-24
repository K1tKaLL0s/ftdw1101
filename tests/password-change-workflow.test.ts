import assert from "node:assert/strict";
import { test } from "node:test";
import { performPasswordChange, type PasswordChangeDependencies } from "../lib/server/password-change-workflow";

const input = {
  userId: "33333333-3333-4333-8333-333333333333",
  email: "member@example.invalid",
  tokenHash: "a".repeat(64),
  authEpoch: 7,
  currentPassword: "wrong-current-password",
  newPassword: "ValidPass!",
};

test("a wrong or unverifiable current password cannot prepare a reset or change Auth", async () => {
  for (const verification of ["invalid", "unavailable"] as const) {
    const calls: string[] = [];
    const dependencies: PasswordChangeDependencies = {
      verifyCurrent: async () => { calls.push("verify"); return verification; },
      prepare: async () => { calls.push("prepare"); return "attempt"; },
      updateAuth: async () => { calls.push("updateAuth"); return "changed"; },
      finish: async () => { calls.push("finish"); },
      clearSession: async () => { calls.push("clearSession"); },
    };
    const result = await performPasswordChange({ ...input, recovery: false }, dependencies);
    assert.equal(result, verification === "invalid" ? "invalid_current" : "verification_unavailable");
    assert.deepEqual(calls, ["verify"]);
  }
});

test("recovery bypasses old-password verification once, and uncertain finish stays fail-closed", async () => {
  for (const authOutcome of ["changed", "rejected", "unknown"] as const) {
    const outcomeCalls: string[] = [];
    const outcomeDependencies: PasswordChangeDependencies = {
      verifyCurrent: async () => { outcomeCalls.push("verify"); return "invalid"; },
      prepare: async (_userId, _tokenHash, _epoch, recovery) => { outcomeCalls.push(`prepare:${recovery}`); return "attempt"; },
      updateAuth: async () => { outcomeCalls.push(`update:${authOutcome}`); return authOutcome; },
      finish: async (_userId, _attemptId, outcome) => { outcomeCalls.push(`finish:${outcome}`); },
      clearSession: async () => { outcomeCalls.push("clearSession"); },
    };
    const outcomeResult = await performPasswordChange({ ...input, recovery: true, currentPassword: undefined }, outcomeDependencies);
    assert.equal(outcomeResult, authOutcome);
    assert.deepEqual(outcomeCalls, authOutcome === "unknown"
      ? ["prepare:true", "update:unknown", "clearSession"]
      : ["prepare:true", `update:${authOutcome}`, `finish:${authOutcome}`, "clearSession"]);
  }

  const calls: string[] = [];
  const dependencies: PasswordChangeDependencies = {
    verifyCurrent: async () => { calls.push("verify"); return "invalid"; },
    prepare: async (_userId, _tokenHash, _epoch, recovery) => { calls.push(`prepare:${recovery}`); return "attempt"; },
    updateAuth: async () => { calls.push("updateAuth"); return "changed"; },
    finish: async (_userId, _attemptId, outcome) => { calls.push(`finish:${outcome}`); throw new Error("database response lost"); },
    clearSession: async () => { calls.push("clearSession"); },
  };
  const result = await performPasswordChange({ ...input, recovery: true, currentPassword: undefined }, dependencies);
  assert.equal(result, "unknown");
  assert.deepEqual(calls, ["prepare:true", "updateAuth", "finish:changed", "clearSession"]);
});
