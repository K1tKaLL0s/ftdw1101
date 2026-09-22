"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Step = "email" | "otp";

/** 邮箱 OTP：先发 6 位码，再校验登录 */
export function LoginForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function sendCode(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    const supabase = createClient();
    const { error: sendError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser: true,
      },
    });

    setLoading(false);

    if (sendError) {
      setError(sendError.message);
      return;
    }

    setMessage("验证码已发送，请查看邮箱（含垃圾邮件箱）。");
    setStep("otp");
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const supabase = createClient();
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: otp.trim(),
      type: "email",
    });

    setLoading(false);

    if (verifyError) {
      setError(verifyError.message);
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-slate-900">团队时段标记</h1>
      <p className="mt-1 text-sm text-slate-500">用邮箱验证码登录，无需密码</p>

      {step === "email" ? (
        <form className="mt-6 space-y-4" onSubmit={sendCode}>
          <label className="block text-sm font-medium text-slate-700">
            邮箱
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              placeholder="you@example.com"
              autoComplete="email"
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-60"
          >
            {loading ? "发送中…" : "发送验证码"}
          </button>
        </form>
      ) : (
        <form className="mt-6 space-y-4" onSubmit={verifyCode}>
          <p className="text-sm text-slate-600">
            验证码已发到 <span className="font-medium">{email}</span>
          </p>
          <label className="block text-sm font-medium text-slate-700">
            6 位验证码
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 tracking-[0.4em] text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              placeholder="000000"
              autoComplete="one-time-code"
            />
          </label>
          <button
            type="submit"
            disabled={loading || otp.length !== 6}
            className="w-full rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-60"
          >
            {loading ? "登录中…" : "登录"}
          </button>
          <button
            type="button"
            className="w-full text-sm text-slate-500 hover:text-slate-800"
            onClick={() => {
              setStep("email");
              setOtp("");
              setError("");
              setMessage("");
            }}
          >
            返回修改邮箱
          </button>
        </form>
      )}

      {message ? (
        <p className="mt-4 text-sm text-emerald-700">{message}</p>
      ) : null}
      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
