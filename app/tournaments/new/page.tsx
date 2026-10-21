"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { postJson } from "@/lib/api";
import { localEventTime, eventTimezones } from "@/lib/tournaments/dates";
import { titleLength, tournamentCreateSchema } from "@/lib/tournaments/validation";
import { FormatRules, TournamentHeader, buttonClass, inputClass, secondaryClass, errorMessage } from "@/components/tournaments/shared";

export default function NewTournamentPage() {
  const router = useRouter();
  const [title, setTitle] = useState(""); const [format, setFormat] = useState<"swiss_cut" | "pseudo_double" | "three_gods">("swiss_cut");
  const [timezone, setTimezone] = useState<string>("Asia/Shanghai"); const [capacity, setCapacity] = useState(16);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const form = new FormData(event.currentTarget); const value = (key: string) => String(form.get(key) ?? "");
    const status = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value === "draft" ? "draft" : "published";
    try {
      const result = tournamentCreateSchema.safeParse({ title, format, timezone, capacity, status,
        starts_at: localEventTime(value("starts_at"), timezone), registration_deadline: localEventTime(value("registration_deadline"), timezone),
        location: value("location"), description: value("description"), swiss_rounds: Number(value("swiss_rounds") || 3),
        top_cut: Number(value("top_cut") || 2), special_grouping: value("special_grouping") || "single", tie_break_policy: value("tie_break_policy"), extra_rules: value("extra_rules") });
      if (!result.success) { setError(result.error.issues.map(issue => issue.message).join(" ")); return; }
      setBusy(true); const saved = await postJson<{ id: string }>("/api/tournaments", result.data);
      router.push(`/tournaments/${saved.id}`);
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  }
  const titleCount = titleLength(title);
  return <main className="mx-auto max-w-4xl px-3 py-6 sm:px-6"><TournamentHeader title="发布赛事" />
    <p className="mb-5 text-sm leading-6 text-slate-600">正常登录即可创建。你将成为这场赛事的发布者，负责当天报到、开赛和结果确认。赛事会显示在约牌使用的同一日历中。</p>
    {error && <p role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-900">{error}</p>}
    <form onSubmit={submit} className="space-y-5">
      <fieldset disabled={busy} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5"><legend className="px-2 font-bold">赛事信息</legend>
        <label className="block text-sm font-semibold">赛事名称<input required value={title} onChange={event => setTitle(event.target.value)} aria-describedby="title-count" aria-invalid={titleCount > 25} className={inputClass} placeholder="例如：周六校园杯" /></label>
        <p id="title-count" aria-live="polite" className={`text-xs ${titleCount > 25 ? "text-rose-800" : "text-slate-500"}`}>{titleCount}/25 字 · 去除首尾空白后计数，组合表情按一个字计算</p>
        <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold">举办地点<input name="location" required maxLength={120} className={inputClass} placeholder="楼宇、教室或场馆" /></label><label className="text-sm font-semibold">人数上限<input type="number" name="capacity" required min={2} max={128} value={capacity} onChange={event => setCapacity(Number(event.target.value))} className={inputClass} /></label></div>
        <label className="block text-sm font-semibold">赛事时区<select value={timezone} onChange={event => setTimezone(event.target.value)} className={inputClass}>{eventTimezones.map(zone => <option key={zone}>{zone}</option>)}</select></label>
        <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold">举办日期与时间<input name="starts_at" type="datetime-local" required className={inputClass} /></label><label className="text-sm font-semibold">预报名截止<input name="registration_deadline" type="datetime-local" required className={inputClass} /></label></div>
        <p className="text-xs leading-5 text-slate-500">以上时间均按所选赛事时区。日历统一以 Asia/Shanghai 展示；现场报到只在赛事当地日期当天由发布者确认，预报名不等于已入选手池。</p>
        <label className="block text-sm font-semibold">赛事简介（选填）<textarea name="description" maxLength={2000} rows={2} className={inputClass} /></label>
      </fieldset>
      <fieldset disabled={busy} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5"><legend className="px-2 font-bold">选择赛制</legend>
        <div className="grid gap-3 sm:grid-cols-2">{([["swiss_cut", "传统瑞士轮 + 淘汰赛", "先打 3–7 轮瑞士轮，再按积分和小分晋级单败淘汰。"], ["pseudo_double", "胜败组伪双败", "胜者组、败者组；总决赛一场，无 reset。"], ["three_gods", "三幻神争夺", "BO3、生命机会、三幻神库存、一次复活与名次管理。"]] as const).map(([key, name, text]) => <label key={key} className={`cursor-pointer rounded-lg border p-4 ${format === key ? "border-blue-700 bg-blue-50" : "border-slate-200"}`}><span className="flex items-center gap-2 font-semibold"><input type="radio" name="format" checked={format === key} onChange={() => setFormat(key)} />{name}</span><span className="mt-2 block text-sm leading-6 text-slate-600">{text}</span></label>)}</div>
        {format === "swiss_cut" && <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold">瑞士轮轮数<select name="swiss_rounds" defaultValue={3} className={inputClass}>{[3, 4, 5, 6, 7].map(n => <option key={n} value={n}>{n} 轮</option>)}</select></label><label className="text-sm font-semibold">晋级人数<select name="top_cut" defaultValue={4} className={inputClass}>{[2, 4, 8, 16, 32, 64].map(n => <option key={n} disabled={n > capacity} value={n}>Top {n}</option>)}</select></label></div>}
        {format === "three_gods" && <label className="block text-sm font-semibold">三幻神分组模式<select name="special_grouping" defaultValue="single" className={inputClass}><option value="single">不分组 · 全场决出冠亚季</option><option value="ab">A/B 分组 · 组冠争冠亚、组亚争季军</option></select></label>}
        <FormatRules format={format} />
        <label className="block text-sm font-semibold">完全同分时的公开处理办法<textarea key={format} name="tie_break_policy" required minLength={4} maxLength={300} rows={2} className={inputClass} defaultValue={format === "three_gods" ? "需要确定名次的并列第一追加 BO1；未分胜负保持待裁判，不按账号或提交先后自动选人。" : "总分、OMW、OOMW 全同，由组织者现场公开抽签决定晋级和种子顺序，并公开记录。"} /></label>
        <label className="block text-sm font-semibold">补充规则（选填，不改变上方积分或签表逻辑）<textarea name="extra_rules" maxLength={3000} rows={3} className={inputClass} placeholder="例如对局时限、场地要求、奖品安排。请勿填写邮箱、手机号等私人资料。" /></label>
        <p className="text-sm text-slate-600"><Link href="/tournaments/special" className="text-blue-800 underline">查看三幻神完整规则与裁判流程</Link>。自定义规则面板另行设计，补充文字不会静默改写自动计分。</p>
      </fieldset>
      <div className="flex flex-wrap gap-3"><button name="status" value="published" disabled={busy || titleCount < 1 || titleCount > 25} className={buttonClass}>{busy ? "正在保存…" : "发布并开放预报名"}</button><button name="status" value="draft" disabled={busy || titleCount < 1 || titleCount > 25} className={secondaryClass}>保存草稿</button></div>
    </form></main>;
}
