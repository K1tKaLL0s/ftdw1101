/** Public tournament state: entrant IDs are event-scoped IDs, never account IDs. */
export type Format = "swiss_cut" | "pseudo_double";
export type Rules = { format: Format; swissRounds: number; topCut: number };
export type Entrant = { id: string; name: string; seed: number; active: boolean };
export type Result = "a_win" | "b_win" | "draw" | "double_loss" | "bye" | "void";
export type Source = { player: string } | { match: string; take: "winner" | "loser" } | null;
export type Match = {
  id: string; bracket: "swiss" | "winners" | "losers" | "final" | "cut";
  round: number; table: number; a: Source; b: Source;
  aId: string | null; bId: string | null; result: Result | null;
  winnerId: string | null; loserId: string | null; automatic: boolean;
};
export type State = {
  version: 1; phase: "swiss" | "cut_pending" | "knockout" | "double" | "complete";
  entrants: Entrant[]; matches: Match[]; currentRound: number;
  championId: string | null; cutSeeds: string[];
  history: { action: string; detail: string }[];
};
export type Standing = Entrant & {
  points: number; wins: number; draws: number; losses: number; byes: number;
  played: number; rate: number; omw: number; oomw: number; opponents: string[]; rank: number;
};

export class TournamentError extends Error {}
function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TournamentError(message);
}
const average = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
const equal = (a: number, b: number) => Math.abs(a - b) < 1e-10;
export function compareScores(a: Standing, b: Standing): number {
  return a.points - b.points || (equal(a.omw, b.omw) ? 0 : a.omw - b.omw) || (equal(a.oomw, b.oomw) ? 0 : a.oomw - b.oomw);
}

export function standings(state: State): Standing[] {
  const rows = state.entrants.map((entrant): Standing => ({ ...entrant, points: 0, wins: 0, draws: 0,
    losses: 0, byes: 0, played: 0, rate: 0, omw: 0, oomw: 0, opponents: [], rank: 0 }));
  const byId = new Map(rows.map(row => [row.id, row]));
  for (const match of state.matches.filter(match => match.bracket === "swiss" && match.result)) {
    const a = match.aId ? byId.get(match.aId) : undefined;
    const b = match.bId ? byId.get(match.bId) : undefined;
    if (match.result === "bye") {
      const recipient = a ?? b;
      if (recipient) { recipient.points += 3; recipient.byes += 1; }
      continue;
    }
    if (!a || !b || match.result === "void") continue;
    a.played++; b.played++;
    a.opponents.push(b.id); b.opponents.push(a.id);
    if (match.result === "a_win") { a.wins++; a.points += 3; b.losses++; }
    if (match.result === "b_win") { b.wins++; b.points += 3; a.losses++; }
    if (match.result === "draw") { a.draws++; b.draws++; a.points++; b.points++; }
    if (match.result === "double_loss") { a.losses++; b.losses++; }
  }
  for (const row of rows) row.rate = row.played ? (3 * row.wins + row.draws) / (3 * row.played) : 0;
  for (const row of rows) row.omw = average(row.opponents.map(id => byId.get(id)!.rate));
  for (const row of rows) row.oomw = average(row.opponents.map(id => byId.get(id)!.omw));
  // Seed only stabilizes display. It never silently decides tied qualification or cut seeding.
  rows.sort((a, b) => -compareScores(a, b) || a.seed - b.seed);
  rows.forEach((row, i) => { row.rank = i && compareScores(rows[i - 1], row) === 0 ? rows[i - 1].rank : i + 1; });
  return rows;
}

function makeMatch(id: string, bracket: Match["bracket"], round: number, table: number, a: Source, b: Source): Match {
  return { id, bracket, round, table, a, b, aId: null, bId: null, result: null, winnerId: null, loserId: null, automatic: false };
}
const player = (id: string | undefined): Source => id ? { player: id } : null;
const from = (match: string, take: "winner" | "loser" = "winner"): Source => ({ match, take });

/** Standard recursive seeding: 1/8, 4/5, 2/7, 3/6 for an eight-slot bracket. */
export function seedOrder(size: number): number[] {
  ensure(size >= 2 && size <= 128 && (size & (size - 1)) === 0, "签表大小必须为 2–128 的二次幂。");
  let order = [1, 2];
  while (order.length < size) { const nextSize = order.length * 2; order = order.flatMap(seed => [seed, nextSize + 1 - seed]); }
  return order;
}

function buildBracket(ids: string[], double: boolean): Match[] {
  const size = 2 ** Math.ceil(Math.log2(ids.length));
  const rounds = Math.log2(size);
  const order = seedOrder(size);
  const matches: Match[] = [];
  let previous: string[] = [];
  const winners: string[][] = [];
  for (let r = 1; r <= rounds; r++) {
    const current: string[] = [];
    for (let i = 0; i < size / 2 ** r; i++) {
      const id = `${double ? "W" : "K"}${r}-${i + 1}`;
      matches.push(makeMatch(id, double ? "winners" : "cut", r, i + 1,
        r === 1 ? player(ids[order[2 * i] - 1]) : from(previous[2 * i]),
        r === 1 ? player(ids[order[2 * i + 1] - 1]) : from(previous[2 * i + 1])));
      current.push(id);
    }
    winners.push(current); previous = current;
  }
  if (double) {
    let lower: string[] = [];
    for (let r = 1; r <= 2 * rounds - 2; r++) {
      const count = size / 2 ** (Math.floor((r + 1) / 2) + 1);
      const current: string[] = [];
      for (let i = 0; i < count; i++) {
        const id = `L${r}-${i + 1}`;
        const a = r === 1 ? from(winners[0][2 * i], "loser") : from(lower[r % 2 ? 2 * i : i]);
        const b = r === 1 ? from(winners[0][2 * i + 1], "loser")
          : r % 2 ? from(lower[2 * i + 1]) : from(winners[r / 2][count - 1 - i], "loser");
        matches.push(makeMatch(id, "losers", r, i + 1, a, b)); current.push(id);
      }
      lower = current;
    }
    // A single final, deliberately no reset match, even when the losers finalist wins.
    matches.push(makeMatch("GF", "final", 1, 1, from(previous[0]),
      rounds === 1 ? from(previous[0], "loser") : from(lower[0])));
  }
  return matches;
}

function resolve(source: Source, byId: Map<string, Match>): { ready: boolean; id: string | null } {
  if (source === null) return { ready: true, id: null };
  if ("player" in source) return { ready: true, id: source.player };
  const match = byId.get(source.match);
  ensure(match, "签表引用的对局不存在。");
  return { ready: match.result !== null, id: source.take === "winner" ? match.winnerId : match.loserId };
}

function applyWinner(match: Match) {
  match.winnerId = match.result === "a_win" ? match.aId : match.result === "b_win" ? match.bId
    : match.result === "bye" ? match.aId ?? match.bId : null;
  match.loserId = match.result === "a_win" ? match.bId : match.result === "b_win" ? match.aId : null;
}

function settle(state: State): State {
  const byId = new Map(state.matches.map(match => [match.id, match]));
  const active = new Map(state.entrants.map(entrant => [entrant.id, entrant.active]));
  for (const match of state.matches.filter(match => match.bracket !== "swiss")) {
    const a = resolve(match.a, byId); const b = resolve(match.b, byId);
    if (!a.ready || !b.ready) {
      match.aId = a.id; match.bId = b.id; match.result = null; match.winnerId = null; match.loserId = null;
      continue;
    }
    const unchanged = match.aId === a.id && match.bId === b.id;
    match.aId = a.id; match.bId = b.id;
    // A later withdrawal cannot rewrite an earlier, already-decided walkover.
    if (match.automatic && !(unchanged && (match.result === "a_win" || match.result === "b_win"))) {
      match.result = null; match.automatic = false;
    }
    if (!match.result && (!a.id || !b.id)) {
      match.result = a.id || b.id ? "bye" : "void"; match.automatic = true;
    }
    if (!match.result && a.id && b.id && (!active.get(a.id) || !active.get(b.id))) {
      match.result = !active.get(a.id) && !active.get(b.id) ? "void" : active.get(a.id) ? "a_win" : "b_win";
      match.automatic = true;
    }
    applyWinner(match);
  }
  const final = state.matches.filter(match => match.bracket !== "swiss").at(-1);
  if (final?.result) { state.phase = "complete"; state.championId = final.winnerId; }
  return state;
}

/** Finds a legal matching, trying equal/near scores first and backtracking to avoid repeats. */
export function pairSwiss(state: State): Match[] {
  const rows = standings(state).filter(row => row.active);
  ensure(rows.length >= 2, "不足两名在赛选手，请人工处理赛程；不会补未来负场。");
  let visited = 0;
  const search = (remaining: Standing[]): [string, string][] | null => {
    if (!remaining.length) return [];
    if (++visited > 200_000) throw new TournamentError("配对搜索达到上限，请组织者人工安排合法配对；未生成违规对局。");
    const first = remaining[0];
    const candidates = remaining.slice(1).filter(row => !first.opponents.includes(row.id))
      .sort((a, b) => Math.abs(first.points - a.points) - Math.abs(first.points - b.points) || a.seed - b.seed);
    for (const candidate of candidates) {
      const rest = search(remaining.filter(row => row !== first && row !== candidate));
      if (rest) return [[first.id, candidate.id], ...rest];
    }
    return null;
  };
  const byeCandidates = rows.length % 2
    ? [...rows].sort((a, b) => a.byes - b.byes || a.points - b.points || a.seed - b.seed) : [null];
  for (const bye of byeCandidates) {
    // Do not silently assign a repeat bye while a never-bye entrant exists.
    if (bye && bye.byes > Math.min(...rows.map(row => row.byes))) break;
    const pairs = search(rows.filter(row => row !== bye));
    if (!pairs) continue;
    const round = state.currentRound + 1;
    const matches = pairs.map(([a, b], i) => {
      const match = makeMatch(`S${round}-${i + 1}`, "swiss", round, i + 1, player(a), player(b));
      match.aId = a; match.bId = b; return match;
    });
    if (bye) {
      const match = makeMatch(`S${round}-bye`, "swiss", round, matches.length + 1, player(bye.id), null);
      match.aId = bye.id; match.result = "bye"; match.winnerId = bye.id; match.automatic = true; matches.push(match);
    }
    return matches;
  }
  throw new TournamentError("无法在避免重赛及公平轮空的条件下配对，请组织者人工裁决；未生成违规对局。");
}

export function startTournament(rules: Rules, entrants: Entrant[]): State {
  ensure(entrants.length >= 2 && entrants.length <= 128, "开赛需要 2–128 名选手。");
  ensure(new Set(entrants.map(row => row.id)).size === entrants.length, "选手名单存在重复。");
  if (rules.format === "swiss_cut") {
    ensure(Number.isInteger(rules.swissRounds) && rules.swissRounds >= 3 && rules.swissRounds <= 7, "瑞士轮必须为 3–7 轮。");
    ensure([2, 4, 8, 16, 32, 64].includes(rules.topCut) && rules.topCut <= entrants.length, "报名人数不足所选晋级人数，请调整赛事后开赛。");
    ensure(rules.swissRounds <= entrants.length - (entrants.length % 2 === 0 ? 1 : 0), "当前人数无法完成所选轮数且避免重赛，请调整赛事或补足人数。");
  }
  const state: State = { version: 1, phase: rules.format === "swiss_cut" ? "swiss" : "double",
    entrants: structuredClone(entrants).map((row, i) => ({ ...row, seed: i + 1, active: true })),
    matches: [], currentRound: 0, championId: null, cutSeeds: [],
    history: [{ action: "start", detail: "报名截止，规则与初始种子锁定。初始种子按报名顺序。" }] };
  if (rules.format === "swiss_cut") { state.matches = pairSwiss(state); state.currentRound = 1; return state; }
  state.matches = buildBracket(state.entrants.map(row => row.id), true);
  return settle(state);
}

export function nextSwissRound(rules: Rules, original: State): State {
  const state = structuredClone(original);
  ensure(state.phase === "swiss", "当前不在瑞士轮阶段。");
  ensure(state.matches.every(match => match.result), "本轮还有未确认的结果。");
  if (state.currentRound >= rules.swissRounds) {
    state.phase = "cut_pending";
    state.history.push({ action: "swiss_complete", detail: "瑞士轮结束，等待确认晋级与种子顺序。" });
    return state;
  }
  state.matches.push(...pairSwiss(state)); state.currentRound++;
  state.history.push({ action: "next_swiss", detail: `公布第 ${state.currentRound} 轮配对，之前轮次结果锁定。` });
  return state;
}

/** An explicit organizer recovery: never rewrites an already published round. */
export function manualSwissRound(rules: Rules, original: State, pairs: { a: string; b: string | null }[], reason: string, allowRematches = false, allowRepeatBye = false): State {
  const state = structuredClone(original);
  ensure(state.phase === "swiss" && state.currentRound < rules.swissRounds, "当前不能新增瑞士轮配对。");
  ensure(state.matches.every(match => match.result), "先确认当前所有对局结果，再安排下一轮。");
  ensure(reason.trim().length >= 4, "人工恢复须填写至少 4 字的公开原因。");
  const rows = standings(state).filter(row => row.active), lookup = new Map(rows.map(row => [row.id, row]));
  ensure(rows.length >= 2 && pairs.length === Math.ceil(rows.length / 2), "人工配对必须覆盖全部在赛选手，每人只安排一次。");
  const included = pairs.flatMap(pair => pair.b === null ? [pair.a] : [pair.a, pair.b]);
  ensure(included.length === rows.length && new Set(included).size === rows.length && included.every(id => lookup.has(id)), "人工配对含重复、遗漏、无效或已退赛选手。");
  ensure(pairs.filter(pair => pair.b === null).length === rows.length % 2, "偶数人数不得轮空，奇数人数必须且只能有一人轮空。");
  const rematches = pairs.filter(pair => pair.b !== null && lookup.get(pair.a)!.opponents.includes(pair.b));
  ensure(!rematches.length || allowRematches, "人工配对包含重赛，须明确勾选允许重赛；系统不会静默破例。");
  const bye = pairs.find(pair => pair.b === null), minByes = Math.min(...rows.map(row => row.byes));
  ensure(!bye || lookup.get(bye.a)!.byes === minByes || allowRepeatBye, "仍有轮空次数更少的选手，须明确确认重复轮空例外。");
  const round = state.currentRound + 1;
  const next = pairs.map((pair, i) => {
    const match = makeMatch(`S${round}-${i + 1}`, "swiss", round, i + 1, player(pair.a), pair.b === null ? null : player(pair.b));
    match.aId = pair.a; match.bId = pair.b;
    if (pair.b === null) { match.result = "bye"; match.winnerId = pair.a; match.automatic = true; }
    return match;
  });
  state.matches.push(...next); state.currentRound = round;
  state.history.push({ action: "manual_swiss", detail: `人工公布第 ${round} 轮：${reason.trim()}。${rematches.length ? `组织者明确确认 ${rematches.length} 场重赛。` : "无重赛。"}${bye && lookup.get(bye.a)!.byes > minByes ? "组织者明确确认重复轮空例外。" : ""}先前已公布轮次保持原记录。` });
  return state;
}

export function advanceToCut(rules: Rules, original: State, orderedIds?: string[], resolution = ""): State {
  const state = structuredClone(original);
  ensure(state.phase === "cut_pending", "瑞士轮尚未结束或淘汰赛已开始。");
  const eligible = standings(state).filter(row => row.active);
  ensure(eligible.length >= rules.topCut, "在赛人数不足晋级人数，不能自动缩减晋级名额。请组织者人工处理。");
  const tied = eligible.some((row, i) => i > 0 && i <= rules.topCut && compareScores(eligible[i - 1], row) === 0);
  ensure(!tied || (orderedIds && resolution.trim().length >= 4), "晋级线或晋级种子存在总分、OMW、OOMW 全同的选手。请按预先公布的方法处理，提交完整排名顺序及处理记录。");
  let ordered = eligible;
  if (orderedIds) {
    ensure(orderedIds.length === eligible.length && new Set(orderedIds).size === eligible.length, "必须提交全部在赛选手且不可重复。");
    ordered = orderedIds.map(id => { const row = eligible.find(row => row.id === id); ensure(row, "排名含无效或已退赛选手。"); return row; });
    ensure(ordered.every((row, i) => !i || compareScores(ordered[i - 1], row) >= 0), "人工顺序只能调整三项分数全同的选手。");
  }
  state.cutSeeds = ordered.slice(0, rules.topCut).map(row => row.id);
  state.phase = "knockout";
  state.matches.push(...buildBracket(state.cutSeeds, false));
  state.history.push({ action: "cut", detail: `晋级 ${rules.topCut} 人，淘汰签表锁定。${resolution.trim()}` });
  return settle(state);
}

function descendants(matches: Match[], id: string): Set<string> {
  const found = new Set([id]);
  for (const match of matches) {
    if ([match.a, match.b].some(source => source && "match" in source && found.has(source.match))) found.add(match.id);
  }
  found.delete(id); return found;
}

export function recordResult(original: State, id: string, result: Result, reason = ""): State {
  const state = structuredClone(original);
  const match = state.matches.find(match => match.id === id);
  ensure(match && match.aId && match.bId && !match.automatic, "这场对局尚不可录入，或是系统处理的轮空/退赛。");
  ensure(["a_win", "b_win", "draw", "double_loss"].includes(result), "无效的比赛结果。");
  if (match.bracket !== "swiss") ensure(result === "a_win" || result === "b_win", "淘汰赛必须确认唯一胜者，平局或双方判负不会晋级。");
  if (match.bracket === "swiss") ensure(state.phase === "swiss" && match.round === state.currentRound, "后续轮次或阶段已公布，不能修改之前结果或静默重排。");
  if (match.result) ensure(reason.trim().length >= 4, "修改已确认结果须填写至少 4 字的公开原因。");
  const downstream = descendants(state.matches, id);
  ensure(!state.matches.some(row => downstream.has(row.id) && row.result && !row.automatic), "后续对局已产生结果，不能修改上游比赛；请组织者处理受影响赛程。");
  if (match.result === result) return state;
  state.history.push({ action: match.result ? "correction" : "result", detail: `${id}：${match.result ?? "待定"} → ${result}${reason.trim() ? `；${reason.trim()}` : ""}` });
  match.result = result; applyWinner(match);
  if (match.bracket !== "swiss") {
    state.phase = match.bracket === "cut" ? "knockout" : "double"; state.championId = null;
    return settle(state);
  }
  return state;
}

export function dropEntrant(original: State, id: string, reason: string): State {
  const state = structuredClone(original);
  ensure(state.phase !== "complete", "赛事已结束。");
  const entrant = state.entrants.find(entrant => entrant.id === id);
  ensure(entrant?.active, "该选手不在赛。");
  ensure(reason.trim().length >= 4, "退赛须填写至少 4 字的公开说明。");
  if (state.phase === "swiss") ensure(!state.matches.some(match => match.bracket === "swiss" && !match.result && (match.aId === id || match.bId === id)), "请先确认该选手本轮结果（弃权按判负录入），再办理退赛。");
  entrant.active = false;
  state.history.push({ action: "drop", detail: `#${entrant.seed} ${entrant.name} 退赛：${reason.trim()}；不补未来负场。` });
  return state.phase === "double" || state.phase === "knockout" ? settle(state) : state;
}
