import { z } from "zod";

export const godNames = { slifer: "天空龙", obelisk: "巨神兵", ra: "翼神龙" } as const;
export type God = keyof typeof godNames;
export type GodStock = Record<God, number>;
export type GodGroup = "A" | "B" | "all";
export const playerStatusNames = { waiting: "等待", playing: "对局中", completed: "已完成", no_chance: "无机会", revival_pending: "复活待赛", ruling_pending: "待裁判", withdrawn: "已退赛" } as const;
export type GodPlayer = {
  id: string; name: string; group: GodGroup; initialGod: God | null; initialAssigned: boolean;
  stock: GodStock; points: number; revivalPoints: number; extraLife: boolean; zeroBonusGranted: boolean;
  assignedMatches: number; completedMatches: number; mainMatches: number; initialArrangements: number;
  revivalEligible: boolean;
  hold: "none" | "ruling" | "withdrawn"; status: keyof typeof playerStatusNames;
};
export type GodOutcome = "a_win" | "b_win" | "draw" | "double_loss";
export type GodMatch = {
  id: string; kind: "main" | "revival" | "tiebreak" | "championship" | "third_place";
  group: GodGroup; batch: number; aId: string; bId: string; aParticipation: number; bParticipation: number;
  bestOf: 1 | 3; status: "playing" | "completed" | "ruling_pending";
  createdAt: string; deadlineAt: string; completedAt: string | null; gameWins: { a: number; b: number }; tieId: string | null;
  result: { outcome: GodOutcome; aWins: number; bWins: number; aPoints: number; bPoints: number;
    transfer: { god: God; from: string; to: string } | null;
    livesBefore: { a: { extraLife: boolean; zeroBonusGranted: boolean; revivalEligible: boolean; hold: GodPlayer["hold"] }; b: { extraLife: boolean; zeroBonusGranted: boolean; revivalEligible: boolean; hold: GodPlayer["hold"] } } } | null;
  lastResultEvent: number | null;
};
export type GodEvent = { id: string; kind: string; at: string; players: string[]; note: string; facts: unknown };
export type GodTie = { id: string; purpose: string; contenders: string[]; remaining: string[]; winnerId: string | null; matchIds: string[] };
export type ThreeGodsState = {
  version: 1; status: "rules_pending"; grouping: "ab" | "single";
  phase: "setup" | "main" | "candidate_wait" | "time_up" | "placements" | "finals" | "complete";
  startsAt: string | null; deadlineAt: string | null; players: GodPlayer[]; matches: GodMatch[];
  batches: Record<GodGroup, number>; batchRecords: { group: GodGroup; number: number; participantIds: string[]; matchIds: string[] }[];
  candidates: { playerId: string; matchId: string; rounds: number; different: boolean; pattern: string }[];
  stoppedGroups: GodGroup[]; selectedCandidates: Partial<Record<GodGroup, string[]>>;
  groupChampions: Partial<Record<GodGroup, string>>; groupRunners: Partial<Record<GodGroup, string>>;
  awards: string[]; ties: GodTie[];
  revival: { status: "idle" | "playing" | "tie_pending" | "complete"; eligibleIds: string[]; byeId: string | null; matchIds: string[]; winnerId: string | null };
  rulingMessages: string[]; events: GodEvent[]; commands: Record<string, string>;
};
export const threeGodsPending = ["同时达成的窗口或超过两名候选由裁判确认并公开记录。", "BO1 超时/平局/双方负不自动决胜，保留裁判裁定。", "A/B 仅一组产生冠军而总时限届满时，保留待裁定。"];
const god = z.enum(["slifer", "obelisk", "ra"]), group = z.enum(["A", "B", "all"]);
const note = z.string().trim().min(4).max(300), matchId = z.string().min(1).max(180);
export const threeGodsCommandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("initial"), playerId: z.uuid(), initialGod: god.nullable(), group, note }),
  z.object({ kind: z.literal("inventory"), playerId: z.uuid(), god, amount: z.number().int().min(1).max(99), operation: z.enum(["add", "remove"]), note }),
  z.object({ kind: z.literal("transfer"), fromId: z.uuid(), toId: z.uuid(), god, amount: z.number().int().min(1).max(99), note }),
  z.object({ kind: z.literal("status"), playerId: z.uuid(), status: z.enum(["waiting", "completed", "ruling_pending", "withdrawn"]), note }),
  z.object({ kind: z.literal("life"), playerId: z.uuid(), extraLife: z.boolean(), note }),
  z.object({ kind: z.literal("candidate_ruling"), playerId: z.uuid(), eligible: z.boolean(), note }),
  z.object({ kind: z.literal("score"), playerId: z.uuid(), delta: z.number().int().min(-1000).max(1000), note }),
  z.object({ kind: z.literal("begin_main"), note }),
  z.object({ kind: z.literal("pair"), group, note }),
  z.object({ kind: z.literal("progress"), matchId, aWins: z.number().int().min(0).max(2), bWins: z.number().int().min(0).max(2), note }),
  z.object({ kind: z.literal("result"), matchId, outcome: z.enum(["a_win", "b_win", "draw", "double_loss"]), aWins: z.number().int().min(0).max(2), bWins: z.number().int().min(0).max(2), note }),
  z.object({ kind: z.literal("arrangement"), playerId: z.uuid(), note }),
  z.object({ kind: z.literal("begin_revival"), note }),
  z.object({ kind: z.literal("resolve_single"), candidateIds: z.array(z.uuid()).max(2), note }),
  z.object({ kind: z.literal("resolve_group"), group: z.enum(["A", "B"]), candidateIds: z.array(z.uuid()).min(1).max(2), note }),
  z.object({ kind: z.literal("begin_finals"), note }),
  z.object({ kind: z.literal("resolve_timeout"), note }),
  z.object({ kind: z.literal("tie_pair"), tieId: z.string().min(1).max(100), aId: z.uuid(), bId: z.uuid(), note }),
]);
export type ThreeGodsCommand = z.infer<typeof threeGodsCommandSchema>;
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
export function emptyThreeGods(grouping: "ab" | "single" = "single"): ThreeGodsState {
  return { version: 1, status: "rules_pending", grouping, phase: "setup", startsAt: null, deadlineAt: null,
    players: [], matches: [], batches: { A: 0, B: 0, all: 0 }, batchRecords: [], candidates: [], stoppedGroups: [], selectedCandidates: {},
    groupChampions: {}, groupRunners: {}, awards: [], ties: [],
    revival: { status: "idle", eligibleIds: [], byeId: null, matchIds: [], winnerId: null }, rulingMessages: [], events: [], commands: {} };
}
export function specialRoster(grouping: "ab" | "single", entrants: { id: string; name: string }[]): ThreeGodsState {
  const state = emptyThreeGods(grouping);
  state.players = entrants.map(p => ({ ...p, group: grouping === "single" ? "all" : "A", initialGod: null, initialAssigned: false,
    stock: { slifer: 0, obelisk: 0, ra: 0 }, points: 0, revivalPoints: 0, extraLife: false, zeroBonusGranted: false,
    assignedMatches: 0, completedMatches: 0, mainMatches: 0, initialArrangements: 0, revivalEligible: false, hold: "none", status: "waiting" }));
  return state;
}
export const cardCount = (p: GodPlayer) => Object.values(p.stock).reduce((a, b) => a + b, 0);
export const hasOpportunity = (p: GodPlayer) => p.initialAssigned && (cardCount(p) > 0 || p.extraLife);
const busyIds = (s: ThreeGodsState) => new Set(s.matches.filter(m => m.status !== "completed").flatMap(m => [m.aId, m.bId]));
export const remainingMainMatches = (s: ThreeGodsState, group: GodGroup) => s.matches.filter(m => m.kind === "main" && m.group === group && (m.status !== "completed" || !m.result)).length;
function firstZero(p: GodPlayer) { if (p.initialAssigned && !cardCount(p) && !p.zeroBonusGranted) { p.zeroBonusGranted = true; p.extraLife = true; } }
function refreshPlayers(s: ThreeGodsState) {
  const busy = busyIds(s);
  for (const p of s.players) p.status = p.hold === "withdrawn" ? "withdrawn" : p.hold === "ruling" ? "ruling_pending" : busy.has(p.id) ? "playing"
    : s.revival.status !== "idle" && s.revival.status !== "complete" && s.revival.eligibleIds.includes(p.id) ? "revival_pending"
      : !hasOpportunity(p) && p.initialAssigned ? "no_chance" : p.completedMatches ? "completed" : "waiting";
}
export function godWinningPattern(stock: GodStock): string | null {
  return Object.values(stock).every(n => n >= 1) ? "三张不同幻神" : Object.values(stock).some(n => n >= 3) ? "三张相同幻神" : null;
}
export function bo3Points(aWins: number, bWins: number) {
  check((aWins === 2 && [0, 1].includes(bWins)) || (bWins === 2 && [0, 1].includes(aWins)), "BO3 胜负必须为 2:0、2:1、0:2 或 1:2。");
  return { aPoints: aWins + (aWins === 2 ? 2 : 0), bPoints: bWins + (bWins === 2 ? 2 : 0) };
}
export function revivalMetric(p: GodPlayer): number { return p.revivalPoints * 10 + p.points * 6; }
export function revivalGate(s: ThreeGodsState) {
  const initial = s.players.filter(p => p.initialAssigned && p.initialGod === null && p.hold !== "withdrawn");
  return { total: initial.length, completed: initial.filter(p => p.initialArrangements >= 3).length,
    ready: initial.length > 0 && initial.every(p => p.initialArrangements >= 3), eligibleIds: initial.filter(p => p.revivalEligible && !hasOpportunity(p) && p.hold === "none").map(p => p.id) };
}
export function canBeginRevival(s: ThreeGodsState, now = Date.now()): boolean {
  const gate = revivalGate(s);
  return ["main", "candidate_wait"].includes(s.phase) && s.revival.status === "idle" && gate.ready && gate.eligibleIds.length > 0
    && s.deadlineAt !== null && now < Date.parse(s.deadlineAt);
}
export function revivalPlacementIssue(s: ThreeGodsState): string | null {
  if (s.revival.status === "complete") return null;
  if (s.revival.status !== "idle") return "等待已开启的复活赛及其 BO1 裁定完成，不能进入或结束名次阶段。";
  const initial = s.players.filter(p => p.initialAssigned && p.initialGod === null && p.hold !== "withdrawn");
  if (initial.some(p => p.initialArrangements < 3 || p.hold === "ruling")) return "初始无卡者前三次安排或复活资格尚未确认，请先登记安排；到时未决保持待裁定，不丢弃复活资格。";
  return revivalGate(s).eligibleIds.length ? "请先完成全场一次复活赛及其 BO1，再进入名次阶段。" : null;
}
export function rankSimultaneousCandidates(players: GodPlayer[]) {
  const sorted = [...players].sort((a, b) => a.completedMatches - b.completedMatches || Number(Object.values(b.stock).every(n => n >= 1)) - Number(Object.values(a.stock).every(n => n >= 1)));
  const groups: { playerIds: string[]; rounds: number; different: boolean }[] = [];
  for (const p of sorted) { check(godWinningPattern(p.stock), "候选选手尚未集齐幻神。"); const different = Object.values(p.stock).every(n => n >= 1); const last = groups.at(-1);
    if (last?.rounds === p.completedMatches && last.different === different) last.playerIds.push(p.id); else groups.push({ playerIds: [p.id], rounds: p.completedMatches, different }); }
  return groups;
}
function shuffled<T>(values: T[], random: () => number): T[] {
  const result = [...values]; for (let i = result.length - 1; i > 0; i--) { const r = random(); check(r >= 0 && r < 1, "随机源无效，操作未保存。"); const j = Math.floor(r * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; } return result;
}
function newMatch(s: ThreeGodsState, id: string, kind: GodMatch["kind"], group: GodGroup, batch: number, a: GodPlayer, b: GodPlayer, now: string, tieId: string | null = null): GodMatch {
  const busy = busyIds(s); check(a.id !== b.id && !busy.has(a.id) && !busy.has(b.id), "选手仍有未完对局，不能同时进入第二场。");
  const bestOf = kind === "tiebreak" ? 1 : 3; a.assignedMatches++; b.assignedMatches++;
  const m: GodMatch = { id, kind, group, batch, aId: a.id, bId: b.id, aParticipation: a.assignedMatches, bParticipation: b.assignedMatches,
    bestOf, status: "playing", createdAt: now, completedAt: null, deadlineAt: new Date(Date.parse(now) + (bestOf === 1 ? 25 : 40) * 60_000).toISOString(),
    gameWins: { a: 0, b: 0 }, tieId, result: null, lastResultEvent: null };
  s.matches.push(m); return m;
}
function batch(s: ThreeGodsState, group: GodGroup, commandId: string, random: () => number, now: string): boolean {
  if (!["main", "candidate_wait"].includes(s.phase) || s.stoppedGroups.includes(group)) return false;
  if (s.deadlineAt && Date.parse(now) >= Date.parse(s.deadlineAt)) { s.phase = "time_up"; return false; }
  // Include older overlapping batches already published under the former completion threshold.
  if (remainingMainMatches(s, group)) return false;
  const busy = busyIds(s);
  const pool = shuffled(s.players.filter(p => p.group === group && p.hold === "none" && hasOpportunity(p) && !busy.has(p.id)
    && !(s.revival.status !== "idle" && s.revival.status !== "complete" && s.revival.eligibleIds.includes(p.id))), random);
  if (pool.length < 2) return false;
  const b = { group, number: ++s.batches[group], participantIds: [] as string[], matchIds: [] as string[] };
  // Waiting arrangements are administrative facts, never invented played games or losses.
  for (const p of s.players.filter(p => p.group === group && p.initialAssigned && p.initialGod === null && !hasOpportunity(p) && !busy.has(p.id))) p.initialArrangements = Math.min(3, p.initialArrangements + 1);
  while (pool.length >= 2) { const a = pool.shift()!; const i = pool.findIndex(p => p.initialGod !== a.initialGod); const other = pool.splice(i < 0 ? 0 : i, 1)[0];
    const id = `${commandId}:${group}:${b.number}:${b.matchIds.length + 1}`;
    newMatch(s, id, "main", group, b.number, a, other, now); b.participantIds.push(a.id, other.id); b.matchIds.push(id); }
  // An odd idle entrant waits: no score, lost life, or played round is fabricated.
  s.batchRecords.push(b); return true;
}
function detectCandidates(s: ThreeGodsState, matchId: string, at: string) {
  if (!["main", "candidate_wait", "time_up"].includes(s.phase)) return;
  for (const p of s.players.filter(p => p.hold !== "withdrawn")) { const pattern = godWinningPattern(p.stock);
    if (pattern && !s.candidates.some(c => c.playerId === p.id)) {
      if (s.deadlineAt && Date.parse(at) > Date.parse(s.deadlineAt)) s.rulingMessages.push(`${p.name}：总时限后登记新集齐，实际完成时点须由裁判确认；不会自动认定冠军候选。`);
      else s.candidates.push({ playerId: p.id, matchId, rounds: p.completedMatches, different: Object.values(p.stock).every(n => n >= 1), pattern });
    } }
  s.stoppedGroups = [...new Set(s.candidates.map(c => s.players.find(p => p.id === c.playerId)!.group))];
  if (s.grouping === "single" && s.candidates.length && s.phase === "main") s.phase = "candidate_wait";
}
function tieWinner(s: ThreeGodsState, purpose: string, contenders: string[], commandId: string, now: string): string | null {
  if (contenders.length === 1) return contenders[0];
  let t = s.ties.find(t => t.purpose === purpose && t.contenders.length === contenders.length && t.contenders.every(id => contenders.includes(id)));
  if (!t) { t = { id: `${purpose}:${s.ties.length + 1}`, purpose, contenders: [...contenders], remaining: [...contenders], winnerId: null, matchIds: [] }; s.ties.push(t); }
  if (!t.winnerId && t.remaining.length === 2 && !t.matchIds.some(id => s.matches.find(m => m.id === id)?.status !== "completed")) {
    const [a, b] = t.remaining.map(id => s.players.find(p => p.id === id)!);
    const id = `${commandId}:tie:${s.ties.indexOf(t)}:${t.matchIds.length + 1}`;
    newMatch(s, id, "tiebreak", a.group === b.group ? a.group : "all", 0, a, b, now, t.id); t.matchIds.push(id);
  }
  return t.winnerId;
}
function byScore(s: ThreeGodsState, ids: string[], purpose: string, commandId: string, now: string): string | null {
  if (!ids.length) return null;
  const max = Math.max(...ids.map(id => s.players.find(p => p.id === id)!.points));
  return tieWinner(s, purpose, ids.filter(id => s.players.find(p => p.id === id)!.points === max), commandId, now);
}
function candidateWinner(s: ThreeGodsState, ids: string[], purpose: string, commandId: string, now: string) {
  const candidates = ids.map(id => s.candidates.find(c => c.playerId === id)!);
  const rounds = Math.min(...candidates.map(c => c.rounds)); let best = candidates.filter(c => c.rounds === rounds);
  if (best.some(c => c.different)) best = best.filter(c => c.different);
  return tieWinner(s, purpose, best.map(c => c.playerId), commandId, now);
}
function settleRevival(s: ThreeGodsState, commandId: string, now: string) {
  if (s.revival.status === "idle" || s.revival.status === "complete" || s.revival.matchIds.some(id => s.matches.find(m => m.id === id)?.status !== "completed")) return;
  const max = Math.max(...s.revival.eligibleIds.map(id => revivalMetric(s.players.find(p => p.id === id)!)));
  const top = s.revival.eligibleIds.filter(id => revivalMetric(s.players.find(p => p.id === id)!) === max);
  const winner = tieWinner(s, "revival", top, commandId, now);
  if (!winner) { s.revival.status = "tie_pending"; return; }
  s.revival.winnerId = winner; s.revival.status = "complete";
  const p = s.players.find(p => p.id === winner)!; p.extraLife = true; p.zeroBonusGranted = true; p.hold = "none";
}
function settlePlaces(s: ThreeGodsState, commandId: string, now: string) {
  if (s.phase === "complete") return;
  if (s.revival.status === "playing" || s.revival.status === "tie_pending") return;
  const active = s.players.filter(p => p.hold !== "withdrawn").map(p => p.id);
  if (s.selectedCandidates.all !== undefined) {
    const ids = s.selectedCandidates.all;
    const champion = ids.length ? candidateWinner(s, ids, "single_champion", commandId, now) : byScore(s, active, "place_1", commandId, now);
    if (!champion) return;
    const result = [champion];
    if (ids.length === 2) result.push(ids.find(id => id !== champion)!);
    while (result.length < Math.min(3, active.length)) { const place = result.length + 1;
      const winner = byScore(s, active.filter(id => !result.includes(id)), `place_${place}`, commandId, now); if (!winner) { s.awards = result; return; } result.push(winner); }
    if (s.matches.some(m => m.status !== "completed") || revivalPlacementIssue(s)) return;
    s.awards = result; s.phase = "complete";
  }
  if (s.grouping === "ab") for (const group of ["A", "B"] as const) {
    const ids = s.selectedCandidates[group]; if (!ids) continue;
    const champion = tieWinner(s, `group_${group}_champion`, ids, commandId, now); if (!champion) continue;
    s.groupChampions[group] = champion;
    const runner = byScore(s, active.filter(id => s.players.find(p => p.id === id)!.group === group && id !== champion), `group_${group}_runner`, commandId, now);
    if (runner) s.groupRunners[group] = runner;
  }
  if (s.phase === "finals") {
    const final = s.matches.find(m => m.kind === "championship"), third = s.matches.find(m => m.kind === "third_place");
    const win = (m: GodMatch | undefined) => m?.result?.outcome === "a_win" ? m.aId : m?.result?.outcome === "b_win" ? m.bId : null;
    if (win(final) && win(third) && s.matches.every(m => m.status === "completed") && !revivalPlacementIssue(s)) { s.awards = [win(final)!, final!.aId === win(final) ? final!.bId : final!.aId, win(third)!]; s.phase = "complete"; }
  }
}
export function correctionImpact(s: ThreeGodsState, id: string): GodEvent[] {
  const m = s.matches.find(m => m.id === id); if (!m || m.lastResultEvent === null) return [];
  const later = s.events.slice(m.lastResultEvent + 1).filter(e => e.players.some(id => id === m.aId || id === m.bId));
  const after = s.matches.slice(s.matches.indexOf(m) + 1).filter(n => [n.aId, n.bId].some(id => id === m.aId || id === m.bId));
  return [...later, ...after.map(n => ({ id: n.id, kind: "published_match", at: n.createdAt, players: [n.aId, n.bId], note: "后续配对已公布", facts: null }))];
}

// Commands are applied to a clone, then committed with one revision CAS by the BFF/SQL RPC.
// A recorded command ID prevents duplicate score/card/life changes, including after a lost response.
export function applyThreeGodsCommand(original: ThreeGodsState, commandId: string, input: ThreeGodsCommand, random: () => number = Math.random, now = new Date().toISOString()): ThreeGodsState {
  check(z.uuid().safeParse(commandId).success, "操作标识无效。");
  const c = threeGodsCommandSchema.parse(input), fingerprint = JSON.stringify(c);
  if (original.commands[commandId]) { check(original.commands[commandId] === fingerprint, "同一操作标识不可用于不同内容。"); return original; }
  check(original.phase !== "complete", "名次已确认，赛事已结束；后续纠错须保留现有原始记录并由组织者处理。");
  const s = structuredClone(original), event: GodEvent = { id: commandId, kind: c.kind, at: now, players: [], note: c.note, facts: null };
  const get = (id: string) => { const p = s.players.find(p => p.id === id); check(p, "选手不存在。"); return p; };
  const available = (p: GodPlayer) => check(!busyIds(s).has(p.id), "选手有未完对局，请先处理当前比赛。");
  if (c.kind === "initial") {
    const p = get(c.playerId); check(s.phase === "setup" && !p.initialAssigned, "初始神已锁定，不会被库存转移或移除覆盖。");
    check(s.grouping === "single" ? c.group === "all" : c.group !== "all", "分组与赛事配置不符。");
    p.group = c.group; p.initialGod = c.initialGod; p.initialAssigned = true; p.stock = { slifer: 0, obelisk: 0, ra: 0 };
    if (c.initialGod) p.stock[c.initialGod] = 1;
    p.extraLife = !c.initialGod; p.zeroBonusGranted = !c.initialGod; event.players = [p.id]; event.facts = c;
  } else if (c.kind === "inventory") {
    const p = get(c.playerId), before = { ...p.stock }; const amount = c.operation === "add" ? c.amount : -c.amount;
    check(p.initialAssigned, "请先确认初始神类别。"); check(p.stock[c.god] + amount >= 0 && p.stock[c.god] + amount <= 999, "库存不足或超过上限。");
    p.stock[c.god] += amount; if (s.phase !== "setup") firstZero(p); event.players = [p.id]; event.facts = { before, after: { ...p.stock }, removalIsLedgerOnly: true };
  } else if (c.kind === "transfer") {
    const from = get(c.fromId), to = get(c.toId); check(from.id !== to.id && from.group === to.group, "手动转移需为同组的两名不同选手。");
    check(from.stock[c.god] >= c.amount && to.stock[c.god] + c.amount <= 999, "转出库存不足或转入库存超过上限。");
    from.stock[c.god] -= c.amount; to.stock[c.god] += c.amount; if (s.phase !== "setup") firstZero(from); event.players = [from.id, to.id]; event.facts = c;
  } else if (c.kind === "status") {
    const p = get(c.playerId);
    if (c.status === "withdrawn" || c.status === "ruling_pending") {
      p.hold = c.status === "withdrawn" ? "withdrawn" : "ruling";
      for (const m of s.matches.filter(m => m.status !== "completed" && [m.aId, m.bId].includes(p.id))) m.status = "ruling_pending";
      if (s.candidates.some(candidate => candidate.playerId === p.id)) s.rulingMessages.push(`${p.name} 为集齐候选且现已暂停/退赛：资格须由裁判明确确认或撤销。`);
    } else { available(p); p.hold = "none"; }
    event.players = [p.id]; event.facts = { ...c, unfinishedMatchRequiresRuling: busyIds(s).has(p.id), noFutureLossesAdded: true };
  } else if (c.kind === "life") {
    const p = get(c.playerId); available(p); const before = p.extraLife;
    if (before && !c.extraLife && p.initialGod === null && p.initialArrangements <= 3) p.revivalEligible = true;
    p.extraLife = c.extraLife; if (c.extraLife) p.zeroBonusGranted = true; p.hold = "none";
    event.players = [p.id]; event.facts = { extraLifeBefore: before, extraLifeAfter: p.extraLife, judgeRuling: true };
  } else if (c.kind === "candidate_ruling") {
    const p = get(c.playerId); check(["main", "candidate_wait", "time_up"].includes(s.phase) && !s.selectedCandidates[p.group], "已进入名次处理或当前不能变更候选认定。");
    const previous = s.candidates.find(candidate => candidate.playerId === p.id) ?? null;
    if (c.eligible) { const pattern = godWinningPattern(p.stock); check(pattern && p.hold === "none", "当前库存未集齐三同或三异，或选手已暂停/退赛，不能认定候选。");
      if (!previous) s.candidates.push({ playerId: p.id, matchId: `judge:${commandId}`, rounds: p.completedMatches, different: Object.values(p.stock).every(n => n >= 1), pattern });
    } else s.candidates = s.candidates.filter(candidate => candidate.playerId !== p.id);
    s.stoppedGroups = [...new Set(s.candidates.map(candidate => get(candidate.playerId).group))];
    if (s.grouping === "single") s.phase = s.candidates.length ? "candidate_wait" : s.deadlineAt && Date.parse(now) >= Date.parse(s.deadlineAt) ? "time_up" : "main";
    event.players = [p.id]; event.facts = { previous, eligible: c.eligible, explicitTimingOrInventoryRuling: true };
  } else if (c.kind === "score") {
    check(s.phase === "setup" || ["main", "candidate_wait", "time_up"].includes(s.phase), "名次处理已开始，不能静默改变已确定的排名依据。");
    const p = get(c.playerId); check(p.points + c.delta >= 0, "积分不能小于零。"); const before = p.points; p.points += c.delta; event.players = [p.id]; event.facts = { before, after: p.points };
  } else if (c.kind === "begin_main") {
    check(s.phase === "setup" && s.players.length >= 2 && s.players.every(p => p.initialAssigned), "请先确认全部已报到选手的初始神（无卡也须明确选择）。");
    if (s.grouping === "ab") check(["A", "B"].every(group => s.players.filter(p => p.group === group).length >= 2), "A、B 组均须至少两人。");
    s.phase = "main"; s.startsAt = now; s.deadlineAt = new Date(Date.parse(now) + 210 * 60_000).toISOString();
    for (const group of s.grouping === "single" ? ["all" as const] : ["A" as const, "B" as const]) batch(s, group, commandId, random, now);
    event.players = s.players.map(p => p.id); event.facts = { startsAt: now, deadlineAt: s.deadlineAt };
  } else if (c.kind === "pair") {
    const remaining = remainingMainMatches(s, c.group);
    const generated = batch(s, c.group, commandId, random, now); check(generated || s.phase === "time_up", remaining
      ? `本组尚有 ${remaining} 场对局未结束并完成结果登记，不能开始下一轮。`
      : "已有冠军候选或空闲有机会者不足两人，未生成新配对。");
    event.facts = { group: c.group, batch: s.batches[c.group], phase: s.phase };
  } else if (c.kind === "arrangement") {
    const p = get(c.playerId); available(p); check(p.initialAssigned && p.initialGod === null && p.initialArrangements < 3, "仅用于初始无卡选手尚未完成的前三次安排。");
    p.initialArrangements++; event.players = [p.id]; event.facts = { waitingArrangement: p.initialArrangements, noPlayedRoundOrScoreAdded: true };
  } else if (c.kind === "progress") {
    const m = s.matches.find(m => m.id === c.matchId); check(m && !m.result, "对局不存在或已经确认结果。");
    check(!(c.aWins === 2 && c.bWins === 2) && (m.bestOf === 3 || c.aWins <= 1 && c.bWins <= 1), "小局比分无效。");
    m.gameWins = { a: c.aWins, b: c.bWins }; event.players = [m.aId, m.bId]; event.facts = { matchId: m.id, gameWins: m.gameWins };
  } else if (c.kind === "result") {
    const m = s.matches.find(m => m.id === c.matchId); check(m, "对局不存在。"); const a = get(m.aId), b = get(m.bId);
    if (m.result && (m.kind === "revival" && s.revival.status !== "playing" || m.kind === "tiebreak" && ["a_win", "b_win"].includes(m.result.outcome))) throw new Error("该结果已用于复活或名次处理，不能静默回滚；请先由裁判核对后续影响。");
    if (m.result) check(!correctionImpact(s, m.id).length, `更正会影响后续记录或已公布配对（${correctionImpact(s, m.id).length} 项）；不能自动回滚。请先核对影响，可用有原因的记分/库存调整保留原始赛果。`);
    let points = c.outcome === "draw" ? { aPoints: 1, bPoints: 1 } : { aPoints: 0, bPoints: 0 };
    const decisive = c.outcome === "a_win" || c.outcome === "b_win";
    if (decisive) { if (m.bestOf === 3) { points = bo3Points(c.aWins, c.bWins); check((c.outcome === "a_win") === (c.aWins === 2), "胜者与小局比分不符。"); }
      else check(c.outcome === "a_win" ? c.aWins === 1 && c.bWins === 0 : c.bWins === 1 && c.aWins === 0, "BO1 必须确认 1:0 或 0:1。"); }
    const old = m.result ? structuredClone(m.result) : null;
    const livesBefore = old?.livesBefore ?? { a: { extraLife: a.extraLife, zeroBonusGranted: a.zeroBonusGranted, revivalEligible: a.revivalEligible, hold: a.hold }, b: { extraLife: b.extraLife, zeroBonusGranted: b.zeroBonusGranted, revivalEligible: b.revivalEligible, hold: b.hold } };
    if (old) {
      if (old.transfer) { const holder = get(old.transfer.to), from = get(old.transfer.from); check(holder.stock[old.transfer.god] > 0, "原转移卡已移走，需先核对库存影响。"); holder.stock[old.transfer.god]--; from.stock[old.transfer.god]++; }
      if (m.kind === "main") { a.points -= old.aPoints; b.points -= old.bPoints; }
      if (m.kind === "revival") { a.revivalPoints -= old.aPoints; b.revivalPoints -= old.bPoints; }
      Object.assign(a, livesBefore.a); Object.assign(b, livesBefore.b);
      s.candidates = s.candidates.filter(candidate => candidate.matchId !== m.id);
    } else {
      a.completedMatches++; b.completedMatches++;
      if (m.kind === "main") { a.mainMatches++; b.mainMatches++; for (const p of [a, b]) if (p.initialGod === null) p.initialArrangements++; }
    }
    let transfer: NonNullable<GodMatch["result"]>["transfer"] = null;
    if (decisive && ["main", "championship", "third_place"].includes(m.kind)) {
      const winner = c.outcome === "a_win" ? a : b, loser = winner === a ? b : a;
      const cards = (Object.keys(godNames) as God[]).flatMap(god => Array<God>(loser.stock[god]).fill(god));
      if (cards.length) { const preserve = old?.outcome === c.outcome ? old.transfer : null; const r = preserve ? 0 : random(); check(r >= 0 && r < 1, "随机源无效，结果未保存。");
        const picked = preserve?.god ?? cards[Math.floor(r * cards.length)]; check(loser.stock[picked] > 0, "原随机转移卡不在原库存内，不能重抽更正。");
        loser.stock[picked]--; winner.stock[picked]++; transfer = { god: picked, from: loser.id, to: winner.id }; firstZero(loser);
      } else if (m.kind === "main") {
        if (loser.extraLife && loser.initialGod === null && loser.initialArrangements <= 3) loser.revivalEligible = true;
        loser.extraLife = false;
      }
    }
    if (c.outcome === "double_loss" && m.kind === "main") {
      // No card transfer is confirmed; zero-card extra-life consequences require an explicit ruling.
      for (const p of [a, b]) if (!cardCount(p) && p.extraLife) p.hold = "ruling";
      if ([a, b].some(p => p.hold === "ruling")) s.rulingMessages.push(`${m.id} 双方判负：零牌额外机会由裁判确认，不自动补牌或扣两次。`);
    }
    if (m.kind === "main") { a.points += points.aPoints; b.points += points.bPoints; }
    if (m.kind === "revival") { a.revivalPoints += points.aPoints; b.revivalPoints += points.bPoints; }
    m.gameWins = { a: c.aWins, b: c.bWins }; m.result = { outcome: c.outcome, aWins: c.aWins, bWins: c.bWins, ...points, transfer, livesBefore };
    m.status = !decisive && ["tiebreak", "championship", "third_place"].includes(m.kind) ? "ruling_pending" : "completed"; m.completedAt ??= now; m.lastResultEvent = s.events.length;
    if (m.kind === "tiebreak" && decisive) { const t = s.ties.find(t => t.id === m.tieId)!; const loser = c.outcome === "a_win" ? b.id : a.id; t.remaining = t.remaining.filter(id => id !== loser); if (t.remaining.length === 1) t.winnerId = t.remaining[0]; }
    event.players = [a.id, b.id]; event.facts = { matchId: m.id, previous: old, result: structuredClone(m.result) };
    if (m.kind === "main") { detectCandidates(s, m.id, m.completedAt); if (!old) batch(s, m.group, commandId, random, now); }
    settleRevival(s, commandId, now); settlePlaces(s, commandId, now);
  } else if (c.kind === "begin_revival") {
    check(["main", "candidate_wait"].includes(s.phase), "复活赛只能在正赛或候选等待阶段开启，名次阶段不能新开复活赛。");
    const gate = revivalGate(s); check(gate.ready && gate.eligibleIds.length && s.revival.status === "idle", "全部初始无卡者须完成前三次安排，且有已出局候选；全场仅能开启一次复活赛。");
    check(s.deadlineAt && Date.parse(now) < Date.parse(s.deadlineAt), "正赛总时限已到，不能新开复活赛。");
    const ids = shuffled(gate.eligibleIds, random); check(ids.every(id => !busyIds(s).has(id)), "候选仍有未完赛对局。");
    s.revival = { status: "playing", eligibleIds: [...ids], byeId: null, matchIds: [], winnerId: null };
    if (ids.length % 2) { const id = ids.pop()!; s.revival.byeId = id; get(id).revivalPoints = 1.5; }
    while (ids.length) { const a = get(ids.shift()!), b = get(ids.shift()!); const id = `${commandId}:revival:${s.revival.matchIds.length + 1}`;
      newMatch(s, id, "revival", "all", 0, a, b, now); s.revival.matchIds.push(id); }
    event.players = [...s.revival.eligibleIds]; event.facts = { byeId: s.revival.byeId, byePoints: s.revival.byeId ? 1.5 : 0 };
    settleRevival(s, commandId, now);
  } else if (c.kind === "resolve_single") {
    check(s.grouping === "single" && c.candidateIds.length === new Set(c.candidateIds).size, "候选配置无效。");
    check(!s.matches.some(m => m.status !== "completed") && ["idle", "complete"].includes(s.revival.status), "先等在打的对局及已开启复活赛/BO1裁定结束，不自动截断对局。");
    check(!revivalPlacementIssue(s), revivalPlacementIssue(s) ?? "复活资格待裁定。");
    check(c.candidateIds.every(id => s.candidates.some(p => p.playerId === id) && get(id).hold === "none"), "窗口内含未达成、暂停或退赛的选手，请裁判先处理资格。");
    if (!c.candidateIds.length) check(!s.candidates.length && s.deadlineAt && Date.parse(now) >= Date.parse(s.deadlineAt), "无人达成时须到总时限后按积分处理。");
    check(!s.selectedCandidates.all, "名次处理已开始。");
    s.selectedCandidates.all = [...c.candidateIds]; s.phase = "placements"; s.stoppedGroups = ["all"];
    event.players = [...c.candidateIds]; event.facts = { simultaneousWindowConfirmedByJudge: true, candidateIds: c.candidateIds }; settlePlaces(s, commandId, now);
  } else if (c.kind === "resolve_group") {
    check(s.grouping === "ab" && !s.selectedCandidates[c.group], "分组无效或该组已进入名次确认。");
    check(!s.matches.some(m => m.status !== "completed" && [get(m.aId).group, get(m.bId).group].includes(c.group)), "该组选手仍有在打对局，请结束后按分数确认亚军。");
    check(c.candidateIds.length === new Set(c.candidateIds).size && c.candidateIds.every(id => s.candidates.some(p => p.playerId === id) && get(id).group === c.group && get(id).hold === "none"), "组冠军候选无效或选手暂停/退赛。");
    s.selectedCandidates[c.group] = [...c.candidateIds]; if (!s.stoppedGroups.includes(c.group)) s.stoppedGroups.push(c.group);
    event.players = c.candidateIds; event.facts = { group: c.group, candidateIds: c.candidateIds }; settlePlaces(s, commandId, now);
  } else if (c.kind === "begin_finals") {
    check(!revivalPlacementIssue(s), revivalPlacementIssue(s) ?? "复活资格待裁定。");
    check(s.grouping === "ab" && s.groupChampions.A && s.groupChampions.B && s.groupRunners.A && s.groupRunners.B, "A/B 冠亚军尚未确认；若仅一组产生冠军而到时，保持待裁判，不擅自分配名次。");
    check(!s.matches.some(m => m.status !== "completed") && ["idle", "complete"].includes(s.revival.status) && !s.matches.some(m => m.kind === "championship"), "先完成现有对局和已开启的复活赛裁定；名次赛不能重复创建。");
    newMatch(s, `${commandId}:final`, "championship", "all", 0, get(s.groupChampions.A), get(s.groupChampions.B), now);
    newMatch(s, `${commandId}:third`, "third_place", "all", 0, get(s.groupRunners.A), get(s.groupRunners.B), now);
    s.phase = "finals"; event.players = [s.groupChampions.A, s.groupChampions.B, s.groupRunners.A, s.groupRunners.B]; event.facts = { mayFinishAfterOverallDeadline: true };
  } else if (c.kind === "resolve_timeout") {
    check(!revivalPlacementIssue(s), revivalPlacementIssue(s) ?? "复活资格待裁定。");
    check(s.grouping === "ab" && !s.candidates.length && s.deadlineAt && Date.parse(now) >= Date.parse(s.deadlineAt), "仅适用于 A/B 全场无人集齐且总时限已到。");
    check(!s.matches.some(m => m.status !== "completed"), "先处理全部在打对局；超时未决保持待裁判。");
    s.phase = "placements"; s.selectedCandidates.all = []; s.stoppedGroups = ["A", "B"]; event.facts = { noGroupChampionAtTimeout: true }; settlePlaces(s, commandId, now);
  } else if (c.kind === "tie_pair") {
    const t = s.ties.find(t => t.id === c.tieId); check(t && !t.winnerId && t.remaining.includes(c.aId) && t.remaining.includes(c.bId), "BO1 候选无效。");
    const id = `${commandId}:judge_tie`; newMatch(s, id, "tiebreak", "all", 0, get(c.aId), get(c.bId), now, t.id); t.matchIds.push(id);
    event.players = [c.aId, c.bId]; event.facts = { tieId: t.id, pairingConfirmedByJudge: true };
  }
  if (["inventory", "transfer"].includes(c.kind) && s.phase !== "setup") detectCandidates(s, `manual:${commandId}`, now);
  if (original.revival.status !== "complete" && s.revival.status === "complete" && s.revival.winnerId) batch(s, get(s.revival.winnerId).group, commandId, random, now);
  if (s.grouping === "ab" && s.deadlineAt && Date.parse(now) >= Date.parse(s.deadlineAt) && !s.groupChampions.A !== !s.groupChampions.B) s.rulingMessages.push("总时限已到且仅一组产生冠军：跨组名次衔接待裁判裁定。");
  refreshPlayers(s); s.events.push(event); s.commands[commandId] = fingerprint; return s;
}
