"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, apiRequest, postJson } from "@/lib/api";
import { UserAvatar } from "@/components/user-avatar";
import { DAY_LABELS, SCHEDULE_SLOTS } from "@/lib/schedule";
import { formatWeekDay, getCurrentWeekKey, getWeekOffset, shiftWeekKey } from "@/lib/week";
import { useScheduleClock } from "@/lib/use-schedule-clock";

type SessionUser = { id: string; username: string; isAdmin: boolean; mustChangePassword: boolean; canChangePasswordWithoutCurrent: boolean; displayName: string; avatarVersion: number };
type Profile = { id: string; username: string; display_name: string; avatar_version: number; role: "user" | "admin"; must_change_password: boolean };
type Appointment = { id: string; day_index: number; slot_index: number; nickname: string; location: string; note: string; created_at: string };

const explain = (error: unknown) => error instanceof ApiError ? error.message : "服务暂时不可用，请稍后重试。";

export default function AccountPage() {
  const router = useRouter();
  const { now, initialized: clockReady, calibrate } = useScheduleClock();
  const currentWeek = getCurrentWeekKey(now);
  const [section, setSection] = useState<"profile" | "security" | "marks">("profile");
  const [session, setSession] = useState<SessionUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [week, setWeek] = useState(currentWeek);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [appointmentsLoading, setAppointmentsLoading] = useState(false);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [displayName, setDisplayName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const appointmentGeneration = useRef(0);
  const previousCurrentWeek = useRef<string | null>(null);

  const recovery = Boolean(session?.canChangePasswordWithoutCurrent);
  const minWeek = useMemo(() => shiftWeekKey(currentWeek, -8), [currentWeek]);
  const maxWeek = useMemo(() => shiftWeekKey(currentWeek, 4), [currentWeek]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiRequest<{ user: SessionUser | null; serverTime?: string }>("/api/auth/session");
      calibrate(result.serverTime);
      if (!result.user) { router.replace("/login"); return; }
      setSession(result.user);
      if (result.user.mustChangePassword || result.user.canChangePasswordWithoutCurrent) setSection("security");
      const requestedWeek = new URLSearchParams(window.location.search).get("week");
      const serverWeek = getCurrentWeekKey(result.serverTime ? new Date(result.serverTime) : new Date());
      const requestedOffset = requestedWeek && /^\d{4}-\d{2}-\d{2}$/.test(requestedWeek)
        ? getWeekOffset(serverWeek, requestedWeek)
        : Number.NaN;
      const requestedIsValid = Number.isInteger(requestedOffset) && requestedOffset >= -8 && requestedOffset <= 4
        && shiftWeekKey(serverWeek, requestedOffset) === requestedWeek;
      const activeWeek = requestedIsValid ? requestedWeek! : serverWeek;
      previousCurrentWeek.current = serverWeek;
      setWeek(activeWeek);
      const account = await apiRequest<{ profile: Profile }>("/api/account");
      setProfile(account.profile);
      setDisplayName(account.profile.display_name);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) router.replace("/login");
      else setError(explain(cause));
    } finally { setLoading(false); }
  }, [calibrate, router]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const requested = new URLSearchParams(window.location.search).get("section");
      if (requested === "security" || requested === "marks" || requested === "profile") setSection(requested);
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  useEffect(() => {
    if (!clockReady || !profile) return;
    const previous = previousCurrentWeek.current;
    if (!previous) { previousCurrentWeek.current = currentWeek; return; }
    if (previous === currentWeek) return;
    const timer = window.setTimeout(() => {
      setWeek((viewedWeek) => {
        if (viewedWeek === previous) return currentWeek;
        const offset = getWeekOffset(currentWeek, viewedWeek);
        if (offset < -8) return shiftWeekKey(currentWeek, -8);
        if (offset > 4) return shiftWeekKey(currentWeek, 4);
        return viewedWeek;
      });
      previousCurrentWeek.current = currentWeek;
    }, 0);
    return () => window.clearTimeout(timer);
  }, [clockReady, currentWeek, profile]);

  useEffect(() => {
    if (section !== "marks" || !session || session.mustChangePassword) return;
    const generation = ++appointmentGeneration.current;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setAppointmentsLoading(true);
      setAppointments([]);
      setError("");
      void apiRequest<{ items: Appointment[] }>(`/api/users/${session.id}?week=${encodeURIComponent(week)}`, { signal: controller.signal })
        .then((result) => { if (generation === appointmentGeneration.current) setAppointments(result.items); })
        .catch((cause) => { if (!controller.signal.aborted && generation === appointmentGeneration.current) { setAppointments([]); setError(explain(cause)); } })
        .finally(() => { if (generation === appointmentGeneration.current) setAppointmentsLoading(false); });
    }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [appointmentGeneration, section, session, week]);

  useEffect(() => {
    if (!session?.isAdmin || session.mustChangePassword) return;
    const refresh = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      void apiRequest<{ total: number }>("/api/admin/password-reset-requests")
        .then((result) => setPendingRequests(result.total)).catch(() => {});
    };
    const initial = window.setTimeout(refresh, 0);
    const interval = window.setInterval(refresh, 30_000);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); };
  }, [session]);

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const result = await postJson<{ profile: { display_name: string } }>("/api/account", { display_name: displayName }, "PATCH");
      setDisplayName(result.profile.display_name);
      setProfile((old) => old ? { ...old, display_name: result.profile.display_name } : old);
      setNotice("个人资料已保存。");
    } catch (cause) { setError(cause instanceof ApiError && cause.fields ? explain(cause) + " " + Object.values(cause.fields).flat().join(" ") : explain(cause)); }
    finally { setBusy(false); }
  }

  async function uploadAvatar(file?: File) {
    if (!file) return;
    const local = URL.createObjectURL(file);
    setPreviewUrl(local); setError(""); setNotice(""); setBusy(true);
    try {
      const result = await apiRequest<{ avatarVersion: number }>("/api/account/avatar", {
        method: "POST", body: file, headers: { "Content-Type": file.type },
      });
      setProfile((old) => old ? { ...old, avatar_version: result.avatarVersion } : old);
      setSession((old) => old ? { ...old, avatarVersion: result.avatarVersion } : old);
      setNotice("头像已更新。");
    } catch (cause) { setError(cause instanceof ApiError && cause.fields ? explain(cause) + " " + Object.values(cause.fields).flat().join(" ") : explain(cause)); }
    finally { setBusy(false); setPreviewUrl(""); }
  }

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      await postJson("/api/account/password", {
        ...(recovery ? {} : { current_password: currentPassword }),
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      router.replace("/login?changed=1"); router.refresh();
    } catch (cause) { setError(cause instanceof ApiError && cause.fields ? explain(cause) + " " + Object.values(cause.fields).flat().join(" ") : explain(cause)); }
    finally { setBusy(false); }
  }

  if (loading) return <main className="p-8 text-center text-slate-600">正在加载个人中心…</main>;
  if (!session || !profile) return <main className="mx-auto max-w-lg p-8 text-center"><p role="alert" className="text-rose-800">{error || "无法读取账户资料。"}</p><button type="button" onClick={() => void load()} className="mt-4 min-h-11 rounded-lg border px-4">重试</button></main>;

  return <main className="mx-auto max-w-4xl px-3 py-5 sm:px-6 sm:py-8">
    <header className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex min-w-0 items-center gap-4"><UserAvatar userId={profile.id} version={profile.avatar_version} name={profile.display_name || "牌友"} size={64} /><div className="min-w-0"><Link href="/" className="text-sm font-medium text-slate-500">← 返回登记表</Link><h1 className="mt-1 break-words text-2xl font-bold">个人中心</h1><p className="mt-1 break-all text-sm text-slate-600">{profile.display_name || "牌友"}{profile.role === "admin" ? " · 管理员" : ""}</p></div></div>
      <nav className="flex flex-wrap gap-2">{profile.role === "admin" && <><Link href="/admin" className="min-h-11 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold">管理入口</Link><Link href="/admin/password-reset-requests" className="min-h-11 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-900">站内申请{pendingRequests ? ` · ${pendingRequests}` : ""}</Link></>}<button type="button" onClick={async () => { try { await postJson("/api/auth/logout", {}); router.replace("/login"); } catch (cause) { setError(explain(cause)); } }} className="min-h-11 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold">退出</button></nav>
    </header>
    {session.mustChangePassword && <p role="status" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">此账号需要先设置新密码。完成后请重新登录，其他功能暂不可用。</p>}
    {error && <p role="alert" className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}{notice && <p role="status" className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    {!session.mustChangePassword && <nav aria-label="个人中心分区" className="mb-4 grid grid-cols-3 rounded-xl border border-slate-200 bg-white p-1">
      {([['profile', '资料'], ['security', '账号安全'], ['marks', '我的预约']] as const).map(([key, label]) => <button type="button" key={key} aria-pressed={section === key} onClick={() => setSection(key)} className={`min-h-11 rounded-lg px-2 text-sm font-semibold ${section === key ? "bg-blue-700 text-white" : "text-slate-600"}`}>{label}</button>)}
    </nav>}

    {(section === "profile" && !session.mustChangePassword) && <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <h2 className="text-lg font-bold">个人资料</h2><p className="mt-1 text-sm text-slate-600">登录名仅自己和管理员可见；其他用户看到昵称与头像。</p>
      <div className="mt-5 flex flex-wrap items-center gap-4"><div className="relative h-20 w-20 overflow-hidden rounded-full bg-slate-100"><Image src={previewUrl || `/api/users/${profile.id}/avatar?v=${profile.avatar_version}`} alt="头像预览" fill unoptimized className="object-cover" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = "/default-avatar.png"; }} /></div><label className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-slate-300 px-4 text-sm font-semibold">选择头像<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={busy} onChange={(event) => { void uploadAvatar(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /></label><p className="max-w-md text-sm text-slate-500">JPEG、PNG 或 WebP；上传后会裁切成正方形并移除图片元数据，原图不公开。</p></div>
      <form onSubmit={saveProfile} className="mt-6 space-y-4"><div><label htmlFor="display-name" className="mb-1 block text-sm font-semibold">昵称</label><input id="display-name" maxLength={30} value={displayName} disabled={busy} onChange={(event) => setDisplayName(event.target.value)} className="min-h-12 w-full max-w-md rounded-lg border border-slate-300 px-3" /><p className="mt-1 text-xs text-slate-500">留空将显示为“牌友”；最长 30 字。</p></div><div><label className="mb-1 block text-sm font-semibold">登录用户名</label><p className="min-h-12 max-w-md rounded-lg bg-slate-50 px-3 py-3 text-sm">{profile.username}</p></div><button disabled={busy} className="min-h-11 rounded-lg bg-blue-700 px-5 font-semibold text-white disabled:opacity-50">{busy ? "保存中…" : "保存资料"}</button></form>
    </section>}

    {(section === "security" || session.mustChangePassword) && <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <h2 className="text-lg font-bold">{session.mustChangePassword ? "设置新密码" : "修改密码"}</h2>
      {recovery ? <p className="mt-1 text-sm text-amber-800">这是当前登录会话的一次性恢复入口。提交后会注销所有设备，并且此恢复入口不会再次开放。</p> : <p className="mt-1 text-sm text-slate-600">新密码至少 8 位，包含一个大写英文字母和特殊符号，最多 72 个 UTF-8 字节。</p>}
      <form onSubmit={changePassword} className="mt-5 max-w-lg space-y-4">{recovery && <p className="text-sm text-slate-600">新密码至少 8 位，包含一个大写英文字母和特殊符号，最多 72 个 UTF-8 字节。</p>}{!recovery && <div><label htmlFor="current-password" className="mb-1 block text-sm font-semibold">当前密码</label><input id="current-password" type="password" required autoComplete="current-password" maxLength={128} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className="min-h-12 w-full rounded-lg border border-slate-300 px-3" /></div>}
        <div><label htmlFor="new-password" className="mb-1 block text-sm font-semibold">新密码</label><input id="new-password" type="password" required autoComplete="new-password" maxLength={72} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="min-h-12 w-full rounded-lg border border-slate-300 px-3" /></div>
        <div><label htmlFor="confirm-password" className="mb-1 block text-sm font-semibold">确认新密码</label><input id="confirm-password" type="password" required autoComplete="new-password" maxLength={72} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="min-h-12 w-full rounded-lg border border-slate-300 px-3" /></div>
        <button disabled={busy} className="min-h-11 rounded-lg bg-blue-700 px-5 font-semibold text-white disabled:opacity-50">{busy ? "正在更新…" : "更新密码并重新登录"}</button>
      </form>
    </section>}

    {section === "marks" && !session.mustChangePassword && <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b p-4"><div><h2 className="font-bold">我的预约</h2><p className="text-sm text-slate-500">所选周内的未删除登记。</p></div><div className="flex items-center gap-2"><button type="button" disabled={week <= minWeek} onClick={() => setWeek(shiftWeekKey(week, -1))} className="min-h-11 rounded-lg border px-3">上一周</button><span className="text-sm font-medium">{week}</span><button type="button" disabled={week >= maxWeek} onClick={() => setWeek(shiftWeekKey(week, 1))} className="min-h-11 rounded-lg border px-3">下一周</button></div></div>
      <div className="divide-y divide-slate-100">{appointmentsLoading ? <p className="p-8 text-center text-slate-500">正在加载…</p> : <>{appointments.map((item) => <article key={item.id} className="flex min-w-0 gap-3 p-4"><UserAvatar userId={profile.id} version={profile.avatar_version} name={profile.display_name || "牌友"} size={40} /><div className="min-w-0"><p className="font-semibold">{DAY_LABELS[item.day_index]} {formatWeekDay(week, item.day_index)} · {SCHEDULE_SLOTS[item.slot_index]?.label}</p><p className="mt-1 break-words text-sm text-slate-600">登记昵称：{item.nickname} · 场地：{item.location || "皆可"}</p>{item.note && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700">备注：{item.note}</p>}</div></article>)}{appointments.length === 0 && <p className="p-8 text-center text-sm text-slate-500">这一周还没有预约。</p>}</>}</div>
    </section>}
  </main>;
}
