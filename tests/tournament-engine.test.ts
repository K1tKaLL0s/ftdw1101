import assert from "node:assert/strict";
import { test } from "node:test";
import { advanceToCut, dropEntrant, manualSwissRound, nextSwissRound, recordResult, seedOrder, standings, startTournament, type Entrant, type Rules, type State } from "../lib/tournaments/engine";

const entrants = (n: number): Entrant[] => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `选手${i + 1}`, seed: i + 1, active: true }));
const swiss: Rules = { format: "swiss_cut", swissRounds: 3, topCut: 2 };
const double: Rules = { format: "pseudo_double", swissRounds: 0, topCut: 0 };
function finishRound(state: State, result: "a_win" | "draw" = "a_win") {
  for (const match of state.matches.filter(match => !match.result)) state = recordResult(state, match.id, result);
  return state;
}

for (const n of [2, 3, 5, 8, 16]) for (const pattern of [0, 1, 2]) {
  test(`pseudo double ${n} entrants pattern ${pattern}: 2N-2 played, two losses, no reset`, () => {
    let state = startTournament(double, entrants(n)); let count = 0;
    const losses = new Map<string, number>();
    while (state.phase !== "complete") {
      const ready = state.matches.find(match => !match.result && match.aId && match.bId);
      assert.ok(ready, "bracket must make progress");
      const result = pattern === 0 ? "a_win" : pattern === 1 ? "b_win" : count % 2 ? "a_win" : "b_win";
      const loser = result === "a_win" ? ready.bId! : ready.aId!;
      losses.set(loser, (losses.get(loser) ?? 0) + 1);
      assert.ok(losses.get(loser)! <= 2);
      state = recordResult(state, ready.id, result); count++;
      assert.ok(count <= 2 * n - 2);
    }
    assert.equal(count, 2 * n - 2);
    assert.equal(state.matches.filter(match => match.bracket === "final").length, 1);
    assert.equal(state.matches.at(-1)!.id, "GF");
    const final = state.matches.at(-1)!;
    for (const entrant of state.entrants) {
      if (entrant.id === state.championId) assert.ok((losses.get(entrant.id) ?? 0) <= 1);
      else if (entrant.id === final.loserId && final.result === "b_win") assert.equal(losses.get(entrant.id), 1, "undefeated finalist may be runner-up on first loss");
      else assert.equal(losses.get(entrant.id), 2);
    }
    assert.equal(state.matches.filter(match => match.result === "bye").every(match => match.loserId === null), true);
  });
}

test("Swiss odd entrants, byes and real-opponent OMW/OOMW use the published formulas", () => {
  let state = startTournament(swiss, entrants(5));
  const bye = state.matches.find(match => match.result === "bye")!;
  let byeRow = standings(state).find(row => row.id === bye.aId)!;
  assert.equal(byeRow.points, 3); assert.equal(byeRow.played, 0); assert.equal(byeRow.rate, 0);
  assert.deepEqual(byeRow.opponents, []);
  const [one, two] = state.matches.filter(match => !match.result);
  state = recordResult(state, one.id, "draw"); state = recordResult(state, two.id, "double_loss");
  let rows = standings(state);
  assert.equal(rows.find(row => row.id === one.aId)!.rate, 1 / 3);
  assert.equal(rows.find(row => row.id === one.aId)!.omw, 1 / 3);
  assert.equal(rows.find(row => row.id === two.aId)!.rate, 0, "no fabricated 33 percent floor");
  assert.equal(rows.find(row => row.id === two.aId)!.losses, 1);
  state = recordResult(state, two.id, "a_win", "裁判确认更正");
  rows = standings(state);
  assert.equal(rows.find(row => row.id === two.aId)!.rate, 1);
  assert.equal(rows.find(row => row.id === two.bId)!.omw, 1);
  assert.equal(rows.find(row => row.id === two.bId)!.oomw, 0);
  byeRow = rows.find(row => row.id === bye.aId)!; assert.equal(byeRow.losses, 0);
  state = nextSwissRound(swiss, state);
  assert.equal(state.currentRound, 2);
  assert.notEqual(state.matches.find(match => match.round === 2 && match.result === "bye")!.aId, bye.aId);
  assert.throws(() => recordResult(state, one.id, "a_win", "修改旧轮结果"), /不能修改/);
});

test("withdrawals preserve played results and never add future losses", () => {
  let state = startTournament(swiss, entrants(6));
  const match = state.matches[0];
  assert.throws(() => dropEntrant(state, match.aId!, "本人申请退赛"), /本轮结果/);
  state = finishRound(state);
  state = dropEntrant(state, match.bId!, "本人申请退赛");
  const before = standings(state).find(row => row.id === match.bId)!;
  state = nextSwissRound(swiss, state);
  assert.equal(state.matches.filter(row => row.round === 2).some(row => row.aId === match.bId || row.bId === match.bId), false);
  assert.equal(standings(state).find(row => row.id === match.bId)!.losses, before.losses);
});

test("a real win plus bye has rate 1, bye does not dilute OMW denominator", () => {
  let state = startTournament(swiss, entrants(5));
  const byeId = state.matches.find(match => match.result === "bye")!.aId!;
  state = nextSwissRound(swiss, finishRound(state));
  const match = state.matches.find(match => match.round === 2 && (match.aId === byeId || match.bId === byeId))!;
  state = recordResult(state, match.id, match.aId === byeId ? "a_win" : "b_win");
  const row = standings(state).find(row => row.id === byeId)!;
  assert.equal(row.points, 6); assert.equal(row.played, 1); assert.equal(row.rate, 1);
});

test("3-round Swiss transitions into a locked seeded knockout, ties require explicit published-method resolution", () => {
  let state = startTournament(swiss, entrants(4));
  for (let i = 0; i < 3; i++) state = nextSwissRound(swiss, finishRound(state, "draw"));
  assert.equal(state.phase, "cut_pending");
  assert.equal(state.matches.length, 6);
  assert.throws(() => advanceToCut(swiss, state), /全同/);
  state = advanceToCut(swiss, state, ["p3", "p1", "p4", "p2"], "已按公布办法现场抽签");
  assert.deepEqual(state.cutSeeds, ["p3", "p1"]);
  assert.equal(state.phase, "knockout");
  assert.throws(() => advanceToCut(swiss, state), /已开始/);
  const final = state.matches.at(-1)!;
  assert.equal(final.aId, "p3"); assert.equal(final.bId, "p1");
  assert.throws(() => recordResult(state, final.id, "draw"), /唯一胜者/);
  assert.throws(() => recordResult(state, final.id, "double_loss"), /唯一胜者/);
  state = recordResult(state, final.id, "b_win");
  assert.equal(state.championId, "p1"); assert.equal(state.phase, "complete");
});

test("invalid qualification counts, insufficient remaining players, non-tied rank overrides are rejected", () => {
  assert.throws(() => startTournament({ ...swiss, swissRounds: 2 }, entrants(8)), /3–7/);
  assert.throws(() => startTournament({ ...swiss, topCut: 8 }, entrants(4)), /不足/);
  assert.throws(() => startTournament(swiss, entrants(2)), /避免重赛/);
  let state = startTournament({ ...swiss, topCut: 4 }, entrants(4));
  for (let i = 0; i < 3; i++) state = nextSwissRound(swiss, finishRound(state));
  const rank = standings(state).filter(row => row.active).map(row => row.id);
  assert.throws(() => advanceToCut(swiss, state, [...rank].reverse(), "现场公开抽签"), /只能调整/);
  state = dropEntrant(state, "p1", "本人申请退赛");
  assert.throws(() => advanceToCut({ ...swiss, topCut: 4 }, state), /不足晋级/);
});

test("Swiss avoids all rematches, prefers same scores, pauses rather than silently violating constraints", () => {
  let state = startTournament(swiss, entrants(8));
  state = nextSwissRound(swiss, finishRound(state));
  const scores = standings({ ...state, matches: state.matches.filter(match => match.round === 1) });
  for (const match of state.matches.filter(match => match.round === 2)) {
    assert.equal(scores.find(row => row.id === match.aId)!.points, scores.find(row => row.id === match.bId)!.points);
  }
  const played = new Set<string>();
  for (let i = 0; i < 2; i++) state = nextSwissRound(swiss, finishRound(state));
  for (const match of state.matches) {
    const key = [match.aId, match.bId].sort().join(":");
    assert.equal(played.has(key), false); played.add(key);
  }
  let small = startTournament(swiss, entrants(3));
  for (let i = 0; i < 2; i++) small = nextSwissRound(swiss, finishRound(small));
  assert.throws(() => nextSwissRound({ ...swiss, swissRounds: 4 }, finishRound(small)), /人工裁决/);
});

test("bracket corrections propagate only before dependent matches have results", () => {
  let state = startTournament(double, entrants(8));
  state = recordResult(state, "W1-1", "a_win");
  assert.throws(() => recordResult(state, "W1-1", "b_win"), /公开原因/);
  state = recordResult(state, "W1-1", "b_win", "裁判复核更正");
  assert.equal(state.matches.find(match => match.id === "W2-1")!.aId, "p8");
  state = recordResult(state, "W1-2", "a_win");
  state = recordResult(state, "W2-1", "a_win");
  assert.throws(() => recordResult(state, "W1-1", "a_win", "再次复核更正"), /后续对局/);
  assert.deepEqual(seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
});

test("bracket withdrawals resolve forfeits without fabricating bye losses or rewriting prior walkovers", () => {
  let state = startTournament(double, entrants(5));
  state = dropEntrant(state, "p1", "本人申请退赛");
  while (state.phase !== "complete") {
    const ready = state.matches.find(match => !match.result && match.aId && match.bId);
    assert.ok(ready); state = recordResult(state, ready.id, "a_win");
  }
  assert.notEqual(state.championId, "p1");
  assert.equal(state.matches.filter(match => match.result === "bye").every(match => !match.loserId), true);
});

test("six-player five-round Swiss deadlock has an explicit, audited manual rematch recovery", () => {
  const rules = { ...swiss, swissRounds: 5 }; let s = finishRound(startTournament(rules, entrants(6)));
  const winners = (state: State, ids: string[]) => {
    for (const id of ids) { const m = state.matches.find(m => !m.result && [m.aId, m.bId].includes(id)); assert.ok(m); state = recordResult(state, m.id, m.aId === id ? "a_win" : "b_win"); } return state;
  };
  s = winners(nextSwissRound(rules, s), ["p3", "p5", "p6"]);
  s = winners(nextSwissRound(rules, s), ["p3", "p1", "p2"]);
  assert.throws(() => nextSwissRound(rules, s), /无法.*配对/);
  const previous = JSON.stringify(s.matches), pairs = [{ a: "p1", b: "p4" }, { a: "p2", b: "p3" }, { a: "p5", b: "p6" }];
  assert.throws(() => manualSwissRound(rules, s, pairs, "无全匹配，确认一场重赛"), /明确勾选允许重赛/);
  const next = manualSwissRound(rules, s, pairs, "无全匹配，现场公开确认一场重赛", true);
  assert.equal(next.currentRound, 4); assert.equal(JSON.stringify(next.matches.slice(0, 9)), previous);
  assert.match(next.history.at(-1)!.detail, /明确确认 1 场重赛/);
  assert.throws(() => manualSwissRound(rules, s, [pairs[0], { a: "p1", b: "p3" }, pairs[2]], "重复选手应拒绝", true), /重复、遗漏/);
  assert.throws(() => recordResult(next, "S3-1", "b_win", "修改已锁定旧轮次"), /不能修改/);
});

test("manual Swiss repeated bye requires its own explicit exception and never creates a loss", () => {
  const s = finishRound(startTournament(swiss, entrants(5))), bye = s.matches.find(m => m.result === "bye")!.aId!;
  const other = s.entrants.filter(p => p.id !== bye).map(p => p.id);
  const pairs = [{ a: bye, b: null }, { a: other[0], b: other[1] }, { a: other[2], b: other[3] }];
  assert.throws(() => manualSwissRound(swiss, s, pairs, "人工登记重复轮空", true), /重复轮空例外/);
  const next = manualSwissRound(swiss, s, pairs, "场地异常，公开确认重复轮空", true, true);
  assert.equal(standings(next).find(p => p.id === bye)!.losses, 0);
  assert.match(next.history.at(-1)!.detail, /确认重复轮空例外/);
});
