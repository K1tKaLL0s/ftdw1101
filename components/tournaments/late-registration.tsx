"use client";
import { useState, type FormEvent } from "react";
import type { TournamentDetail } from "@/lib/tournaments/types";
import { godNames, type GodGroup } from "@/lib/tournaments/three-gods";
import { inputClass, secondaryClass } from "./shared";

type Act = (value: Record<string, unknown>, saved?: () => void) => Promise<void>;

function InitialFields({ groups, grouped }: { groups: GodGroup[]; grouped: boolean }) {
  return <div className="grid gap-3 sm:grid-cols-2">
    <label className="block text-sm">入池初始幻神<select required name="initialGod" defaultValue="" className={inputClass}>
      <option value="" disabled>请核对实际发放情况</option>
      <option value="none">初始无卡 · 一次额外机会</option>
      {Object.entries(godNames).map(([key, name]) => <option key={key} value={key}>{name} ×1</option>)}
    </select></label>
    {grouped && <label className="block text-sm">入池分组<select key={groups.join(":")} required name="group" defaultValue="" className={inputClass}>
      <option value="" disabled>请选择尚可匹配的组</option>
      {groups.map(group => <option key={group} value={group}>{group} 组</option>)}
    </select></label>}
  </div>;
}

function arrival(form: FormData, grouped: boolean) {
  const god = String(form.get("initialGod") ?? "none");
  return { initialGod: god === "none" ? null : god, group: grouped ? String(form.get("group")) : "all" };
}

export function LateRegistration({ detail, busy, now, act }: { detail: TournamentDetail; busy: boolean; now: number; act: Act }) {
  const [name, setName] = useState("");
  const [checkedIn, setCheckedIn] = useState(false);
  const t = detail.tournament;
  if (!detail.canManage || t.status !== "running") return null;
  const s = t.special_state;
  let closed = "";
  if (t.format !== "three_gods") closed = "当前赛制已生成固定配对，暂不支持开赛后补录。";
  else if (!s || !["setup", "main"].includes(s.phase)) closed = "已有冠军候选、正赛到时或进入名次处理，开赛后补录已关闭。";
  else if (s.revival.status !== "idle") closed = "全场复活赛已开启，不能再改变参赛及复活资格范围，开赛后补录已关闭。";
  else if (s.phase === "main" && (!s.deadlineAt || now >= Date.parse(s.deadlineAt))) closed = "正赛总时限已到，开赛后补录已关闭。";
  const eventDay = new Intl.DateTimeFormat("en-CA", { timeZone: t.timezone }).format(new Date(t.starts_at)) === new Intl.DateTimeFormat("en-CA", { timeZone: t.timezone }).format(new Date(now));
  if (!closed && !eventDay) closed = "开赛后补录仅在赛事当地日期当天开放。";
  const groups: GodGroup[] = (s?.grouping === "ab" ? ["A", "B"] as const : ["all"] as const).filter(group => !s?.stoppedGroups.includes(group) && s?.selectedCandidates[group] === undefined);
  if (!closed && !groups.length) closed = "各组均已停止新匹配，开赛后补录已关闭。";
  const grouped = s?.grouping === "ab";
  const full = t.entry_count >= t.capacity;
  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await act({ action: "late_onsite", name, checkedIn, ...(checkedIn ? arrival(form, grouped) : { initialGod: null, group: groups[0] }) }, () => { setName(""); setCheckedIn(false); });
  }
  return <div className="space-y-4 border-t border-blue-200 pt-4">
    <h3 className="font-semibold">开赛后补录</h3>
    {closed ? <p className="text-sm text-amber-900">{closed}</p> : <>
      <p className="text-sm leading-6 text-slate-600">仅追加到后续尚未生成的匹配，不改当前或已完成对局。确认报到时须核对初始幻神或无卡的一次额外机会；不补记过去轮数、积分或自动授予复活资格。</p>
      <form aria-label="开赛后补录选手" onSubmit={event => void add(event)}>
        <fieldset disabled={busy || full} className="space-y-3">
          <label className="block max-w-md text-sm">开赛后选手昵称<input required maxLength={30} value={name} onChange={event => setName(event.target.value)} className={inputClass} /></label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={checkedIn} onChange={event => setCheckedIn(event.target.checked)} className="mt-1" />已核对本人到场并加入后续匹配</label>
          {checkedIn && <InitialFields groups={groups} grouped={grouped} />}
          <p className="text-sm text-slate-600">{checkedIn ? "保存为已报到，等待下一次符合条件的匹配。" : "保存为仅报名，不进入选手池；到场后在下方确认报到。"}</p>
          <button disabled={busy || full} className={secondaryClass}>保存开赛后补录</button>
        </fieldset>
        {full && <p className="mt-2 text-sm text-amber-900">报名人数已达上限，不能新增选手；已有待报到者仍可确认报到。</p>}
      </form>
      {detail.entrants.filter(entry => entry.status === "preregistered" && !s?.players.some(player => player.id === entry.id)).map(entry => <form key={entry.id} aria-label={`开赛后报到 ${entry.name}`} className="space-y-3 rounded-lg border border-blue-200 bg-white p-3" onSubmit={event => {
        event.preventDefault(); void act({ action: "late_checkin", entryId: entry.id, ...arrival(new FormData(event.currentTarget), grouped) });
      }}>
        <fieldset disabled={busy} className="space-y-3"><legend className="mb-2 break-words text-sm font-semibold">待报到：{entry.name}</legend>
          <InitialFields groups={groups} grouped={grouped} />
          <p className="text-xs text-slate-600">核对本人到场和初始卡后确认，将沿用此报名记录。</p>
          <button disabled={busy} className={secondaryClass}>确认报到并加入后续匹配</button>
        </fieldset>
      </form>)}
    </>}
  </div>;
}
