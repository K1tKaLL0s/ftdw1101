"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ApiError, apiRequest } from "@/lib/api";
import { UserAvatar } from "@/components/user-avatar";
import { DAY_LABELS, SCHEDULE_SLOTS } from "@/lib/schedule";
import { formatWeekDay, getCurrentWeekKey, getWeekOffset, shiftDayKey, shiftWeekKey } from "@/lib/week";
import { useScheduleClock } from "@/lib/use-schedule-clock";

type UserProfile = { id: string; display_name: string; avatar_version: number };
type UserAppointment = { id: string; day_index: number; slot_index: number; nickname: string; location: string; note: string; created_at: string };
type UserWeek = { user: UserProfile; week_key: string; items: UserAppointment[] };

export default function UserPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { now, initialized: clockReady, calibrate } = useScheduleClock();
  const currentWeek = getCurrentWeekKey(now);
  const [week, setWeek] = useState(currentWeek);
  const [data, setData] = useState<UserWeek | null>(null);
  const [followsCurrentWeek, setFollowsCurrentWeek] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const offset = getWeekOffset(currentWeek, week);

  const load = useCallback(async (requestedWeek?: string) => {
    controller.current?.abort();
    const requestController = new AbortController();
    controller.current = requestController;
    const currentGeneration = ++generation.current;
    setLoading(true); setError("");
    try {
      const session = await apiRequest<{ user: { mustChangePassword: boolean } | null; serverTime?: string }>("/api/auth/session", { signal: requestController.signal });
      calibrate(session.serverTime);
      if (!session.user) { router.replace("/login"); return; }
      if (session.user.mustChangePassword) { router.replace("/account?section=security"); return; }
      const serverWeek = getCurrentWeekKey(session.serverTime ? new Date(session.serverTime) : new Date());
      const requestedOffset = requestedWeek && /^\d{4}-\d{2}-\d{2}$/.test(requestedWeek)
        ? getWeekOffset(serverWeek, requestedWeek)
        : Number.NaN;
      const requestedIsValid = Number.isInteger(requestedOffset) && requestedOffset >= -8 && requestedOffset <= 4
        && shiftWeekKey(serverWeek, requestedOffset) === requestedWeek;
      const selectedWeek = requestedIsValid ? requestedWeek! : serverWeek;
      setFollowsCurrentWeek(selectedWeek === serverWeek);
      setWeek(selectedWeek);
      const result = await apiRequest<UserWeek>(`/api/users/${encodeURIComponent(id)}?week=${encodeURIComponent(selectedWeek)}`, { signal: requestController.signal });
      if (currentGeneration !== generation.current) return;
      setData(result);
    } catch (cause) {
      if (requestController.signal.aborted || currentGeneration !== generation.current) return;
      if (cause instanceof ApiError && cause.status === 401) router.replace("/login");
      else setError(cause instanceof ApiError && cause.status === 404 ? "找不到这位用户，或此账号目前不可见。" : cause instanceof ApiError ? cause.message : "服务暂时不可用，请稍后重试。");
      setData(null);
    } finally { if (currentGeneration === generation.current) setLoading(false); }
  }, [calibrate, id, router]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const requested = new URLSearchParams(window.location.search).get("week");
      void load(requested ?? undefined);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [id, load]);

  useEffect(() => () => controller.current?.abort(), []);

  useEffect(() => {
    if (!clockReady || !data) return;
    let targetWeek: string | null = null;
    if (followsCurrentWeek && week !== currentWeek) targetWeek = currentWeek;
    if (!followsCurrentWeek) {
      const offsetFromCurrent = getWeekOffset(currentWeek, week);
      if (offsetFromCurrent < -8) targetWeek = shiftWeekKey(currentWeek, -8);
      if (offsetFromCurrent > 4) targetWeek = shiftWeekKey(currentWeek, 4);
    }
    if (targetWeek) {
      const timer = window.setTimeout(() => void load(targetWeek!), 0);
      return () => window.clearTimeout(timer);
    }
  }, [clockReady, currentWeek, data, followsCurrentWeek, load, week]);

  async function changeWeek(next: string) { setWeek(next); await load(next); }

  return <main className="mx-auto max-w-3xl px-3 py-5 sm:px-6 sm:py-8">
    <header className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"><div className="flex min-w-0 items-center gap-4"><Link href="/schedule" aria-label="返回登记表" className="text-sm font-semibold text-blue-800">← 返回</Link><div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full bg-slate-100">{data ? <UserAvatar userId={data.user.id} version={data.user.avatar_version} name={data.user.display_name} size={64} /> : <Image src="/default-avatar.png" alt="默认头像" width={64} height={64} unoptimized />}</div><div className="min-w-0"><h1 className="break-words text-xl font-bold">{data?.user.display_name || "牌友"}</h1><p className="mt-1 text-sm text-slate-500">公开资料仅显示昵称、头像与预约。</p></div></div></header>
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b p-4"><div><h2 className="font-bold">所选周预约</h2><p className="text-sm text-slate-500">{week} 至 {shiftDayKey(week, 6)} · 登录用户可见</p></div><div className="flex gap-2"><button type="button" disabled={offset <= -8 || loading} onClick={() => void changeWeek(shiftWeekKey(week, -1))} className="min-h-11 rounded-lg border px-3 text-sm disabled:opacity-40">上一周</button><button type="button" disabled={offset >= 4 || loading} onClick={() => void changeWeek(shiftWeekKey(week, 1))} className="min-h-11 rounded-lg border px-3 text-sm disabled:opacity-40">下一周</button></div></div>
      {error && <p role="alert" className="p-5 text-sm text-rose-800">{error}</p>}{loading ? <p className="p-8 text-center text-slate-500">正在加载…</p> : !error && <div className="divide-y divide-slate-100">{data?.items.map((item) => <article key={item.id} className="flex min-w-0 gap-3 p-4"><UserAvatar userId={data.user.id} version={data.user.avatar_version} name={data.user.display_name} size={42} /><div className="min-w-0"><h3 className="break-words font-semibold">{DAY_LABELS[item.day_index]} {formatWeekDay(week, item.day_index)} · {SCHEDULE_SLOTS[item.slot_index]?.label}</h3><p className="mt-1 break-words text-sm text-slate-600">登记昵称：{item.nickname} · 场地：{item.location || "皆可"}</p>{item.note && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700">备注：{item.note}</p>}</div></article>)}{data?.items.length === 0 && <p className="p-8 text-center text-slate-500">这一周没有预约。</p>}</div>}
    </section>
  </main>;
}
