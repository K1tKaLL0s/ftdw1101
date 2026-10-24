"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ApiError, apiRequest } from "@/lib/api";
import { ruleLines } from "@/lib/tournaments/types";

export const inputClass = "mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500";
export const buttonClass = "inline-flex min-h-11 items-center justify-center rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50";
export const secondaryClass = "inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50";
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return [error.message, ...Object.values(error.fields ?? {}).flat()].join(" ");
  return error instanceof Error ? error.message : "加载失败，请重试。";
}
export function useTournamentData<T>(url: string) {
  const router = useRouter();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [generation, setGeneration] = useState(0);
  const reload = useCallback(() => setGeneration(value => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    apiRequest<T>(url, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) { setData(result); setError(""); } })
      .catch(reason => { if (!controller.signal.aborted) { if (reason instanceof ApiError && reason.status === 401) router.replace("/login"); if (reason instanceof ApiError && reason.code === "password_change_required") router.replace("/account"); setError(errorMessage(reason)); } });
    return () => controller.abort();
  }, [url, generation, router]);
  useEffect(() => { const timer = window.setInterval(reload, 30_000); return () => window.clearInterval(timer); }, [reload]);
  return { data, error, reload };
}
export function TournamentHeader({ title }: { title: string }) {
  return <header className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div><p className="text-sm font-medium text-blue-700">来牌 · 赛事</p><h1 className="mt-1 break-words text-2xl font-bold">{title}</h1></div>
    <nav aria-label="赛事导航" className="flex flex-wrap gap-2"><Link className={secondaryClass} href="/schedule">约牌与赛事日历</Link><Link className={secondaryClass} href="/tournaments">赛事列表</Link></nav>
  </header>;
}
export function FormatRules({ format }: { format: "swiss_cut" | "pseudo_double" | "three_gods" }) {
  if (format === "three_gods") return <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-slate-700">
    <li>BO3：胜小局 +1、胜大局 +2；2:0 为 4/0，2:1 为 4/1。平局本场最终各 1 分，双方判负本场最终各 0 分，不另加小局分。</li>
    <li>正赛败者随机转给胜者一张现有幻神；平局、双方判负均不转神。无卡落败不补发神给胜者。初始神类别与当前库存分别保存。</li>
    <li>每张幻神提供生命机会，赢不消耗；第一次零牌获得一次额外机会，再以零牌落败则耗尽。初始无卡者开局的一次机会就是额外机会。</li>
    <li>初始无卡者前三次安排内出局者，等所有初始无卡者完成前三次安排后统一随机打一轮 BO3；已出局者等待。仅复活赛轮空 1.5 分，按复活分 + 正赛分 ×60% 复活全场一人；并列第一追加 BO1。</li>
    <li>不分组：最先三同或三异为冠军；同时候选按少个人实际轮数、再三异优先，另一候选为亚军，其余最高分为季军。唯一候选时剩余积分前二为亚季。无人集齐到时按积分前三。</li>
    <li>A/B：组冠产生立即停止该组新匹配，等在打的比赛结束再按积分取组亚；两组冠军打冠亚军赛，两组亚军打季军赛。</li>
    <li>本组全部对局结束并完成结果登记后才生成下一轮，只给空闲且有机会者配对，优先初始神不同者。BO3 每场 40 分钟，总时限 3.5 小时含名次赛，进入名次赛后允许超时。BO1 按 OCG 25 分钟规定；未分胜负保持待裁判。</li>
  </ul>;
  return <div className="space-y-2 text-sm leading-6 text-slate-700">
    {format === "swiss_cut" ? <ul className="list-disc space-y-1 pl-5">{ruleLines.map(line => <li key={line}>{line}</li>)}</ul>
      : <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 font-medium text-amber-950">胜者组首败进入败者组，败者组再败淘汰。总决赛只有一场，不重置（无 reset）；胜者组冠军可能首次失利即获亚军。轮空不算败场。退赛由组织者确认，签表中的后续对局按弃权处理。</p>}
    <p>第一轮初始种子按报名顺序；只有赛事当天由发布者确认报到的选手才能开赛入池。开赛后新报到不会自动加入已发布配对。</p>
  </div>;
}
