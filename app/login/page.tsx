"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiRequest, ApiError, postJson } from "@/lib/api";

type LoginState = "login" | "register" | "forgot";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<LoginState>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [feedback, setFeedback] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setFeedback(false);
    setFieldErrors({});
    if (mode === "forgot") {
      try {
        const result = await postJson<{ message: string }>("/api/auth/forgot-password", { username });
        setMessage(result.message); setFeedback(true);
      } catch (error) {
        if (error instanceof ApiError) { setMessage(error.message); setFieldErrors(error.fields ?? {}); }
        else setMessage("服务暂时不可用，请稍后重试。");
      } finally { setBusy(false); }
      return;
    }
    if (mode === "register") {
      if (Array.from(password).length < 8) { setFieldErrors({ password: ["密码至少 8 位。"] }); setBusy(false); return; }
      if (new TextEncoder().encode(password).byteLength > 72) { setFieldErrors({ password: ["新密码最多 72 个 UTF-8 字节。"] }); setBusy(false); return; }
      if (!/[A-Z]/.test(password)) { setFieldErrors({ password: ["密码至少包含一个大写英文字母。"] }); setBusy(false); return; }
      if (!/[!-/:-@[-`{-~]/.test(password)) { setFieldErrors({ password: ["密码至少包含一个特殊符号（如 !、@、#）。"] }); setBusy(false); return; }
    }
    try {
      await postJson(mode === "login" ? "/api/auth/login" : "/api/auth/register", { username, password });
      const session = await apiRequest<{ user: { mustChangePassword: boolean } | null }>("/api/auth/session");
      router.replace(session.user?.mustChangePassword ? "/account?section=security" : "/schedule");
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError) { setMessage(error.message); setFieldErrors(error.fields ?? {}); }
      else setMessage("服务暂时不可用，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <Link href="/" className="text-sm font-medium text-slate-500 hover:text-slate-800">← 来牌首页</Link>
        <h1 className="mt-6 text-3xl font-bold tracking-tight">来牌</h1>
        {mode === "login" && <p className="mt-2 text-slate-600">使用用户名和密码登录。</p>}
        {mode === "forgot" && <p className="mt-2 text-slate-600">提交用户名后，系统会以相同方式反馈并通知管理员核验。</p>}

        <form onSubmit={submit} className="mt-7 space-y-5">
          <div>
            <label htmlFor="username" className="mb-1.5 block text-sm font-semibold">用户名</label>
            <input id="username" name="username" autoComplete="username" required minLength={3} maxLength={24}
              pattern="[A-Za-z0-9_]{3,24}" aria-invalid={Boolean(fieldErrors.username)} aria-describedby={fieldErrors.username?.length ? "username-error" : undefined} value={username} onChange={(event) => { setUsername(event.target.value); setFieldErrors((old) => ({ ...old, username: [] })); }}
              className="min-h-12 w-full rounded-lg border border-slate-300 px-3 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100" />
            {fieldErrors.username?.map((error, index) => <p id={index === 0 ? "username-error" : undefined} key={index} className="mt-1 text-sm text-rose-700">{error}</p>)}
          </div>
          {mode !== "forgot" && <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-semibold">密码</label>
            <input id="password" name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"}
              required maxLength={mode === "register" ? 72 : 128} aria-invalid={Boolean(fieldErrors.password)} aria-describedby={[...(mode === "register" ? ["password-help"] : []), ...(fieldErrors.password?.length ? ["password-error"] : [])].join(" ") || undefined}
              value={password} onChange={(event) => { setPassword(event.target.value); setFieldErrors((old) => ({ ...old, password: [] })); }}
              className="min-h-12 w-full rounded-lg border border-slate-300 px-3 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              placeholder={mode === "login" ? "输入密码" : undefined} />
            {mode === "register" && <p id="password-help" className="mt-1 text-xs leading-5 text-slate-500">新密码至少 8 个字符，包含一个大写英文字母和一个特殊符号（如 !、@、#），最多 72 个 UTF-8 字节；不要求小写字母或数字。</p>}
            {fieldErrors.password?.map((error, index) => <p id={index === 0 ? "password-error" : undefined} key={index} className="mt-1 text-sm text-rose-700">{error}</p>)}
          </div>}
          {mode === "login" && <button type="button" onClick={() => { setMode("forgot"); setPassword(""); setMessage(""); }} className="-mt-2 min-h-10 text-left text-sm font-medium text-blue-700 underline">忘记密码？</button>}
          {message && <p role={feedback ? "status" : "alert"} className={`rounded-lg px-3 py-2.5 text-sm ${feedback ? "bg-blue-50 text-blue-900" : "bg-rose-50 text-rose-800"}`}>{message}</p>}
          <button disabled={busy} className="min-h-12 w-full rounded-lg bg-blue-700 px-4 font-semibold text-white transition hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:cursor-wait disabled:opacity-60">
            {busy ? "处理中…" : mode === "login" ? "登录" : mode === "register" ? "注册并登录" : "提交申请"}
          </button>
        </form>
        <div className="mt-6 border-t border-slate-100 pt-5 text-center">
          <button type="button" disabled={busy} onClick={() => { setMode(mode === "forgot" || mode === "register" ? "login" : "register"); setMessage(""); setFeedback(false); }}
            className="min-h-11 px-3 text-sm font-medium text-blue-700 underline-offset-4 hover:underline">
            {mode === "login" ? "还没有账号？创建一个" : mode === "register" ? "已有账号？返回登录" : "返回登录"}
          </button>
        </div>
      </section>
    </main>
  );
}
