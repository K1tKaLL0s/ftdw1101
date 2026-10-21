"use client";
import Link from "next/link";
import { useState } from "react";
import { TournamentHeader, buttonClass, secondaryClass, useTournamentData } from "@/components/tournaments/shared";
import { displayEventTime } from "@/lib/tournaments/dates";
import { formatNames, statusNames, type Tournament } from "@/lib/tournaments/types";

export default function TournamentsPage() {
  const [offset, setOffset] = useState(0);
  const { data, error, reload } = useTournamentData<{ items: Tournament[]; nextOffset: number | null }>(`/api/tournaments?offset=${offset}`);
  return <main className="mx-auto max-w-5xl px-3 py-6 sm:px-6"><TournamentHeader title="赛事列表" />
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-600">所有正常登录用户都可发布赛事。预报名后，请在当天完成现场报到。</p><Link href="/tournaments/new" className={buttonClass}>发布赛事</Link></div>
    {error && <p role="alert" className="mb-4 rounded-lg bg-rose-50 p-3 text-rose-900">{error} <button onClick={reload} className="underline">重试</button></p>}
    {!data && !error && <p role="status">正在加载赛事…</p>}
    {data && <><div className="grid gap-4 sm:grid-cols-2">{data.items.map(t => <article key={t.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-violet-100 px-2 py-1 text-violet-900">赛事 · {formatNames[t.format]}</span><span className="rounded-full bg-slate-100 px-2 py-1">{statusNames[t.status]}</span></div>
      <h2 className="break-words text-xl font-bold"><Link href={`/tournaments/${t.id}`} className="hover:text-blue-800 hover:underline">{t.title}</Link></h2>
      <p className="mt-3 text-sm">{displayEventTime(t.starts_at, t.timezone)} · {t.timezone}</p><p className="mt-1 break-words text-sm text-slate-600">{t.location}</p>
      <p className="mt-2 text-sm text-slate-600">预报名总数 {t.entry_count}/{t.capacity} · 已报到 {t.checked_in_count}</p><Link href={`/tournaments/${t.id}`} className="mt-4 inline-block text-sm font-semibold text-blue-800 underline">查看规则与报名</Link>
    </article>)}</div>{!data.items.length && <p className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500">暂无赛事，发布一场校赛吧。</p>}
    <div className="mt-5 flex gap-3">{offset > 0 && <button className={secondaryClass} onClick={() => setOffset(Math.max(0, offset - 50))}>上一页</button>}{data.nextOffset !== null && <button className={secondaryClass} onClick={() => setOffset(data.nextOffset!)}>下一页</button>}</div></>}
    <aside className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4"><h2 className="font-semibold">特殊赛制</h2><p className="mt-1 text-sm text-slate-600">等待补充具体规则，暂不接受报名或生成赛程。</p><Link href="/tournaments/special" className="mt-2 inline-block text-sm font-semibold text-blue-800 underline">查看特殊赛制入口</Link></aside>
  </main>;
}
