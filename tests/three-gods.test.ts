import assert from "node:assert/strict";
import { test } from "node:test";
import { applyThreeGodsCommand, bo3Points, cardCount, correctionImpact, hasOpportunity, rankSimultaneousCandidates, revivalGate, revivalMetric, specialRoster, type God, type GodMatch, type ThreeGodsCommand, type ThreeGodsState } from "../lib/tournaments/three-gods";

let serial = 0;
const id = (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = "2026-10-24T05:30:00.000Z", late = "2026-10-24T10:00:00.000Z";
const note = "现场裁判确认记录";
function command(s: ThreeGodsState, c: ThreeGodsCommand, time = now) { return applyThreeGodsCommand(s, id(++serial + 1000), c, () => 0.75, time); }
function setup(cards: (God | null)[], grouping: "single" | "ab" = "single", start = true) {
  let s = specialRoster(grouping, cards.map((_, i) => ({ id: id(i + 1), name: `选手${i + 1}` })));
  for (let i = 0; i < cards.length; i++) s = command(s, { kind: "initial", playerId: id(i + 1), group: grouping === "single" ? "all" : i < cards.length / 2 ? "A" : "B", initialGod: cards[i], note });
  return start ? command(s, { kind: "begin_main", note }) : s;
}
function result(s: ThreeGodsState, m: GodMatch, outcome: "a_win" | "b_win" | "draw" | "double_loss", time = now) {
  return command(s, { kind: "result", matchId: m.id, outcome, aWins: outcome === "a_win" ? m.bestOf === 1 ? 1 : 2 : 0, bWins: outcome === "b_win" ? m.bestOf === 1 ? 1 : 2 : 0, note }, time);
}
const active = (s: ThreeGodsState, kind: GodMatch["kind"] = "main") => s.matches.filter(m => m.kind === kind && m.status !== "completed");
function depleted() {
  let s = setup([null, null, null, null, null, null]);
  for (let i = 0; active(s).length && i < 20; i++) s = result(s, active(s)[0], "a_win");
  assert.equal(active(s).length, 0);
  for (const p of s.players) while (s.players.find(row => row.id === p.id)!.initialArrangements < 3) s = command(s, { kind: "arrangement", playerId: p.id, note });
  return s;
}
function score(s: ThreeGodsState, playerId: string, points: number) { return command(s, { kind: "score", playerId, delta: points - s.players.find(p => p.id === playerId)!.points, note }); }

test("BO3 points are 4/0 and 4/1; draws/double-loss replace this match's small-game points only", () => {
  assert.deepEqual(bo3Points(2, 0), { aPoints: 4, bPoints: 0 }); assert.deepEqual(bo3Points(2, 1), { aPoints: 4, bPoints: 1 }); assert.throws(() => bo3Points(1, 1));
  let s = setup(["slifer", "ra", "obelisk", "slifer", "ra", "obelisk"]); const m = active(s)[0];
  s = score(s, m.aId, 7); s = score(s, m.bId, 5);
  s = command(s, { kind: "progress", matchId: m.id, aWins: 1, bWins: 0, note });
  const stocks = s.players.map(p => p.stock);
  s = command(s, { kind: "result", matchId: m.id, outcome: "draw", aWins: 1, bWins: 1, note });
  assert.equal(s.players.find(p => p.id === m.aId)!.points, 8); assert.equal(s.players.find(p => p.id === m.bId)!.points, 6);
  assert.deepEqual(s.players.map(p => p.stock), stocks);
  s = command(s, { kind: "result", matchId: m.id, outcome: "double_loss", aWins: 1, bWins: 0, note });
  assert.equal(s.players.find(p => p.id === m.aId)!.points, 7); assert.equal(s.players.find(p => p.id === m.bId)!.points, 5);
  assert.deepEqual(s.players.map(p => p.stock), stocks);
});

test("result/card transfer is atomic and idempotent; initial god is immutable and inventory conserved", () => {
  let s = setup(["slifer", "ra", "obelisk", "slifer", "ra", "obelisk"]); const m = active(s)[0];
  const original = structuredClone(s), key = id(++serial + 1000), c: ThreeGodsCommand = { kind: "result", matchId: m.id, outcome: "a_win", aWins: 2, bWins: 1, note };
  let draws = 0; s = applyThreeGodsCommand(s, key, c, () => { draws++; return 0; }, now);
  assert.equal(draws, 1); assert.equal(s.players.reduce((n, p) => n + cardCount(p), 0), 6);
  assert.equal(s.players.find(p => p.id === m.aId)!.points, 4); assert.equal(s.players.find(p => p.id === m.bId)!.points, 1);
  assert.deepEqual(s.players.map(p => p.initialGod), original.players.map(p => p.initialGod));
  assert.equal(applyThreeGodsCommand(s, key, c, () => { throw new Error("must not reroll"); }, now), s);
  assert.throws(() => applyThreeGodsCommand(s, key, { ...c, bWins: 0 }, () => 0, now), /不同内容/);
  assert.throws(() => command(s, { kind: "initial", playerId: m.bId, initialGod: null, group: "all", note }), /已锁定/);
  const invalid = { ...c, aWins: 1, bWins: 1 };
  assert.throws(() => command(original, invalid), /BO3/); assert.deepEqual(original.players.map(p => cardCount(p)), [1, 1, 1, 1, 1, 1]);
});

test("life system grants first-zero bonus once; zero-card loss consumes it and never gives the winner a fabricated god", () => {
  let s = setup(["slifer", "slifer", "slifer", "slifer", "slifer", "slifer"]); const m = active(s)[0]; const loserId = m.bId;
  s = result(s, m, "a_win"); let p = s.players.find(p => p.id === loserId)!;
  assert.equal(cardCount(p), 0); assert.equal(p.extraLife, true); assert.equal(p.zeroBonusGranted, true); assert.equal(hasOpportunity(p), true);
  for (const pending of active(s).filter(row => row.batch === 1)) s = result(s, pending, "draw");
  const next = active(s).find(row => [row.aId, row.bId].includes(loserId))!; assert.ok(next);
  const count = s.players.reduce((n, p) => n + cardCount(p), 0);
  s = result(s, next, next.aId === loserId ? "b_win" : "a_win"); p = s.players.find(p => p.id === loserId)!;
  assert.equal(p.extraLife, false); assert.equal(hasOpportunity(p), false); assert.equal(s.matches.find(row => row.id === next.id)!.result!.transfer, null);
  assert.equal(s.players.reduce((n, p) => n + cardCount(p), 0), count);
});

test("initial zero-card players have one extra life; a win does not consume it; double loss leaves a visible life ruling", () => {
  let s = setup([null, null, null, null, null, null]); const m = active(s)[0];
  s = result(s, m, "a_win"); assert.equal(s.players.find(p => p.id === m.aId)!.extraLife, true); assert.equal(s.players.find(p => p.id === m.bId)!.extraLife, false);
  assert.equal(s.players.find(p => p.id === m.bId)!.revivalEligible, true);
  const other = active(s)[0]; s = result(s, other, "double_loss");
  assert.equal(s.players.find(p => p.id === other.aId)!.hold, "ruling"); assert.equal(s.matches.find(row => row.id === other.id)!.result!.aPoints, 0);
  assert.ok(s.rulingMessages.some(message => message.includes("额外机会")));
});

test("70 percent uses actual current-batch participants and never schedules an unfinished player twice", () => {
  let s = setup(["slifer", "ra", "obelisk", "slifer", "ra", "obelisk", "slifer", "ra"]);
  const first = [...active(s)]; assert.equal(first.length, 4);
  s = result(s, first[0], "draw"); s = result(s, first[1], "draw"); assert.equal(s.batches.all, 1);
  s = result(s, first[2], "draw"); assert.equal(s.batches.all, 2);
  const unfinished = new Set([first[3].aId, first[3].bId]);
  assert.equal(s.batchRecords.at(-1)!.participantIds.some(id => unfinished.has(id)), false);
  const playing = active(s).flatMap(m => [m.aId, m.bId]); assert.equal(playing.length, new Set(playing).size);
  assert.equal(s.players.find(p => p.id === first[3].aId)!.assignedMatches, 1);
});

test("random pairing prefers different initial gods; odd main entrant waits with no bye points or invented round", () => {
  const s = setup(["slifer", "slifer", "slifer", "ra", "ra", "ra"]);
  for (const m of active(s)) assert.notEqual(s.players.find(p => p.id === m.aId)!.initialGod, s.players.find(p => p.id === m.bId)!.initialGod);
  const odd = setup(["slifer", "ra", "obelisk", "slifer", "ra"]); const waiting = odd.players.find(p => !active(odd).some(m => [m.aId, m.bId].includes(p.id)))!;
  assert.equal(waiting.points, 0); assert.equal(waiting.assignedMatches, 0); assert.equal(cardCount(waiting), 1);
});

test("revival waits for all initial-empty arrangements, then random one round with 1.5 bye and one global winner", () => {
  let s = depleted(); const gate = revivalGate(s); assert.equal(gate.ready, true); assert.equal(gate.eligibleIds.length, 5);
  s = command(s, { kind: "begin_revival", note }); assert.equal(s.revival.matchIds.length, 2); assert.ok(s.revival.byeId);
  const bye = s.revival.byeId!; s = score(s, bye, 100); const main = s.players.find(p => p.id === bye)!.points;
  for (const m of active(s, "revival")) s = result(s, m, "a_win");
  assert.equal(s.revival.status, "complete"); assert.equal(s.revival.winnerId, bye);
  assert.equal(s.players.find(p => p.id === bye)!.revivalPoints, 1.5); assert.equal(s.players.find(p => p.id === bye)!.points, main);
  assert.equal(revivalMetric(s.players.find(p => p.id === bye)!), 615);
  assert.equal(s.revival.eligibleIds.filter(id => s.players.find(p => p.id === id)!.extraLife).length, 1);
  assert.throws(() => command(s, { kind: "begin_revival", note }), /一次复活赛/);
});

test("revival metric ties create a BO1, unresolved BO1 cannot silently award the one revival slot", () => {
  let s = depleted(); for (const p of s.players) s = score(s, p.id, 0);
  s = command(s, { kind: "begin_revival", note }); for (const m of active(s, "revival")) s = result(s, m, "a_win");
  assert.equal(s.revival.status, "tie_pending"); const tie = active(s, "tiebreak")[0]; assert.ok(tie); assert.equal(tie.bestOf, 1);
  s = result(s, tie, "draw"); assert.equal(s.revival.winnerId, null); assert.equal(s.matches.find(m => m.id === tie.id)!.status, "ruling_pending");
  s = result(s, s.matches.find(m => m.id === tie.id)!, "a_win"); assert.equal(s.revival.winnerId, tie.aId);
  assert.equal(s.players.find(p => p.id === tie.aId)!.points, 0);
});

test("a zero-card player's first extra-life loss after the third arrangement does not join revival", () => {
  let s = setup([null, null, null, null, null, null]); const m = active(s)[0];
  const p = s.players.find(p => p.id === m.bId)!; p.initialArrangements = 3;
  s = result(s, m, "a_win"); assert.equal(s.players.find(p => p.id === m.bId)!.initialArrangements, 4); assert.equal(s.players.find(p => p.id === m.bId)!.revivalEligible, false);
});

test("single qualifier stops new pairings, waits for running matches, then remaining score leaders are runner-up and third", () => {
  let s = setup(["slifer", "slifer", "slifer", "slifer"]);
  for (let i = 0; !s.candidates.length && i < 20; i++) { assert.ok(active(s).length); s = result(s, active(s)[0], "a_win"); }
  assert.ok(s.candidates.length); const candidate = s.candidates[0].playerId; const count = s.matches.length;
  if (active(s).length) assert.throws(() => command(s, { kind: "resolve_single", candidateIds: [candidate], note }), /在打/);
  for (const m of active(s)) s = result(s, m, "draw"); assert.equal(s.matches.length, count);
  const others = s.players.filter(p => p.id !== candidate); for (let i = 0; i < others.length; i++) s = score(s, others[i].id, 20 - 5 * i);
  s = command(s, { kind: "resolve_single", candidateIds: [candidate], note });
  assert.equal(s.phase, "complete"); assert.deepEqual(s.awards, [candidate, others[0].id, others[1].id]);
});

test("simultaneous candidates use fewer actual rounds then different gods; fully equal stays in BO1", () => {
  const make = () => { const s = setup(["slifer", "ra", "obelisk", "slifer"], "single", false); s.phase = "candidate_wait"; s.startsAt = now; s.deadlineAt = late;
    s.players[0].stock = { slifer: 3, ra: 0, obelisk: 0 }; s.players[1].stock = { slifer: 1, ra: 1, obelisk: 1 };
    s.players[2].points = 9; s.players[3].points = 2;
    s.candidates = [{ playerId: s.players[0].id, matchId: "observed-a", rounds: 2, different: false, pattern: "三同" }, { playerId: s.players[1].id, matchId: "observed-b", rounds: 3, different: true, pattern: "三异" }]; return s; };
  let s = make(); s = command(s, { kind: "resolve_single", candidateIds: s.candidates.map(c => c.playerId), note }); assert.deepEqual(s.awards, [id(1), id(2), id(3)]);
  s = make(); s.candidates[1].rounds = 2; s = command(s, { kind: "resolve_single", candidateIds: s.candidates.map(c => c.playerId), note }); assert.deepEqual(s.awards, [id(2), id(1), id(3)]);
  s = make(); s.candidates[1].rounds = 2; s.candidates[1].different = false;
  s = command(s, { kind: "resolve_single", candidateIds: s.candidates.map(c => c.playerId), note }); assert.equal(s.awards.length, 0); assert.equal(active(s, "tiebreak").length, 1);
  const players = make().players.slice(0, 2); players[0].completedMatches = 2; players[1].completedMatches = 2; assert.equal(rankSimultaneousCandidates(players)[0].playerIds[0], id(2));
});

test("no qualifier at 3.5 hours ranks by points, ties require BO1 rather than account or insertion order", () => {
  let s = setup(["slifer", "ra", "obelisk", "slifer"]); for (const m of active(s)) s = result(s, m, "draw", late);
  assert.equal(s.phase, "time_up"); s = score(s, id(1), 10); s = score(s, id(2), 10); s = score(s, id(3), 5); s = score(s, id(4), 1);
  s = command(s, { kind: "resolve_single", candidateIds: [], note }, late); const m = active(s, "tiebreak")[0]; assert.ok(m); assert.equal(s.phase, "placements");
  s = result(s, m, "b_win", late); assert.deepEqual(s.awards, [m.bId, m.aId, id(3)]); assert.equal(s.phase, "complete");
});

test("A/B groups stop independently; group runners by score play third; finals may finish after overall limit", () => {
  let s = setup(["slifer", "ra", "obelisk", "slifer", "ra", "obelisk"], "ab");
  for (const group of ["A", "B"] as const) {
    const members = s.players.filter(p => p.group === group), champion = members[0];
    s = command(s, { kind: "inventory", playerId: champion.id, god: champion.initialGod!, amount: 2, operation: "add", note });
    for (const m of active(s).filter(m => m.group === group)) s = result(s, m, "draw");
    s = score(s, members[1].id, 10); s = score(s, members[2].id, 3);
    s = command(s, { kind: "resolve_group", group, candidateIds: [champion.id], note });
  }
  assert.ok(s.groupChampions.A && s.groupChampions.B && s.groupRunners.A && s.groupRunners.B);
  s = command(s, { kind: "begin_finals", note }); assert.equal(s.phase, "finals");
  const final = active(s, "championship")[0], third = active(s, "third_place")[0];
  s = result(s, final, "a_win", late); s = result(s, third, "b_win", late);
  assert.deepEqual(s.awards, [final.aId, final.bId, third.bId]); assert.equal(s.phase, "complete");
});

test("A/B only one group champion at timeout stays visibly pending, never fabricates the other champion", () => {
  let s = setup(["slifer", "ra", "obelisk", "slifer", "ra", "obelisk"], "ab");
  s = command(s, { kind: "inventory", playerId: id(1), god: "slifer", amount: 2, operation: "add", note });
  for (const m of active(s).filter(m => m.group === "A")) s = result(s, m, "draw"); s = score(s, id(2), 10);
  s = command(s, { kind: "resolve_group", group: "A", candidateIds: [id(1)], note });
  s = command(s, { kind: "pair", group: "B", note }, late);
  assert.equal(s.awards.length, 0); assert.ok(s.rulingMessages.some(message => message.includes("仅一组")));
  assert.throws(() => command(s, { kind: "begin_finals", note }, late), /待裁判/);
});

test("inventory removal preserves raw records; corrections report already published downstream pairings", () => {
  let s = setup(["slifer", "ra", "obelisk", "slifer", "ra", "obelisk"]); const initial = s.players[0].initialGod!;
  s = command(s, { kind: "inventory", playerId: id(1), god: initial, amount: 1, operation: "remove", note });
  assert.equal(s.players[0].initialGod, initial); assert.ok(s.events.at(-1)!.facts); assert.equal(s.players.length, 6);
  assert.throws(() => command(s, { kind: "inventory", playerId: id(1), god: initial, amount: 1, operation: "remove", note }), /库存不足/);
  const first = [...active(s)]; for (const m of first) s = result(s, m, "draw");
  assert.ok(correctionImpact(s, first[0].id).length);
  assert.throws(() => result(s, first[0], "a_win"), /不能自动回滚/);
});

test("late qualification requires a visible timing ruling; correcting a zero-card loss restores revival eligibility", () => {
  let s = setup(["slifer", "ra", "obelisk", "slifer"]);
  s = command(s, { kind: "inventory", playerId: id(1), god: "slifer", amount: 2, operation: "add", note }, late);
  assert.equal(s.candidates.length, 0); assert.ok(s.rulingMessages.some(message => message.includes("实际完成时点")));
  s = command(s, { kind: "candidate_ruling", playerId: id(1), eligible: true, note: "裁判确认实际完成于时限内，现为迟录" }, late);
  assert.equal(s.candidates[0].playerId, id(1)); assert.equal(s.phase, "candidate_wait");
  s = command(s, { kind: "candidate_ruling", playerId: id(1), eligible: false, note: "复核库存登记错误，撤销本次候选认定" }, late);
  assert.equal(s.candidates.length, 0); assert.equal(s.phase, "time_up");
  let zero = setup([null, null, null, null, null, null]); const m = active(zero)[0];
  zero = result(zero, m, "a_win"); assert.equal(zero.players.find(p => p.id === m.bId)!.revivalEligible, true);
  zero = result(zero, m, "draw"); assert.equal(zero.players.find(p => p.id === m.bId)!.revivalEligible, false); assert.equal(zero.players.find(p => p.id === m.bId)!.extraLife, true);
});

test("withdrawal during a running match pauses that match for a ruling and never adds future losses or pairings", () => {
  let s = setup(["slifer", "ra", "obelisk", "slifer", "ra", "obelisk", "slifer", "ra"]); const m = active(s)[0], leaving = m.aId;
  s = command(s, { kind: "status", playerId: leaving, status: "withdrawn", note: "选手本人申请正式退赛" });
  assert.equal(s.players.find(p => p.id === leaving)!.hold, "withdrawn"); assert.equal(s.matches.find(row => row.id === m.id)!.status, "ruling_pending");
  assert.equal(s.players.find(p => p.id === leaving)!.completedMatches, 0);
  s = result(s, s.matches.find(row => row.id === m.id)!, "b_win");
  for (const pending of active(s).filter(row => row.batch === 1)) s = result(s, pending, "draw");
  assert.equal(s.matches.filter(row => row.batch > 1).some(row => [row.aId, row.bId].includes(leaving)), false);
  assert.equal(s.players.find(p => p.id === leaving)!.assignedMatches, 1); assert.equal(s.players.find(p => p.id === leaving)!.completedMatches, 1);
});

test("medals cannot close an already running revival round or leave its BO1 decision unresolved", () => {
  let s = depleted(); s = command(s, { kind: "begin_revival", note });
  assert.ok(active(s, "revival").length);
  assert.throws(() => command(s, { kind: "resolve_single", candidateIds: [], note }, late), /复活赛\/BO1裁定结束/);
  assert.equal(s.phase, "main"); assert.equal(s.awards.length, 0);
});

test("legal interleaving resolves required revival before placements and cannot start it during medal BO1", () => {
  let s = depleted();
  s = command(s, { kind: "inventory", playerId: id(1), god: "slifer", amount: 3, operation: "add", note });
  s = score(s, id(2), 10); s = score(s, id(3), 10);
  assert.throws(() => command(s, { kind: "resolve_single", candidateIds: [id(1)], note }), /先完成全场一次复活赛/);
  s = command(s, { kind: "begin_revival", note });
  for (const m of active(s, "revival")) s = result(s, m, "a_win");
  for (let i = 0; active(s, "tiebreak").length && i < 10; i++) s = result(s, active(s, "tiebreak")[0], "a_win");
  assert.equal(s.revival.status, "complete");
  s = command(s, { kind: "resolve_single", candidateIds: [id(1)], note });
  assert.equal(s.phase, "placements"); assert.ok(active(s, "tiebreak").length);
  assert.throws(() => command(s, { kind: "begin_revival", note }), /名次阶段不能新开/);
  for (let i = 0; active(s, "tiebreak").length && i < 10; i++) s = result(s, active(s, "tiebreak")[0], "a_win");
  assert.equal(s.phase, "complete"); assert.equal(s.revival.status, "complete");
  assert.ok(s.matches.every(m => m.status === "completed"));
});

test("a previously persisted interleaving cannot complete while another revival match is still running", () => {
  let s = depleted();
  for (let i = 1; i <= 6; i++) s = score(s, id(i), 100 - i * 10);
  s = command(s, { kind: "inventory", playerId: id(1), god: "slifer", amount: 3, operation: "add", note });
  s = command(s, { kind: "begin_revival", note });
  // Compatibility fixture for the old bug: an already persisted medal phase with active revival.
  s.phase = "placements"; s.selectedCandidates.all = [id(1)];
  const matches = active(s, "revival"); assert.ok(matches.length > 1);
  s = result(s, matches[0], "a_win");
  assert.equal(s.phase, "placements"); assert.equal(s.revival.status, "playing"); assert.equal(s.awards.length, 0);
  for (const m of active(s, "revival")) s = result(s, m, "a_win");
  for (let i = 0; active(s, "tiebreak").length && i < 10; i++) s = result(s, active(s, "tiebreak")[0], "a_win");
  assert.equal(s.revival.status, "complete"); assert.equal(s.phase, "complete");
  assert.ok(s.matches.every(m => m.status === "completed"));
});
