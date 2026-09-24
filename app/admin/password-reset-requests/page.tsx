"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, apiRequest, postJson } from "@/lib/api";

type RequestRow = { id: string; user_id: string; username: string; status: "active" | "banned" | "deleted" | "reset_pending"; requested_at: string };
type Action = { id: string; username: string; action: "dismiss" | "reset_default_password" };
type Page = { items: RequestRow[]; total: number; nextCursor: string | null };

const explain = (error: unknown) => error instanceof ApiError ? error.message : "服务暂时不可用，请稍后重试。";
const STATUS: Record<RequestRow["status"], string> = { active: "可用账号", banned: "账号已封禁", deleted: "账号已软删除", reset_pending: "重置待核验" };

export default function PasswordResetRequestsPage() {
  const router = useRouter();
  const [page, setPage] = useState<Page>({ items: [], total: 0, nextCursor: null });
  const [cursor, setCursor] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const generation = useRef(0);
  const requestedCursor = useRef<string | null>(null);

  const load = useCallback(async (nextCursor: string | null = null, quiet = false) => {
    requestedCursor.current = nextCursor;
    const current = ++generation.current;
    if (!quiet) setLoading(true);
    try {
      const session = await apiRequest<{ user: { isAdmin: boolean; mustChangePassword: boolean } | null }>("/api/auth/session");
      if (!session.user) { router.replace("/login"); return; }
      if (session.user.mustChangePassword) { router.replace("/account?section=security"); return; }
      if (!session.user.isAdmin) { router.replace("/schedule"); return; }
      const result = await apiRequest<Page>(`/api/admin/password-reset-requests${nextCursor ? `?cursor=${encodeURIComponent(nextCursor)}` : ""}`);
      if (current !== generation.current) return;
      setPage(result); setCursor(nextCursor); setError("");
    } catch (cause) {
      if (current !== generation.current) return;
      if (cause instanceof ApiError && cause.status === 401) router.replace("/login");
      else setError(explain(cause));
    } finally { if (current === generation.current) setLoading(false); }
  }, [router]);

  useEffect(() => { const timer = window.setTimeout(() => void load(null), 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => { const interval = window.setInterval(() => { if (document.visibilityState === "visible") void load(requestedCursor.current, true); }, 30_000); return () => window.clearInterval(interval); }, [load]);
  useEffect(() => { if (action && dialog.current && !dialog.current.open) dialog.current.showModal(); if (!action && dialog.current?.open) dialog.current.close(); }, [action]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!action) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const payload = action.action === "dismiss" ? { action: "dismiss" } : { action: "reset_default_password", reason };
      await postJson(`/api/admin/password-reset-requests/${action.id}`, payload, "PATCH");
      setNotice(action.action === "dismiss" ? `已忽略 ${action.username} 的申请。` : `已重置 ${action.username} 的密码；该用户下次登录须设置新密码。`);
      setAction(null); setReason(""); await load(cursor);
    } catch (cause) { setError(explain(cause)); }
    finally { setBusy(false); }
  }

  return <main className="mx-auto max-w-4xl px-3 py-5 sm:px-6 sm:py-8">
    <header className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"><div><Link href="/admin" className="text-sm font-medium text-slate-500">← 返回管理员</Link><h1 className="mt-1 text-2xl font-bold">密码重置申请</h1><p className="mt-1 text-sm text-slate-500">申请不证明身份。管理员应先线下核验本人；不确定的重置会保留在此列表。</p></div><button type="button" disabled={loading} onClick={() => void load(cursor)} className="min-h-11 rounded-lg border px-4 text-sm font-semibold">刷新</button></header>
    {error && <p role="alert" className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}{notice && <p role="status" className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b p-4"><h2 className="font-bold">待处理申请（{page.total}）</h2></div>
      {loading ? <p className="p-8 text-center text-slate-500">正在加载…</p> : page.items.length === 0 ? <p className="p-8 text-center text-slate-500">目前没有待处理申请。</p> : <div className="divide-y divide-slate-100">{page.items.map((item) => <article key={item.id} className="grid min-w-0 gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div className="min-w-0"><h3 className="break-all font-semibold">{item.username}</h3><p className="mt-1 text-sm text-slate-600">账号状态：{STATUS[item.status]}</p><time className="mt-1 block text-xs text-slate-500" dateTime={item.requested_at}>{new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(item.requested_at))}（北京时间）</time></div><div className="flex flex-wrap gap-2"><button type="button" disabled={busy || item.status !== "active"} onClick={() => { setReason("管理员批准密码重置申请"); setAction({ id: item.id, username: item.username, action: "reset_default_password" }); }} className="min-h-11 rounded-lg bg-blue-700 px-3 text-sm font-semibold text-white disabled:opacity-40">重置为默认密码</button><button type="button" disabled={busy} onClick={() => { setReason(""); setAction({ id: item.id, username: item.username, action: "dismiss" }); }} className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-semibold">忽略</button></div></article>)}</div>}
      <div className="flex justify-between border-t p-3"><button type="button" disabled={!cursor || loading} onClick={() => void load(null)} className="min-h-11 rounded-lg px-4 text-sm font-semibold text-blue-800 disabled:opacity-40">第一页</button><button type="button" disabled={!page.nextCursor || loading} onClick={() => page.nextCursor && void load(page.nextCursor)} className="min-h-11 rounded-lg px-4 text-sm font-semibold text-blue-800 disabled:opacity-40">下一页</button></div>
    </section>
    {action && <dialog ref={dialog} aria-labelledby="request-action-title" onCancel={(event) => { event.preventDefault(); if (!busy) setAction(null); }} onClick={(event) => { if (event.target === event.currentTarget && !busy) setAction(null); }} className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border-0 bg-white p-5 shadow-xl backdrop:bg-slate-950/45 sm:inset-0 sm:m-auto sm:rounded-2xl sm:p-6"><h2 id="request-action-title" className="text-xl font-bold">{action.action === "dismiss" ? "忽略密码重置申请" : "重置为默认密码"}</h2><p className="mt-2 break-words text-sm text-slate-600">目标用户名：{action.username}</p><p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-950">请先线下确认申请人身份。重置会注销其登录状态；成功后用户须立即设置新密码。</p><form onSubmit={submit} className="mt-4 space-y-4">{action.action === "reset_default_password" && <div><label htmlFor="request-reset-reason" className="mb-1 block text-sm font-semibold">操作原因</label><textarea id="request-reset-reason" required minLength={4} maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} className="min-h-24 w-full rounded-lg border border-slate-300 p-3" placeholder="填写线下核验与处理原因" /></div>}{error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" disabled={busy} onClick={() => setAction(null)} className="min-h-11 rounded-lg border px-4 font-semibold">取消</button><button disabled={busy} className="min-h-11 rounded-lg bg-blue-700 px-5 font-semibold text-white disabled:opacity-50">{busy ? "处理中…" : action.action === "dismiss" ? "确认忽略" : "确认重置"}</button></div></form></dialog>}
  </main>;
}
