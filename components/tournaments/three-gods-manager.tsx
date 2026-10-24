"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { canBeginRevival, cardCount, correctionImpact, godNames, hasOpportunity, playerStatusNames, remainingMainMatches, revivalGate, revivalMetric, revivalPlacementIssue, threeGodsPending,
  type God, type GodGroup, type GodMatch, type GodOutcome, type GodPlayer, type ThreeGodsCommand, type ThreeGodsState } from "@/lib/tournaments/three-gods";
import { displayEventTime } from "@/lib/tournaments/dates";
import { buttonClass, inputClass, secondaryClass } from "./shared";

type Send = (command: ThreeGodsCommand) => Promise<void>;
const groupName = (group: GodGroup) => group === "all" ? "不分组" : `${group} 组`;
const matchKind = { main: "正赛", revival: "复活赛", tiebreak: "BO1 判并列", championship: "冠亚军赛", third_place: "季军赛" };
const outcomes: Record<GodOutcome, string> = { a_win: "A 胜", b_win: "B 胜", draw: "平局（本场各 1 分）", double_loss: "双方判负（本场各 0 分）" };
const publicNote = "现场核对并确认记录";

function InitialPlayer({ p, grouping, busy, send }: { p: GodPlayer; grouping: "ab" | "single"; busy: boolean; send: Send }) {
  return <form aria-label={`初始神确认 ${p.name}`} className="grid gap-2 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={event => {
    event.preventDefault(); const form = new FormData(event.currentTarget); const value = String(form.get("god"));
    void send({ kind: "initial", playerId: p.id, group: grouping === "single" ? "all" : form.get("group") as "A" | "B", initialGod: value === "none" ? null : value as God, note: "现场核对初始幻神发放" });
  }}><p className="self-center break-words text-sm font-semibold sm:col-span-3">{p.name}</p>
    <label className="text-xs">初始幻神<select required name="god" defaultValue="" className={inputClass}><option value="" disabled>请选择发放情况</option><option value="none">初始无卡 · 一次额外机会</option>{Object.entries(godNames).map(([key, label]) => <option key={key} value={key}>{label} ×1</option>)}</select></label>
    {grouping === "ab" && <label className="text-xs">现场分组<select name="group" defaultValue={p.group} className={inputClass}><option value="A">A 组</option><option value="B">B 组</option></select></label>}
    <button disabled={busy} className={`${secondaryClass} self-end`}>确认并锁定初始类别</button>
  </form>;
}
function PlayerManagement({ p, players, busy, send }: { p: GodPlayer; players: GodPlayer[]; busy: boolean; send: Send }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget), value = (name: string) => String(f.get(name) ?? "");
    const action = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement)?.value;
    const common = { playerId: p.id, note: value("note") };
    if (action === "add" || action === "remove") void send({ ...common, kind: "inventory", god: value("god") as God, amount: Number(value("amount")), operation: action });
    if (action === "transfer") void send({ kind: "transfer", fromId: p.id, toId: value("target"), god: value("god") as God, amount: Number(value("amount")), note: value("note") });
    if (action === "score") void send({ ...common, kind: "score", delta: Number(value("delta")) });
    if (action === "status") void send({ ...common, kind: "status", status: value("status") as "waiting" | "completed" | "ruling_pending" | "withdrawn" });
    if (action === "life_on" || action === "life_off") void send({ ...common, kind: "life", extraLife: action === "life_on" });
    if (action === "arrangement") void send({ ...common, kind: "arrangement" });
    if (action === "candidate_yes" || action === "candidate_no") void send({ ...common, kind: "candidate_ruling", eligible: action === "candidate_yes" });
  }
  return <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3"><summary className="cursor-pointer text-sm font-semibold">库存、状态与裁判调整</summary>
    <form onSubmit={submit} className="mt-3 space-y-3"><fieldset disabled={busy} className="space-y-3">
      <label className="block text-xs font-semibold">公开操作原因（至少 4 字）<input name="note" required minLength={4} maxLength={300} className={inputClass} placeholder="记录现场库存核对或裁判裁定原因" /></label>
      <div className="grid grid-cols-2 gap-2"><label className="text-xs">幻神类别<select name="god" className={inputClass}>{Object.entries(godNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="text-xs">张数<input name="amount" type="number" min={1} max={99} defaultValue={1} className={inputClass} /></label></div>
      <div className="flex flex-wrap gap-2"><button value="add" className={secondaryClass}>录入库存</button><button value="remove" className={secondaryClass}>移除库存</button></div>
      <p className="text-xs leading-5 text-slate-500">移除只记入库存流水，不删除选手、初始类别或原始对局。正赛中首次零牌会按规则获得一次额外机会。</p>
      <label className="block text-xs">转移给同组选手<select name="target" className={inputClass}><option value="">请选择</option>{players.filter(other => other.id !== p.id && other.group === p.group).map(other => <option key={other.id} value={other.id}>{other.name}</option>)}</select></label><button value="transfer" className={secondaryClass}>登记手动库存转移</button>
      <div className="border-t border-slate-200 pt-3"><label className="block text-xs">正赛积分调整（可负数）<input name="delta" type="number" min={-1000} max={1000} defaultValue={0} className={inputClass} /></label><button value="score" className={`${secondaryClass} mt-2`}>记录积分纠错</button></div>
      <label className="block text-xs">对局状态<select name="status" className={inputClass}><option value="waiting">恢复等待（资格仍由库存/机会计算）</option><option value="completed">标记已完成 / 解除暂停</option><option value="ruling_pending">暂停，等待裁判</option><option value="withdrawn">正式退赛</option></select></label><button value="status" className={secondaryClass}>确认状态登记</button>
      <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-3"><button value="life_on" className={secondaryClass}>裁判确认额外机会可用</button><button value="life_off" className={secondaryClass}>裁判确认额外机会已耗尽</button></div>
      <div className="flex flex-wrap gap-2"><button value="candidate_yes" className={secondaryClass}>裁判确认集齐候选资格</button><button value="candidate_no" className={secondaryClass}>撤销错误候选认定</button></div>
      <p className="text-xs leading-5 text-slate-500">迟录结果或库存纠错影响集齐时点时，裁判须公开说明实际情况；名次确认后不能静默改变候选。</p>
      {p.initialAssigned && p.initialGod === null && p.initialArrangements < 3 && <button value="arrangement" className={secondaryClass}>登记第 {p.initialArrangements + 1} 次未参赛等待安排</button>}
      <p className="text-xs leading-5 text-slate-500">等待安排不增加实际参赛轮数或比赛积分；有在打对局时不能登记。人工机会调整保留公开裁判原因。</p>
    </fieldset></form>
  </details>;
}
function GodMatchCard({ m, state, canManage, busy, now, send }: { m: GodMatch; state: ThreeGodsState; canManage: boolean; busy: boolean; now: number; send: Send }) {
  const [aWins, setAWins] = useState(m.gameWins.a), [bWins, setBWins] = useState(m.gameWins.b);
  const [outcome, setOutcome] = useState<GodOutcome>(m.result?.outcome ?? "a_win");
  const [note, setNote] = useState(publicNote);
  const name = (id: string) => state.players.find(p => p.id === id)?.name ?? "未知选手";
  const impact = m.result ? correctionImpact(state, m.id) : [];
  const expired = now >= Date.parse(m.deadlineAt) && m.status !== "completed";
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const action = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement)?.value;
    void send(action === "progress" ? { kind: "progress", matchId: m.id, aWins, bWins, note } : { kind: "result", matchId: m.id, outcome, aWins, bWins, note });
  }
  return <article data-testid={`god-match-${m.id}`} className={`rounded-xl border bg-white p-4 ${m.status === "ruling_pending" || expired ? "border-amber-300" : "border-slate-200"}`}>
    <p className="text-xs font-semibold text-violet-800">{matchKind[m.kind]} · {groupName(m.group)}{m.kind === "main" ? ` · 批次 ${m.batch}` : ""} · BO{m.bestOf}</p>
    <div className="my-3 space-y-1 text-sm"><p className="break-words font-semibold">A · {name(m.aId)} <span className="font-normal text-slate-500">个人第 {m.aParticipation} 场</span></p><p className="break-words font-semibold">B · {name(m.bId)} <span className="font-normal text-slate-500">个人第 {m.bParticipation} 场</span></p></div>
    <p className="text-sm">{m.result ? `${outcomes[m.result.outcome]} · 小局 ${m.result.aWins}:${m.result.bWins}` : `对局中 · 已登记小局 ${m.gameWins.a}:${m.gameWins.b}`}</p>
    <p className="mt-1 text-xs text-slate-500">本场时限：{displayEventTime(m.deadlineAt)} · {m.bestOf === 1 ? 25 : 40} 分钟</p>
    {expired && <p className="mt-2 text-sm font-medium text-amber-950">已到时，请裁判按公布的 OCG 超时流程处理；时钟不会自动判胜。</p>}
    {m.status === "ruling_pending" && <p className="mt-2 text-sm font-semibold text-amber-950">仍未决胜，名次 / 复活资格保持待裁判，不自动选人。</p>}
    {m.result?.transfer && <p className="mt-2 text-xs text-violet-900">已原子转移：{name(m.result.transfer.from)} → {name(m.result.transfer.to)} · {godNames[m.result.transfer.god]} ×1</p>}
    {m.result && !m.result.transfer && <p className="mt-2 text-xs text-slate-500">本场无幻神转移。</p>}
    {canManage && state.phase !== "complete" && <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold text-blue-800">{m.result ? "查看更正影响 / 结果登记" : "登记小局与最终结果"}</summary>
      {impact.length > 0 && <p className="mt-2 text-xs leading-5 text-amber-950">更正将影响后续 {impact.length} 项记录或已公布配对，系统不会自动回滚。请先核对受影响记录；必要的记分与库存调整须另记原因。</p>}
      <form onSubmit={submit} className="mt-3 space-y-3"><fieldset disabled={busy} className="space-y-3"><div className="grid grid-cols-2 gap-2"><label className="text-xs">A 小局胜<input type="number" min={0} max={m.bestOf === 1 ? 1 : 2} value={aWins} onChange={event => setAWins(Number(event.target.value))} className={inputClass} /></label><label className="text-xs">B 小局胜<input type="number" min={0} max={m.bestOf === 1 ? 1 : 2} value={bWins} onChange={event => setBWins(Number(event.target.value))} className={inputClass} /></label></div>
        <label className="block text-xs">最终大局结果<select value={outcome} onChange={event => setOutcome(event.target.value as GodOutcome)} className={inputClass}>{Object.entries(outcomes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="block text-xs">登记 / 更正原因（公开）<input required minLength={4} maxLength={300} value={note} onChange={event => setNote(event.target.value)} className={inputClass} /></label>
        <div className="flex flex-wrap gap-2">{!m.result && <button value="progress" className={secondaryClass}>仅登记当前小局</button>}<button value="result" className={buttonClass}>{m.result ? "确认更正结果" : "确认最终结果与转神"}</button></div>
        <p className="text-xs leading-5 text-slate-500">小局暂存不重复入账；确认大局后一次性计分和随机转神。平局本场总分 1/1、双方判负 0/0，不另加小局分。</p>
      </fieldset></form>
    </details>}
  </article>;
}

export function ThreeGodsManager({ state: s, canManage: authorized, busy, now, act }: { state: ThreeGodsState; canManage: boolean; busy: boolean; now: number; act: (value: Record<string, unknown>) => Promise<void> }) {
  const canManage = authorized && s.phase !== "complete";
  const pending = useRef<{ fingerprint: string; id: string } | null>(null);
  const [selected, setSelected] = useState<Record<GodGroup, string[]>>({ all: [], A: [], B: [] });
  useEffect(() => { if (pending.current && s.commands[pending.current.id]) pending.current = null; }, [s]);
  const send: Send = async c => {
    const fingerprint = JSON.stringify(c);
    if (!pending.current || pending.current.fingerprint !== fingerprint) pending.current = { fingerprint, id: crypto.randomUUID() };
    await act({ action: "special", commandId: pending.current.id, command: c });
  };
  const getName = (id: string | undefined | null) => s.players.find(p => p.id === id)?.name ?? "待确认";
  const gate = revivalGate(s), groups: GodGroup[] = s.grouping === "single" ? ["all"] : ["A", "B"];
  const overallExpired = s.deadlineAt !== null && now >= Date.parse(s.deadlineAt);
  function resolve(event: FormEvent<HTMLFormElement>, group: GodGroup) {
    event.preventDefault(); const form = new FormData(event.currentTarget), note = String(form.get("note"));
    void send(group === "all" ? { kind: "resolve_single", candidateIds: selected.all, note } : { kind: "resolve_group", group, candidateIds: selected[group], note });
  }
  const remainingMatches = s.matches.filter(m => m.status !== "completed"), completed = s.matches.filter(m => m.status === "completed");
  return <div className="space-y-5" aria-label="三幻神赛事管理">
    <section className="space-y-3 rounded-xl border border-violet-200 bg-violet-50 p-5"><h2 className="text-xl font-bold">三幻神争夺 · {s.grouping === "single" ? "不分组" : "A/B 分组"}</h2>
      <p className="text-sm leading-6">持牌为生命；赢不消耗机会。第一次零牌获得一次额外机会，再以零牌落败则耗尽；初始无卡者开局的一次机会即额外机会。初始神类别独立保存，不随转移改变。</p>
      <p className="text-sm leading-6">本组全部对局结束并完成结果登记后才生成下一轮，优先配初始神不同者，只让空闲且有机会者入池。正赛奇数剩余者等待，不加分、不扣机会、不虚构参赛轮数。</p>
      {s.startsAt ? <p className="font-semibold">正赛启动：{displayEventTime(s.startsAt)} · 总时限：{displayEventTime(s.deadlineAt!)}（3.5 小时）{overallExpired && " · 已到时"}</p> : <p className="text-sm font-semibold">先核对初始卡，点击启动正赛后开始 3.5 小时计时。</p>}
      <p className="text-xs leading-5 text-slate-600">BO3 每场 40 分钟；名次赛已进入后允许超过总时限。<a href="https://www.yugioh-card.com/japan/event/regulation/duel/" target="_blank" rel="noreferrer" className="text-blue-800 underline">OCG 对局规定</a> · <a href="https://www.yugioh-card.com/japan/event/regulation/oneduel/" target="_blank" rel="noreferrer" className="text-blue-800 underline">BO1 25 分钟规定</a>。未决胜不从时钟或数据库提交先后自动判胜。</p>
    </section>
    {s.phase === "complete" && <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-5"><h2 className="text-lg font-bold">赛事名次已确认</h2><ol className="mt-3 space-y-2">{s.awards.map((id, i) => <li key={id} className="font-semibold">{["冠军", "亚军", "季军"][i]}：{getName(id)}</li>)}</ol></section>}
    {s.rulingMessages.length > 0 && <aside className="rounded-xl border border-amber-300 bg-amber-50 p-4" role="status"><h2 className="font-semibold">裁判提示与处理记录</h2><ul className="mt-2 list-disc space-y-1 break-words pl-5 text-sm">{[...new Set(s.rulingMessages)].map(message => <li key={message}>{message}</li>)}</ul></aside>}
    {s.grouping === "ab" && overallExpired && s.phase !== "complete" &&
      (s.candidates.some(c => s.players.find(p => p.id === c.playerId)?.group === "A") !== s.candidates.some(c => s.players.find(p => p.id === c.playerId)?.group === "B")) &&
      <aside role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-950">总时限已到，仅一组出现集齐候选 / 冠军。跨组名次衔接待裁判裁定，系统不会填补另一组冠军。</aside>}
    {s.phase === "setup" && canManage && <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5"><h2 className="text-lg font-bold">已报到选手的初始神确认</h2><p className="text-sm text-slate-600">当前选手池已锁定。无卡必须明确选择；A/B 模式在这里分组。确认后初始类别锁定，后续库存按流水调整。</p>
      {s.players.filter(p => !p.initialAssigned).map(p => <InitialPlayer key={p.id} p={p} grouping={s.grouping} busy={busy} send={send} />)}
      <button disabled={busy || s.players.some(p => !p.initialAssigned)} className={buttonClass} onClick={() => void send({ kind: "begin_main", note: "已核对全部初始神，启动正赛计时与随机配对" })}>启动正赛并随机匹配</button>
    </section>}
    <section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="mb-3 text-lg font-bold">选手池、积分与三种神库存</h2>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{s.players.map(p => <article key={p.id} data-testid={`god-player-${p.id}`} className="min-w-0 rounded-lg border border-slate-200 p-4"><h3 className="break-words font-bold">{p.name} <span className="text-xs font-normal text-slate-500">{groupName(p.group)}</span></h3>
        <p className="mt-1 text-xs text-slate-500">初始：{p.initialAssigned ? p.initialGod ? godNames[p.initialGod] : "无卡（额外机会开局）" : "尚未核对"}</p>
        <p className="mt-2 text-sm font-semibold">{playerStatusNames[p.status]} · 正赛 {p.points} 分 · 持牌 {cardCount(p)} · 额外机会 {p.extraLife ? "可用" : "已用 / 未触发"}</p>
        <p className="mt-1 text-xs text-slate-600">实际已打 {p.completedMatches} 场 / 已安排对局 {p.assignedMatches} 场（含复活与 BO1，批次另计）</p>
        {p.initialAssigned && p.initialGod === null && <p className="mt-1 text-xs text-slate-600">前三安排进度 {Math.min(3, p.initialArrangements)}/3 · 复活候选 {p.revivalEligible ? "已具备早期出局资格" : "尚未具备"}</p>}
        <div className="mt-2 flex flex-wrap gap-2 text-xs">{Object.entries(godNames).map(([key, label]) => <span key={key} className="rounded-md bg-violet-50 px-2 py-1 text-violet-900">{label} {p.stock[key as God]}</span>)}</div>
        <p className="mt-2 text-xs">匹配资格：{p.hold !== "none" ? "暂停 / 退赛" : hasOpportunity(p) ? "有机会（空闲时入池）" : "无机会"}</p>
        {canManage && p.initialAssigned && s.phase !== "complete" && <PlayerManagement p={p} players={s.players} busy={busy} send={send} />}
      </article>)}</div>
    </section>
    {s.phase !== "setup" && <section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="text-lg font-bold">匹配批次</h2><div className="mt-3 grid gap-3 sm:grid-cols-2">{groups.map(group => {
      const b = s.batchRecords.filter(b => b.group === group).at(-1), finished = b ? b.matchIds.filter(id => { const m = s.matches.find(m => m.id === id); return m?.status === "completed" && m.result; }).length * 2 : 0;
      const remaining = remainingMainMatches(s, group);
      return <div key={group} className="rounded-lg bg-slate-50 p-3 text-sm"><p className="font-semibold">{groupName(group)} · 批次 {b?.number ?? 0}{s.stoppedGroups.includes(group) && " · 已停止新配对"}</p><p className="mt-1">本批完成 {finished}/{b?.participantIds.length ?? 0} 位实际参赛者{b ? `（${Math.round(finished / b.participantIds.length * 100)}%）` : ""}</p>
        {remaining > 0 && <p role="status" className="mt-2 text-amber-900">本组尚有 {remaining} 场对局未结束并完成结果登记，全部登记后才生成下一轮。</p>}
        {canManage && !["complete", "finals", "placements"].includes(s.phase) && <button disabled={busy || s.stoppedGroups.includes(group) || remaining > 0} className={`${secondaryClass} mt-2`} onClick={() => void send({ kind: "pair", group, note: "裁判刷新匹配池与总时限，全部对局登记后生成下一批" })}>刷新资格并尝试下一批</button>}</div>;
    })}</div></section>}
    {s.phase !== "setup" && <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5"><h2 className="text-lg font-bold">全场一次复活赛</h2>
      <p className="text-sm leading-6">全部初始无卡者完成前三次安排后统一开启；已出局者等待，不强行派对。只纳入前三安排内耗尽机会的初始无卡者，随机打一轮 BO3；仅复活赛轮空记 1.5 分。按「复活赛分 + 正赛分 ×60%」选全场一人，综合分只用于排名，不改写正赛积分。</p>
      <p className="text-sm font-semibold">安排进度 {gate.completed}/{gate.total} · 当前已出局候选 {gate.eligibleIds.length} 人 · {s.revival.status === "idle" ? "尚未开始" : s.revival.status === "playing" ? "复活赛对局中" : s.revival.status === "tie_pending" ? "并列第一，等待 BO1" : `复活者：${getName(s.revival.winnerId)}`}</p>
      {canManage && s.revival.status === "idle" && ["main", "candidate_wait"].includes(s.phase) && <button disabled={busy || !canBeginRevival(s, now)} className={buttonClass} onClick={() => void send({ kind: "begin_revival", note: "全部初始无卡者已完成前三安排，开启全场一次复活赛" })}>随机匹配一轮复活赛</button>}
      {s.phase !== "complete" && revivalPlacementIssue(s) && <p role="status" className="text-sm text-amber-900">名次前置条件：{revivalPlacementIssue(s)}</p>}
      {s.revival.byeId && <p className="text-sm">本轮复活轮空：{getName(s.revival.byeId)}，复活分 1.5，不计真实对局或额外负场。</p>}
      {s.revival.eligibleIds.length > 0 && <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-left text-sm"><thead><tr className="border-b"><th className="p-2">候选</th><th>正赛分</th><th>复活分</th><th>综合分</th></tr></thead><tbody>{s.revival.eligibleIds.map(id => { const p = s.players.find(p => p.id === id)!; return <tr key={id} className="border-b border-slate-100"><td className="p-2">{p.name}</td><td>{p.points}</td><td>{p.revivalPoints}</td><td className="font-bold">{(revivalMetric(p) / 10).toFixed(1)}</td></tr>; })}</tbody></table></div>}
    </section>}
    {s.phase !== "setup" && s.phase !== "complete" && <section className="space-y-4 rounded-xl border border-amber-200 bg-amber-50 p-5"><h2 className="text-lg font-bold">冠军候选与名次管理</h2>
      <p className="text-sm leading-6">候选产生即停该组新配对，等在打对局结束。裁判勾选同一获胜窗口内候选并记录原因；不按数据库提交先后擅自决定。无分组按少个人实际轮数优先，再三异优先；另一候选为亚军，其余最高分为季军。仅一人集齐时，剩余积分前二为亚、季军。需要确定的并列第一追加 BO1。</p>
      {groups.map(group => <div key={group} className="rounded-lg border border-amber-200 bg-white p-4"><h3 className="font-semibold">{groupName(group)}{s.groupChampions[group] && ` · 组冠 ${getName(s.groupChampions[group])}`}{s.groupRunners[group] && ` · 组亚 ${getName(s.groupRunners[group])}`}</h3>
        {s.candidates.filter(c => s.players.find(p => p.id === c.playerId)?.group === group).map(c => <label key={c.playerId} className="mt-2 flex items-start gap-2 text-sm">{canManage && <input type="checkbox" className="mt-1" checked={selected[group].includes(c.playerId)} onChange={event => setSelected(values => ({ ...values, [group]: event.target.checked ? [...values[group], c.playerId] : values[group].filter(id => id !== c.playerId) }))} />}<span>{getName(c.playerId)} · {c.pattern} · 达成时个人实际 {c.rounds} 场</span></label>)}
        {!s.candidates.some(c => s.players.find(p => p.id === c.playerId)?.group === group) && <p className="mt-2 text-sm text-slate-600">尚无集齐候选。</p>}
        {canManage && !s.selectedCandidates[group] && <form onSubmit={event => resolve(event, group)} className="mt-3 space-y-2"><label className="block text-xs font-semibold">候选窗口 / 到时排名的裁判记录<input name="note" required minLength={4} maxLength={300} className={inputClass} placeholder="说明同一获胜窗口内的候选，或总时限届满" /></label><button disabled={busy || selected[group].length > 2 || group !== "all" && selected[group].length === 0} className={secondaryClass}>{group === "all" ? selected.all.length ? "确认候选窗口并结算名次" : "无人集齐，到时按积分排名" : `确认 ${group} 组冠军及积分亚军`}</button></form>}
      </div>)}
      {canManage && s.grouping === "ab" && <div className="flex flex-wrap gap-3"><button disabled={busy} className={buttonClass} onClick={() => void send({ kind: "begin_finals", note: "已确认两组冠亚军，进入冠亚军赛与季军赛" })}>开启冠亚军赛与季军赛</button><button disabled={busy || !overallExpired || s.candidates.length > 0} className={secondaryClass} onClick={() => void send({ kind: "resolve_timeout", note: "总时限届满，两组均无人集齐，按全场积分确定名次" })}>两组均无人集齐：到时按全场积分排名</button></div>}
      <ul className="list-disc space-y-1 pl-5 text-xs leading-5 text-amber-950">{threeGodsPending.map(message => <li key={message}>{message}</li>)}</ul>
    </section>}
    {s.ties.some(t => !t.winnerId) && <section className="space-y-3 rounded-xl border border-amber-300 bg-white p-5"><h2 className="text-lg font-bold">BO1 判并列</h2>{s.ties.filter(t => !t.winnerId).map(t => <div key={t.id} className="rounded-lg bg-amber-50 p-3"><p className="text-sm font-semibold">{t.purpose} · 尚余 {t.remaining.map(getName).join("、")}</p><p className="mt-1 text-xs text-slate-600">两人并列会自动生成 BO1；三人以上由裁判登记对阵，系统不按 ID 分配胜者。</p>
      {canManage && <form onSubmit={event => { event.preventDefault(); const f = new FormData(event.currentTarget); void send({ kind: "tie_pair", tieId: t.id, aId: String(f.get("a")), bId: String(f.get("b")), note: String(f.get("note")) }); }} className="mt-3 grid gap-2 sm:grid-cols-2"><label className="text-xs">BO1 选手 A<select required name="a" className={inputClass}>{t.remaining.map(id => <option key={id} value={id}>{getName(id)}</option>)}</select></label><label className="text-xs">BO1 选手 B<select required name="b" defaultValue={t.remaining[1]} className={inputClass}>{t.remaining.map(id => <option key={id} value={id}>{getName(id)}</option>)}</select></label><label className="text-xs sm:col-span-2">裁判对阵记录<input required name="note" minLength={4} maxLength={300} className={inputClass} /></label><button disabled={busy} className={secondaryClass}>登记裁判 BO1 对阵</button></form>}
    </div>)}</section>}
    <section className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-5"><h2 className="text-lg font-bold">正在进行 / 待裁判的对局（{remainingMatches.length}）</h2><div className="grid gap-3 md:grid-cols-2">{remainingMatches.map(m => <GodMatchCard key={`${m.id}:${m.result?.outcome}:${m.gameWins.a}:${m.gameWins.b}`} m={m} state={s} canManage={canManage} busy={busy} now={now} send={send} />)}</div>
      <details><summary className="cursor-pointer text-sm font-semibold">已完成对局（{completed.length}）</summary><div className="mt-3 grid gap-3 md:grid-cols-2">{[...completed].reverse().map(m => <GodMatchCard key={`${m.id}:${m.result?.outcome}`} m={m} state={s} canManage={canManage} busy={busy} now={now} send={send} />)}</div></details>
    </section>
    <section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="mb-3 font-bold">公开库存、对局与裁判流水</h2><details><summary className="cursor-pointer text-sm">查看 {s.events.length} 条不可静默覆盖的操作记录</summary><ol className="mt-3 list-decimal space-y-3 pl-5 text-xs leading-5">{[...s.events].reverse().map(event => <li key={event.id} className="break-words"><p>{displayEventTime(event.at)} · {event.note}</p><p className="text-slate-500">{event.kind} · {event.players.map(getName).join("、")}</p><details><summary className="cursor-pointer">查看变更事实</summary><pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2">{JSON.stringify(event.facts, null, 2)}</pre></details></li>)}</ol></details></section>
  </div>;
}
