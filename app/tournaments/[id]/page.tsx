"use client";
import { use, useEffect, useState, type FormEvent } from "react";
import { postJson } from "@/lib/api";
import { standings, type Match, type Result, type Source } from "@/lib/tournaments/engine";
import { displayEventTime, localEventTime } from "@/lib/tournaments/dates";
import { formatNames, statusNames, type Tournament, type TournamentDetail } from "@/lib/tournaments/types";
import { FormatRules, TournamentHeader, buttonClass, secondaryClass, inputClass, errorMessage, useTournamentData } from "@/components/tournaments/shared";
import { ThreeGodsManager } from "@/components/tournaments/three-gods-manager";
import { LateRegistration } from "@/components/tournaments/late-registration";

const resultNames: Record<Result, string> = { a_win: "A 胜", b_win: "B 胜", draw: "平局", double_loss: "双方判负", bye: "轮空晋级", void: "空签 / 双方退赛" };
const bracketNames = { swiss: "瑞士轮", cut: "晋级单败淘汰赛", winners: "胜者组", losers: "败者组", final: "总决赛 · 单场无 reset" };
function RegistrationManagement({ tournament, eventDay, busy, act }: { tournament: Tournament; eventDay: boolean; busy: boolean; act: (value: Record<string, unknown>, saved?: () => void) => Promise<void> }) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tournament.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(tournament.registration_deadline));
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  const [deadline, setDeadline] = useState(`${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`);
  const [name, setName] = useState(""); const [checkedIn, setCheckedIn] = useState(false); const [error, setError] = useState("");
  async function saveDeadline(event: FormEvent) {
    event.preventDefault(); setError("");
    try {
      const registration_deadline = localEventTime(deadline, tournament.timezone);
      if (Date.parse(registration_deadline) > Date.parse(tournament.starts_at)) throw new Error("预报名截止不能晚于开赛时间。");
      await act({ action: "edit_registration", registration_deadline });
    } catch (reason) { setError(errorMessage(reason)); }
  }
  return <div className="space-y-5">
    {error && <p role="alert" className="text-sm text-rose-900">{error}</p>}
    <form onSubmit={event => void saveDeadline(event)} className="space-y-2">
      <h3 className="font-semibold">修改预报名时间</h3>
      <label className="block max-w-md text-sm">修改预报名截止时间<input type="datetime-local" required value={deadline} onChange={event => setDeadline(event.target.value)} disabled={busy} className={inputClass} /></label>
      <p className="text-sm text-slate-600">按 {tournament.timezone} 时间保存，不能晚于开赛时间。设为过去可立即截止，设为未来可重新开放；已有报名保留。</p>
      <button disabled={busy} className={secondaryClass}>保存预报名时间</button>
    </form>
    {tournament.status === "published" && <form className="space-y-3 border-t border-blue-200 pt-4" onSubmit={event => { event.preventDefault(); void act({ action: "onsite", name, checkedIn }, () => { setName(""); setCheckedIn(false); }); }}>
      <h3 className="font-semibold">现场补录</h3>
      <p className="text-sm text-slate-600">仅在赛事当地日期当天、锁定选手池前补录，无需创建账号。昵称将公开显示；同名已有报名请在名单中确认报到。</p>
      <label className="block max-w-md text-sm">现场选手昵称<input required maxLength={30} value={name} onChange={event => setName(event.target.value)} disabled={busy || !eventDay} className={inputClass} /></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={checkedIn} onChange={event => setCheckedIn(event.target.checked)} disabled={busy || !eventDay} className="mt-1" />已核对本人到场，直接确认报到</label>
      <p className="text-sm text-slate-600">{checkedIn ? "保存为已报到，开赛时加入选手池。" : "保存为仅报名，仍需确认报到才可进入选手池。"}</p>
      {!eventDay && <p className="text-sm text-amber-900">现场补录将在赛事当地日期当天开放。</p>}
      <button disabled={busy || !eventDay || tournament.entry_count >= tournament.capacity} className={secondaryClass}>补录现场选手</button>
      {tournament.entry_count >= tournament.capacity && <p className="text-sm text-amber-900">报名人数已达上限。</p>}
    </form>}
  </div>;
}
function sourceName(source: Source): string { return source && "match" in source ? `${source.match} ${source.take === "winner" ? "胜者" : "败者"}` : "空签"; }
function MatchCard({ match, name, canManage, busy, act }: { match: Match; name: (id: string | null) => string; canManage: boolean; busy: boolean; act: (value: Record<string, unknown>) => Promise<void> }) {
  const [result, setResult] = useState(match.result ?? "a_win"); const [reason, setReason] = useState("");
  return <article className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
    <p className="mb-2 text-xs font-semibold text-slate-500">{match.id} · {match.bracket === "swiss" ? `第 ${match.table} 桌` : `第 ${match.table} 场`}</p>
    <p className={`break-words text-sm ${match.winnerId && match.winnerId === match.aId ? "font-bold text-blue-900" : ""}`}>A · {match.aId ? name(match.aId) : sourceName(match.a)}</p>
    <p className={`mt-1 break-words text-sm ${match.winnerId && match.winnerId === match.bId ? "font-bold text-blue-900" : ""}`}>B · {match.bId ? name(match.bId) : sourceName(match.b)}</p>
    <p className="mt-2 text-xs font-medium text-slate-600">{match.result ? resultNames[match.result] : match.aId && match.bId ? "等待结果" : "等待上游对局"}{match.automatic && match.aId && match.bId ? " · 退赛自动处理" : ""}</p>
    {canManage && match.aId && match.bId && !match.automatic && <form className="mt-3 space-y-2" onSubmit={event => { event.preventDefault(); void act({ action: "result", matchId: match.id, result, reason }); }}>
      <label className="block text-xs">确认 {match.id} 结果<select value={result} onChange={event => setResult(event.target.value as Result)} className={inputClass} disabled={busy}>
        <option value="a_win">A 胜</option><option value="b_win">B 胜</option>{match.bracket === "swiss" && <><option value="draw">平局</option><option value="double_loss">双方判负</option></>}
      </select></label>
      <label className="block text-xs">{match.result ? "更正原因（公开，至少 4 字）" : "结果说明（选填，公开）"}<input value={reason} onChange={event => setReason(event.target.value)} required={Boolean(match.result)} minLength={match.result ? 4 : undefined} maxLength={300} className={inputClass} disabled={busy} /></label>
      <button disabled={busy} className={secondaryClass}>{match.result ? "更正结果" : "确认结果"}</button>
    </form>}
  </article>;
}

export default function TournamentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error: loadError, reload } = useTournamentData<TournamentDetail>(`/api/tournaments/${id}`);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 10_000); return () => window.clearInterval(timer); }, []);
  const [name, setName] = useState(""); const [cutOrder, setCutOrder] = useState(""); const [cutReason, setCutReason] = useState("");
  const [dropId, setDropId] = useState(""); const [dropReason, setDropReason] = useState(""); const [cancelReason, setCancelReason] = useState(""); const [startConfirmed, setStartConfirmed] = useState(false);
  const [manualPairs, setManualPairs] = useState(""); const [manualReason, setManualReason] = useState(""); const [allowRematches, setAllowRematches] = useState(false); const [allowRepeatBye, setAllowRepeatBye] = useState(false);
  async function act(value: Record<string, unknown>, saved?: () => void) {
    if (!data || busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await postJson(`/api/tournaments/${id}`, { revision: data.tournament.revision, ...value }); saved?.(); if (["onsite", "checkin", "join", "leave"].includes(String(value.action))) setStartConfirmed(false); reload(); setNotice("操作已保存，正在刷新赛事。 "); }
    catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  }
  async function cut(event: FormEvent) {
    event.preventDefault(); if (!data?.tournament.state) return;
    try {
      const ids = cutOrder.trim() ? cutOrder.trim().split(/[，,\s]+/).map(value => {
        const entrant = data.tournament.state!.entrants.find(row => row.seed === Number(value));
        if (!entrant) throw new Error("晋级顺序包含无效的初始种子序号。"); return entrant.id;
      }) : undefined;
      await act({ action: "cut", orderedIds: ids, reason: cutReason });
    } catch (reason) { setError(errorMessage(reason)); }
  }
  async function recoverSwiss(event: FormEvent) {
    event.preventDefault(); if (!data?.tournament.state) return;
    try {
      const entrant = (seed: string) => { const row = data.tournament.state!.entrants.find(row => row.seed === Number(seed)); if (!row) throw new Error("人工配对包含无效初始种子序号。"); return row.id; };
      const pairs = manualPairs.trim().split(/[，,\s]+/).map(text => { const parts = text.split(/(?:-|:|：)/); if (parts.length !== 2) throw new Error("配对格式示例：1-4, 2-3, 5-bye。"); return { a: entrant(parts[0]), b: /^(bye|轮空)$/i.test(parts[1]) ? null : entrant(parts[1]) }; });
      await act({ action: "manual_swiss", pairs, reason: manualReason, allowRematches, allowRepeatBye });
    } catch (reason) { setError(errorMessage(reason)); }
  }
  if (!data) return <main className="mx-auto max-w-5xl px-3 py-6"><TournamentHeader title="赛事详情" />{loadError ? <p role="alert">{loadError} <button onClick={reload} className={secondaryClass}>重试</button></p> : <p role="status">正在加载赛事…</p>}</main>;
  const t = data.tournament; const state = t.state; const mine = data.entrants.find(entry => entry.id === data.mine);
  const rows = state ? standings(state) : [];
  const entrantName = (entryId: string | null) => { const entrant = state?.entrants.find(row => row.id === entryId); return entrant ? `#${entrant.seed} ${entrant.name}${entrant.active ? "" : "（退赛）"}` : "待定"; };
  const eventDay = new Intl.DateTimeFormat("en-CA", { timeZone: t.timezone }).format(new Date(t.starts_at)) === new Intl.DateTimeFormat("en-CA", { timeZone: t.timezone }).format(new Date(now));
  const registrationOpen = t.status === "published" && now < Date.parse(t.registration_deadline);
  return <main className="mx-auto max-w-6xl px-3 py-6 sm:px-6"><TournamentHeader title={t.title} />
    {(error || loadError) && <p role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-900">{error || loadError} <button onClick={reload} className="underline">刷新赛事</button></p>}
    {notice && <p role="status" className="mb-4 rounded-lg bg-emerald-50 p-3 text-emerald-900">{notice}</p>}
    <section className="mb-5 space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap gap-2 text-sm"><span className="rounded-full bg-violet-100 px-3 py-1 text-violet-900">赛事 · {formatNames[t.format]}</span><span className="rounded-full bg-slate-100 px-3 py-1">{t.status === "published" && !registrationOpen ? "报名截止 · 待开赛" : statusNames[t.status]}</span>{data.canManage && <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-900">你可管理此赛事</span>}</div>
      <p><time dateTime={t.starts_at}>{displayEventTime(t.starts_at, t.timezone)}</time> · {t.timezone}</p><p className="break-words">举办地点：{t.location}</p>
      <p className="text-sm text-slate-600">预报名截止：{displayEventTime(t.registration_deadline, t.timezone)}</p>
      <p className="font-semibold">预报名总数 {t.entry_count}/{t.capacity} · 已报到（未退赛）{t.checked_in_count}</p>
      {t.format === "swiss_cut" && <p className="text-sm">{t.swiss_rounds} 轮瑞士轮 → Top {t.top_cut} 单败淘汰</p>}
      {t.description && <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">{t.description}</p>}
    </section>
    <section className="mb-5 space-y-4 rounded-xl border border-slate-200 bg-white p-5"><h2 className="text-lg font-bold">公布规则{state && " · 已锁定"}</h2><FormatRules format={t.format} />
      <p className="text-sm leading-6"><strong>完全同分办法：</strong>{t.tie_break_policy}</p>{t.extra_rules && <p className="whitespace-pre-wrap break-words text-sm leading-6"><strong>补充规则：</strong>{t.extra_rules}</p>}
    </section>
    {t.status === "published" && <section className="mb-5 rounded-xl border border-slate-200 bg-white p-5"><h2 className="text-lg font-bold">预报名与报到</h2>
      <p className="my-3 text-sm leading-6 text-slate-600">预报名不会自动进入选手池。请在赛事当地日期当天到场，由发布者确认报到。未预报名者可由发布者现场补录；三幻神正赛开赛后可在允许阶段补录到后续匹配，其他赛制锁池后停止补录。已公布配对保持不变。</p>
      {mine && mine.status !== "withdrawn" ? <div className="flex flex-wrap items-center gap-3"><p className="font-medium">你已{mine.status === "checked_in" ? "完成正式报到" : "预报名，等待当天报到"}：{mine.name}</p><button disabled={busy} className={secondaryClass} onClick={() => void act({ action: "leave" })}>撤回本人报名</button></div>
        : registrationOpen ? <form className="space-y-3" onSubmit={event => { event.preventDefault(); void act({ action: "join", name }); }}>
          <label className="block max-w-md text-sm font-semibold">参赛显示昵称<input value={name} required maxLength={30} onChange={event => setName(event.target.value)} className={inputClass} disabled={busy} /></label>
          <label className="flex items-start gap-2 text-sm text-slate-600"><input required type="checkbox" className="mt-1" />我已阅读规则，并同意公开显示参赛昵称、对局和成绩；无需填写邮箱、手机号或学号。</label><button disabled={busy} className={buttonClass}>提交预报名</button>
        </form> : <p className="font-medium text-slate-600">预报名已截止。</p>}
    </section>}
    <section className="mb-5 rounded-xl border border-slate-200 bg-white p-5"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-bold">报名名单</h2><button disabled={busy} onClick={reload} className={secondaryClass}>刷新名单与结果</button></div>
      {!data.entrants.length && <p className="text-sm text-slate-500">暂无预报名。</p>}
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{data.entrants.map(entry => <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3 text-sm"><span className="min-w-0 break-words">{entry.name} <span className="text-xs text-slate-500">{entry.status === "checked_in" ? "已报到" : entry.status === "withdrawn" ? "已退赛 / 撤回" : "仅预报名"}</span></span>
        {data.canManage && t.status === "published" && entry.status === "preregistered" && <button disabled={busy || !eventDay} title={eventDay ? "核对本人到场后确认" : "只能在赛事当地日期当天确认"} onClick={() => void act({ action: "checkin", entryId: entry.id })} className={secondaryClass}>确认正式报到</button>}</li>)}</ul>
      {data.canManage && t.status === "published" && !eventDay && <p className="mt-3 text-sm text-amber-900">尚未到赛事当地日期，正式报到未开放。</p>}
    </section>
    {data.canManage && <section className="mb-5 space-y-4 rounded-xl border border-blue-200 bg-blue-50 p-5"><h2 className="text-lg font-bold">组织者操作</h2>
      {["draft", "published"].includes(t.status) && !state && !t.special_state && <RegistrationManagement key={`${t.id}:${t.registration_deadline}`} tournament={t} eventDay={eventDay} busy={busy} act={act} />}
      <LateRegistration detail={data} busy={busy} now={now} act={act} />
      {t.status === "draft" && <button disabled={busy} onClick={() => void act({ action: "publish" })} className={buttonClass}>发布并开放预报名</button>}
      {t.status === "published" && <div className="space-y-3"><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={startConfirmed} onChange={event => setStartConfirmed(event.target.checked)} className="mt-1" />我已核对现场名单。立即截止报名，仅将 {t.checked_in_count} 名已报到者加入选手池，锁定规则与初始种子。</label><button disabled={busy || !startConfirmed || t.checked_in_count < 2} className={buttonClass} onClick={() => void act({ action: "start" })}>{t.format === "three_gods" ? "截止报名并锁定三幻神选手池" : "截止报名并正式开赛"}</button><p className="text-xs text-slate-600">未报到者不会上场。{t.format === "three_gods" ? "锁定后核对初始神，再单独启动正赛计时与匹配。" : "人数不足所选轮数或晋级人数时，开赛会被拒绝。"}</p></div>}
      {state?.phase === "swiss" && <><button disabled={busy} onClick={() => void act({ action: "next_swiss" })} className={buttonClass}>{state.currentRound >= t.swiss_rounds ? "结束瑞士轮并核对晋级" : "确认本轮结束，生成下一轮"}</button>
      {state.currentRound < t.swiss_rounds && <details className="rounded-lg border border-amber-200 bg-white p-3"><summary className="cursor-pointer text-sm font-semibold">自动配对无解时：组织者人工恢复</summary><form onSubmit={event => void recoverSwiss(event)} className="mt-3 space-y-3"><p className="text-sm leading-6">只新增下一轮，每位在赛选手必须且只能出现一次，已公布轮次不变。若合法无重赛匹配已无解，可明确确认例外，并公开记录原因。</p><label className="block text-sm">按初始种子序号输入配对<input required value={manualPairs} onChange={event => setManualPairs(event.target.value)} className={inputClass} placeholder="1-4, 2-3, 5-6（轮空用 5-bye）" /></label><label className="block text-sm">人工恢复原因<input required minLength={4} maxLength={300} value={manualReason} onChange={event => setManualReason(event.target.value)} className={inputClass} /></label><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={allowRematches} onChange={event => setAllowRematches(event.target.checked)} className="mt-1" />我明确确认本次人工配对允许重赛，并将向参赛者公开原因。</label><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={allowRepeatBye} onChange={event => setAllowRepeatBye(event.target.checked)} className="mt-1" />如有需要，我明确确认重复轮空例外。</label><button disabled={busy} className={secondaryClass}>确认并公布人工恢复配对</button></form></details>}</>}
      {state?.phase === "cut_pending" && <form onSubmit={event => void cut(event)} className="space-y-3"><p className="text-sm leading-6">按总分 → OMW → OOMW 确认晋级。三项全同影响晋级或种子时，先按公布的办法处理，再填全部在赛选手的初始种子序号。</p>
        <label className="block text-sm font-semibold">处理后的完整顺序（可选，同分时必填）<input value={cutOrder} onChange={event => setCutOrder(event.target.value)} className={inputClass} placeholder={rows.filter(row => row.active).map(row => row.seed).join(", ")} /></label>
        <label className="block text-sm font-semibold">同分处理记录（公开）<textarea value={cutReason} onChange={event => setCutReason(event.target.value)} maxLength={300} className={inputClass} /></label><button disabled={busy} className={buttonClass}>确认晋级并锁定淘汰签表</button></form>}
      {state && state.phase !== "complete" && <form className="space-y-2 border-t border-blue-200 pt-4" onSubmit={event => { event.preventDefault(); void act({ action: "drop", entryId: dropId, reason: dropReason }); }}><h3 className="font-semibold">办理退赛</h3><label className="block text-sm">退赛选手<select required value={dropId} onChange={event => setDropId(event.target.value)} className={inputClass}><option value="">请选择</option>{state.entrants.filter(entry => entry.active).map(entry => <option key={entry.id} value={entry.id}>#{entry.seed} {entry.name}</option>)}</select></label><label className="block text-sm">退赛说明（公开，至少 4 字）<input required minLength={4} maxLength={300} value={dropReason} onChange={event => setDropReason(event.target.value)} className={inputClass} /></label><button disabled={busy} className={secondaryClass}>确认退赛</button></form>}
      {!(["completed", "cancelled"] as string[]).includes(t.status) && <details className="border-t border-blue-200 pt-3"><summary className="cursor-pointer text-sm font-semibold text-rose-900">取消这场赛事</summary><form className="mt-3 space-y-2" onSubmit={event => { event.preventDefault(); void act({ action: "cancel", reason: cancelReason }); }}><label className="block text-sm">取消原因<input required minLength={4} maxLength={300} value={cancelReason} onChange={event => setCancelReason(event.target.value)} className={inputClass} /></label><button disabled={busy} className={secondaryClass}>确认取消赛事</button></form></details>}
    </section>}
    {t.format === "three_gods" && t.special_state && <ThreeGodsManager state={t.special_state} canManage={data.canManage} busy={busy} now={now} act={act} />}
    {state && <>
      {state.phase === "complete" && <p role="status" className="mb-5 rounded-xl bg-emerald-50 p-5 text-lg font-bold text-emerald-950">{state.championId ? `冠军：${entrantName(state.championId)}` : "赛程结束，无可用冠军（剩余选手均退赛）。"}</p>}
      {t.format === "swiss_cut" && <section className="mb-5 rounded-xl border border-slate-200 bg-white p-5"><h2 className="mb-3 text-lg font-bold">瑞士轮积分与小分</h2><div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead><tr className="border-b"><th className="p-2">名次</th><th>选手</th><th>积分</th><th>胜/平/负/空</th><th>真实积分率</th><th>OMW</th><th>OOMW</th></tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-b border-slate-100"><td className="p-2">{row.rank}</td><td className="max-w-48 break-words">{entrantName(row.id)}</td><td className="font-bold">{row.points}</td><td>{row.wins}/{row.draws}/{row.losses}/{row.byes}</td><td>{row.played ? `${(row.rate * 100).toFixed(2)}%` : "—"}</td><td>{row.opponents.length ? `${(row.omw * 100).toFixed(2)}%` : "—"}</td><td>{row.opponents.length ? `${(row.oomw * 100).toFixed(2)}%` : "—"}</td></tr>)}</tbody></table></div><p className="mt-3 text-xs text-slate-500">显示保留两位小数，排序使用完整精度。同名次的展示顺序不决定晋级。</p></section>}
      {(Object.keys(bracketNames) as Match["bracket"][]).filter(bracket => state.matches.some(match => match.bracket === bracket)).map(bracket => <section key={bracket} className="mb-5 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-5"><h2 className="mb-4 text-lg font-bold">{bracketNames[bracket]}</h2><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:overflow-x-auto">{[...new Set(state.matches.filter(match => match.bracket === bracket).map(match => match.round))].map(round => <div key={round} className="min-w-0 flex-1 lg:min-w-64"><h3 className="mb-2 text-sm font-semibold text-slate-600">第 {round} 轮</h3><div className="space-y-3">{state.matches.filter(match => match.bracket === bracket && match.round === round).map(match => <MatchCard key={`${match.id}:${match.result}`} match={match} name={entrantName} canManage={data.canManage && t.status !== "cancelled" && (bracket !== "swiss" || state.phase === "swiss" && round === state.currentRound)} busy={busy} act={act} />)}</div></div>)}</div></section>)}
      <section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="mb-3 font-bold">公开赛程记录</h2><ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-600">{state.history.map((entry, i) => <li key={i} className="break-words">{entry.detail}</li>)}</ol></section>
    </>}
  </main>;
}
