import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { startTournament } from "../lib/tournaments/engine";
import { applyThreeGodsCommand, specialRoster, type ThreeGodsState } from "../lib/tournaments/three-gods";

let db: PGlite;
const owner = "1".repeat(64), outsider = "2".repeat(64), player = "3".repeat(64), admin = "4".repeat(64);
const tournamentMigration = "20261021081932_tournaments.sql";
let productionBefore: unknown, productionAfter: unknown;
let registrationUpgradeBefore: unknown, registrationUpgradeAfter: unknown;
async function productionSnapshot() {
  return (await db.query<{ value: unknown }>(`select jsonb_build_object(
    'profiles',(select jsonb_agg(to_jsonb(p) order by id) from public.profiles p),
    'sessions',(select jsonb_agg(to_jsonb(s) order by id) from public.app_sessions s),
    'marks',(select jsonb_agg(to_jsonb(m) order by id) from public.marks m),
    'session_context',pg_get_functiondef('public.app_get_session_context(text)'::regprocedure),
    'mark_writer',pg_get_functiondef('public.app_upsert_marks_with_note(text,text,jsonb,text)'::regprocedure)
  ) value`)).rows[0].value;
}
async function call<T>(name: string, args: unknown[]): Promise<T> {
  return (await db.query<{ value: T }>(`select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) value`, args)).rows[0].value;
}
async function create(status = "published", capacity = 8, overrides: Record<string, unknown> = {}) {
  return call<string>("app_tournament_create", [owner, JSON.stringify({ title: "测试校赛", description: "公开赛事", location: "活动室", timezone: "Asia/Shanghai",
    starts_at: new Date(Date.now() + 2 * 86_400_000).toISOString(), registration_deadline: new Date(Date.now() + 86_400_000).toISOString(),
    capacity, format: "pseudo_double", swiss_rounds: 3, top_cut: 2, tie_break_policy: "现场公开抽签", extra_rules: "", status, ...overrides })]);
}
type Detail = { tournament: { id: string; revision: number; state: unknown; special_state: ThreeGodsState | null; entry_count: number; checked_in_count: number; status: string; registration_deadline: string }; entrants: { id: string; name: string; status: string }[]; mine: string | null; canManage: boolean };
const detail = (id: string, session = owner) => call<Detail>("app_tournament_detail", [session, id]);
const registration = (id: string, session: string, action: string, name = "", entryId: string | null = null) => call<{ id: string }>("app_tournament_registration", [session, id, action, name, entryId]);
const editDeadline = (id: string, revision: number, deadline: string | null, session = owner) => call<boolean>("app_tournament_edit_registration", [session, id, revision, deadline]);
const onsite = (id: string, revision: number, name: string, checkedIn: boolean | null, session = owner) => call<{ id: string }>("app_tournament_onsite", [session, id, revision, name, checkedIn]);
const late = (id: string, revision: number, name: string, checkedIn: boolean, initialGod: string | null = "obelisk", group = "all", entryId: string | null = null, session = owner) =>
  call<{ id: string }>("app_tournament_late_entry", [session, id, revision, entryId, name, checkedIn, initialGod, group]);
const eventDay = (id: string) => db.query("update public.tournaments set starts_at=now(),registration_deadline=now() where id=$1", [id]);
async function registrationSnapshot() {
  return (await db.query<{ value: unknown }>(`select jsonb_build_object(
    'production',$1::jsonb,'tournaments',(select jsonb_agg(to_jsonb(t) order by id) from public.tournaments t),
    'entries',(select jsonb_agg(to_jsonb(e) order by id) from public.tournament_entries e)
  ) value`, [JSON.stringify(await productionSnapshot())])).rows[0].value;
}
before(async () => {
  db = new PGlite();
  await db.exec("create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text unique,raw_user_meta_data jsonb not null default '{}'::jsonb,raw_app_meta_data jsonb not null default '{}'::jsonb,created_at timestamptz not null default now());");
  await db.exec("create schema storage;create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);");
  const migrations = (await readdir("supabase/migrations")).filter(path => path.endsWith(".sql")).sort();
  for (const path of migrations.filter(path => path < tournamentMigration)) await db.exec(await readFile(`supabase/migrations/${path}`, "utf8"));
  for (let i = 1; i <= 4; i++) {
    const id = `00000000-0000-4000-8000-00000000000${i}`;
    await db.query("insert into auth.users(id,email,raw_app_meta_data) values($1,$2,$3::jsonb)", [id, `test${i}@team-slots.local`, JSON.stringify({ username: `test${i}`, device_hash: String(i).repeat(64) })]);
    await db.query("insert into public.app_sessions(user_id,token_hash,expires_at) values($1,$2,now()+interval '1 day')", [id, String(i).repeat(64)]);
  }
  await db.exec("update public.profiles set role='admin' where username='test4'");
  productionBefore = await productionSnapshot();
  await db.exec(await readFile(`supabase/migrations/${tournamentMigration}`, "utf8"));
  productionAfter = await productionSnapshot();
  // Seed real pre-upgrade account registrations (including legacy duplicate nicknames)
  // and locked normal/special state before applying the additive registration upgrade.
  const existing = await create();
  await registration(existing, owner, "join", "旧同名选手");
  await registration(existing, outsider, "join", "旧同名选手");
  await db.query("update public.tournaments set status='running',state=$2::jsonb where id=$1", [existing, JSON.stringify({ version: 1, matches: [{ id: "preserved-match", result: "a_win" }], entrants: [] })]);
  const special = await create("published", 8, { format: "three_gods" });
  await db.query("update public.tournaments set status='running',special_state=$2::jsonb where id=$1", [special, JSON.stringify({ version: 1, players: [], matches: [{ id: "preserved-special" }] })]);
  registrationUpgradeBefore = await registrationSnapshot();
  for (const path of migrations.filter(path => path > tournamentMigration)) await db.exec(await readFile(`supabase/migrations/${path}`, "utf8"));
  registrationUpgradeAfter = await registrationSnapshot();
});
after(async () => { await db.close(); });

test("the single additive tournament migration preserves production account/session data and five-slot writers", () => {
  assert.deepEqual(productionAfter, productionBefore);
});

test("registration upgrade preserves existing entries, duplicate legacy names, locked matches, accounts and sessions", () => {
  assert.deepEqual(registrationUpgradeAfter, registrationUpgradeBefore);
});

test("ordinary active users can publish; event ownership and drafts are isolated; existing admin moderation remains", async () => {
  const id = await create("draft");
  assert.equal((await detail(id)).canManage, true);
  await assert.rejects(detail(id, outsider), /not found/);
  await assert.rejects(call("app_tournament_status", [outsider, id, 0, "published", ""]), /forbidden/);
  await call("app_tournament_status", [owner, id, 0, "published", ""]);
  assert.equal((await detail(id, outsider)).canManage, false);
  assert.equal((await detail(id, admin)).canManage, true);
  await assert.rejects(call("app_tournament_status", [outsider, id, 1, "cancelled", "测试取消赛事"]), /forbidden/);
  await db.exec("update public.profiles set status='banned' where username='test1'");
  await assert.rejects(create(), /unauthenticated/);
  await db.exec("update public.profiles set status='active' where username='test1'");
});

test("registration capacity, duplicate idempotence and own-only withdrawal are transactional", async () => {
  const id = await create("published", 2);
  const a = await registration(id, outsider, "join", "小甲");
  assert.equal((await registration(id, outsider, "join", "重复昵称")).id, a.id);
  await registration(id, player, "join", "小乙");
  await assert.rejects(registration(id, owner, "join", "满员"), /full/);
  assert.equal((await detail(id)).tournament.entry_count, 2);
  await assert.rejects(registration(id, owner, "checkin", "", a.id), /event day/);
  await registration(id, outsider, "leave", "", (await detail(id, player)).mine);
  assert.equal((await detail(id, player)).entrants.find(row => row.name === "小乙")!.status, "preregistered", "a supplied different entry ID cannot withdraw someone else");
  assert.equal((await detail(id)).entrants.find(row => row.id === a.id)!.status, "withdrawn");
  await registration(id, owner, "join", "主办参赛");
  await assert.rejects(registration(id, outsider, "join", "重新报名"), /full/);
});

test("only event-day check-ins enter the pool, repeats are idempotent and late check-ins never alter pairings", async () => {
  const id = await create();
  const a = await registration(id, owner, "join", "主办"); const b = await registration(id, outsider, "join", "选手乙"); const c = await registration(id, player, "join", "未报到");
  await assert.rejects(registration(id, outsider, "checkin", "", b.id), /forbidden/);
  await db.query("update public.tournaments set starts_at=now(),registration_deadline=now() where id=$1", [id]);
  await registration(id, owner, "checkin", "", a.id); await registration(id, owner, "checkin", "", b.id);
  const first = await detail(id); await registration(id, owner, "checkin", "", b.id);
  assert.equal((await detail(id)).tournament.revision, first.tournament.revision, "repeat check-in is idempotent");
  assert.equal(first.tournament.entry_count, 3); assert.equal(first.tournament.checked_in_count, 2);
  const fake = startTournament({ format: "pseudo_double", swissRounds: 3, topCut: 2 }, first.entrants.map((entry, i) => ({ id: entry.id, name: entry.name, seed: i + 1, active: true })));
  await assert.rejects(call("app_tournament_commit", [owner, id, first.tournament.revision, JSON.stringify(fake), "start"]), /only checked-in/);
  const state = startTournament({ format: "pseudo_double", swissRounds: 3, topCut: 2 }, first.entrants.filter(entry => entry.status === "checked_in").map((entry, i) => ({ id: entry.id, name: entry.name, seed: i + 1, active: true })));
  await assert.rejects(call("app_tournament_commit", [outsider, id, first.tournament.revision, JSON.stringify(state), "start"]), /forbidden/);
  await call("app_tournament_commit", [owner, id, first.tournament.revision, JSON.stringify(state), "start"]);
  await assert.rejects(registration(id, owner, "checkin", "", c.id), /event day before start/);
  await assert.rejects(registration(id, outsider, "leave"), /after start/);
  assert.deepEqual((await detail(id)).tournament.state, state);
  await assert.rejects(call("app_tournament_commit", [owner, id, first.tournament.revision, JSON.stringify(state), "start"]), /revision conflict/);
});

test("payloads omit owner/account IDs and credentials; direct anon/authenticated tables and RPCs are denied", async () => {
  const id = await create(); await registration(id, player, "join", "显示昵称");
  const exposed = JSON.stringify(await detail(id, player));
  assert.equal(/owner_id|user_id|auth_email|token_hash|@team-slots\.local|00000000-0000-4000-8000/.test(exposed), false);
  for (const role of ["anon", "authenticated"]) {
    const result = (await db.query<{ access: boolean; rpc: boolean }>("select has_table_privilege($1,'public.tournaments','select') access,has_function_privilege($1,'public.app_tournament_detail(text,uuid)','execute') rpc", [role])).rows[0];
    assert.equal(result.access, false); assert.equal(result.rpc, false);
    await db.exec("begin");
    try { await db.exec(`set local role ${role}`); await assert.rejects(db.query("select * from public.tournament_entries"), /permission denied/); }
    finally { await db.exec("rollback"); }
  }
  assert.equal((await db.query<{ enabled: boolean }>("select bool_and(relrowsecurity) enabled from pg_class where relname in ('tournaments','tournament_entries')")).rows[0].enabled, true);
});

test("cancelling an unpublished draft stays private; cancelling a published event remains a public announcement", async () => {
  const draft = await create("draft"); await call("app_tournament_status", [owner, draft, 0, "cancelled", "草稿取消保持私有"]);
  await assert.rejects(detail(draft, outsider), /not found/);
  const listed = await call<{ items: { id: string }[] }>("app_tournament_list", [outsider, 0, null]); assert.equal(listed.items.some(t => t.id === draft), false);
  assert.equal((await detail(draft)).tournament.status, "cancelled");
  const published = await create(); await call("app_tournament_status", [owner, published, 0, "cancelled", "已公开赛事取消公告"]);
  assert.equal((await detail(published, outsider)).tournament.status, "cancelled");
  const after = await call<{ items: { id: string }[] }>("app_tournament_list", [outsider, 0, null]); assert.equal(after.items.some(t => t.id === published), true);
});

test("special roster is checked-in only; score/card transaction has revision protection and durable idempotency", async () => {
  const id = await create("published", 8, { format: "three_gods", special_grouping: "single" });
  const a = await registration(id, owner, "join", "神甲"), b = await registration(id, outsider, "join", "神乙"); await registration(id, player, "join", "未报到丙");
  await db.query("update public.tournaments set starts_at=now(),registration_deadline=now() where id=$1", [id]);
  await registration(id, owner, "checkin", "", a.id); await registration(id, owner, "checkin", "", b.id);
  let d = await detail(id), s = specialRoster("single", d.entrants.filter(e => e.status === "checked_in"));
  await assert.rejects(call("app_tournament_special_start", [outsider, id, d.tournament.revision, JSON.stringify(s)]), /forbidden/);
  const forged = specialRoster("single", d.entrants); await assert.rejects(call("app_tournament_special_start", [owner, id, d.tournament.revision, JSON.stringify(forged)]), /only checked-in/);
  await call("app_tournament_special_start", [owner, id, d.tournament.revision, JSON.stringify(s)]);
  let serial = 50;
  const save = async (c: Parameters<typeof applyThreeGodsCommand>[2]) => {
    d = await detail(id); const key = `50000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`;
    s = applyThreeGodsCommand(d.tournament.special_state!, key, c, () => 0.5, "2026-10-24T05:30:00Z");
    await call("app_tournament_special_commit", [owner, id, d.tournament.revision, JSON.stringify(s), key, s.commands[key]]); return { key, revision: d.tournament.revision };
  };
  await save({ kind: "initial", playerId: a.id, group: "all", initialGod: "slifer", note: "现场核对初始神" });
  await save({ kind: "initial", playerId: b.id, group: "all", initialGod: "ra", note: "现场核对初始神" });
  await save({ kind: "begin_main", note: "名单与库存核对完成启动" });
  const m = s.matches[0], replay = await save({ kind: "result", matchId: m.id, outcome: "a_win", aWins: 2, bWins: 1, note: "裁判核对最终结果" });
  const before = await detail(id);
  await call("app_tournament_special_commit", [owner, id, replay.revision, JSON.stringify(s), replay.key, s.commands[replay.key]]);
  const after = await detail(id); assert.equal(after.tournament.revision, before.tournament.revision);
  assert.deepEqual(after.tournament.special_state, before.tournament.special_state);
  assert.equal(after.tournament.special_state!.players.reduce((sum, p) => sum + p.points, 0), 5);
  assert.equal(after.tournament.special_state!.players.reduce((sum, p) => sum + Object.values(p.stock).reduce((a, b) => a + b, 0), 0), 2);
  await assert.rejects(call("app_tournament_special_commit", [outsider, id, after.tournament.revision, JSON.stringify(s), replay.key, s.commands[replay.key]]), /forbidden/);
});

test("all main results must be registered before the next batch and concurrent last results cannot duplicate it", async () => {
  const id = await create("published", 8, { format: "three_gods", special_grouping: "single" });
  await eventDay(id);
  for (let i = 1; i <= 4; i++) await onsite(id, (await detail(id)).tournament.revision, `完整轮次选手${i}`, true);
  let d = await detail(id);
  await call("app_tournament_special_start", [owner, id, d.tournament.revision, JSON.stringify(specialRoster("single", d.entrants))]);
  let serial = 100;
  const key = () => `52000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`;
  const save = async (command: Parameters<typeof applyThreeGodsCommand>[2]) => {
    d = await detail(id); const commandId = key();
    const state = applyThreeGodsCommand(d.tournament.special_state!, commandId, command, () => 0.5);
    await call("app_tournament_special_commit", [owner, id, d.tournament.revision, JSON.stringify(state), commandId, state.commands[commandId]]);
  };
  for (const entry of d.entrants) await save({ kind: "initial", playerId: entry.id, initialGod: "slifer", group: "all", note: "现场确认初始幻神" });
  await save({ kind: "begin_main", note: "确认全部选手开启正赛" });
  d = await detail(id); const first = d.tournament.special_state!.matches;
  assert.equal(first.length, 2);
  await save({ kind: "result", matchId: first[0].id, outcome: "draw", aWins: 0, bWins: 0, note: "确认第一场最终结果" });
  d = await detail(id); const original = d.tournament.special_state!;
  assert.equal(original.batches.all, 1);
  assert.throws(() => applyThreeGodsCommand(original, key(), { kind: "pair", group: "all", note: "直接请求下一轮配对" }, () => 0.5), /未完成|结果登记/);
  assert.deepEqual((await detail(id)).tournament.special_state, original);
  const finalResult = { kind: "result" as const, matchId: first[1].id, outcome: "draw" as const, aWins: 0, bWins: 0, note: "确认最后一场最终结果" };
  const firstKey = key(), secondKey = key();
  const next = applyThreeGodsCommand(original, firstKey, finalResult, () => 0.5);
  const concurrent = applyThreeGodsCommand(original, secondKey, finalResult, () => 0.5);
  assert.equal(next.batches.all, 2);
  assert.ok(next.matches.filter(m => m.batch === 1).every(m => m.status === "completed" && m.result));
  await call("app_tournament_special_commit", [owner, id, d.tournament.revision, JSON.stringify(next), firstKey, next.commands[firstKey]]);
  await assert.rejects(call("app_tournament_special_commit", [owner, id, d.tournament.revision, JSON.stringify(concurrent), secondKey, concurrent.commands[secondKey]]), /revision conflict/);
  await call("app_tournament_special_commit", [owner, id, d.tournament.revision, JSON.stringify(next), firstKey, next.commands[firstKey]]);
  const persisted = await detail(id);
  assert.equal(persisted.tournament.revision, d.tournament.revision + 1);
  assert.deepEqual(persisted.tournament.special_state, next);
});

test("only organizer/admin may close or reopen registration before pool locking, with revision and schedule checks", async () => {
  const id = await create();
  const existing = await registration(id, player, "join", "保留报名");
  const before = await detail(id);
  const future = new Date(Date.now() + 3600_000).toISOString();
  await assert.rejects(editDeadline(id, before.tournament.revision, future, outsider), /forbidden/);
  await assert.rejects(editDeadline(id, before.tournament.revision - 1, future), /revision conflict/);
  for (const invalid of [null, "infinity", new Date(Date.now() + 3 * 86_400_000).toISOString()]) {
    await assert.rejects(editDeadline(id, before.tournament.revision, invalid), /deadline/);
  }
  await editDeadline(id, before.tournament.revision, new Date(0).toISOString());
  await assert.rejects(registration(id, outsider, "join", "已截止"), /registration closed/);
  const closed = await detail(id);
  assert.deepEqual(closed.entrants, before.entrants);
  assert.equal(closed.entrants[0].id, existing.id);
  assert.equal(closed.tournament.state, before.tournament.state);
  await editDeadline(id, closed.tournament.revision, future, admin);
  await registration(id, outsider, "join", "重新开放后报名");
  const reopened = await detail(id);
  assert.equal(Date.parse(reopened.tournament.registration_deadline), Date.parse(future));
  const revision = reopened.tournament.revision;
  await editDeadline(id, revision, future);
  assert.equal((await detail(id)).tournament.revision, revision, "saving the unchanged cutoff is a no-op");
  const draft = await create("draft");
  await editDeadline(draft, 0, future);
  for (const status of ["running", "completed", "cancelled"]) {
    await db.query("update public.tournaments set status=$2 where id=$1", [draft, status]);
    await assert.rejects(editDeadline(draft, 1, future), /locked after start/);
  }
  await db.query("update public.tournaments set status='published',special_state='{}'::jsonb where id=$1", [draft]);
  await assert.rejects(editDeadline(draft, 1, future), /locked after start/);
  await db.exec("update public.profiles set status='banned' where username='test1'");
  try { await assert.rejects(editDeadline(id, revision, future), /unauthenticated/); }
  finally { await db.exec("update public.profiles set status='active' where username='test1'"); }
  const audit = await db.query<{ n: number }>("select count(*)::int n from public.audit_log where action='tournament_edit_registration' and reason like $1", [id + "%"]);
  assert.equal(audit.rows[0].n, 2, "cutoff changes record actor and old/new times, while unchanged saves do not");
});

test("onsite registration is event-day organizer-only, explicit about check-in, and serializes duplicates/capacity", async () => {
  const id = await create("published", 3);
  const existing = await registration(id, player, "join", "PreRegistered");
  await assert.rejects(onsite(id, 1, "Guest", true), /event day/);
  await eventDay(id);
  await assert.rejects(onsite(id, 1, "Guest", true, outsider), /forbidden/);
  await assert.rejects(onsite(id, 0, "Guest", true), /revision conflict/);
  await assert.rejects(onsite(id, 1, "Guest", null), /invalid onsite entry/);
  await assert.rejects(onsite(id, 1, " preregistered ", true), /duplicate entry name/);
  assert.equal((await detail(id)).entrants.find(e => e.id === existing.id)!.status, "preregistered", "duplicate submission cannot silently check in an existing player");
  const guest = await onsite(id, 1, "Alice", false);
  assert.equal((await detail(id)).entrants.find(e => e.id === guest.id)!.status, "preregistered");
  const stored = (await db.query<{ user_id: string | null; checked_in_at: string | null }>("select user_id,checked_in_at from public.tournament_entries where id=$1", [guest.id])).rows[0];
  assert.deepEqual(stored, { user_id: null, checked_in_at: null });
  await assert.rejects(onsite(id, 1, "Alice", false), /revision conflict/, "replaying the successful revision cannot create another guest");
  await assert.rejects(onsite(id, 2, " ＡＬＩＣＥ ", true), /duplicate entry name/);
  const outcomes = await Promise.allSettled([onsite(id, 2, "最后名额甲", true, admin), onsite(id, 2, "最后名额乙", true)]);
  assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter(outcome => outcome.status === "rejected").length, 1);
  const full = await detail(id);
  assert.equal(full.tournament.entry_count, 3);
  assert.equal(full.tournament.checked_in_count, 1);
  await assert.rejects(onsite(id, full.tournament.revision, "超额者", true), /full/);
  await registration(id, owner, "checkin", "", guest.id);
  assert.equal((await detail(id)).tournament.checked_in_count, 2, "pending onsite players use the existing deliberate check-in action");
  const snapshot = await detail(id);
  await db.exec("update public.profiles set status='banned' where username='test1'");
  try { await assert.rejects(onsite(id, snapshot.tournament.revision, "被禁用主办操作", true), /unauthenticated/); }
  finally { await db.exec("update public.profiles set status='active' where username='test1'"); }
  assert.deepEqual(await detail(id), snapshot);
  const audit = await db.query<{ n: number }>("select count(*)::int n from public.audit_log where action='tournament_onsite' and reason like $1", [id + "%"]);
  assert.equal(audit.rows[0].n, 2);
});

test("regular registration cannot duplicate onsite guest names; drafts, other dates and locked pools reject onsite writes", async () => {
  const id = await create();
  await eventDay(id);
  await onsite(id, 0, "ReservedGuest", true);
  // Set a future cutoff only for this join collision test; no event-day boundary depends on this change.
  await db.query("update public.tournaments set starts_at=now()+interval '1 day',registration_deadline=now()+interval '1 hour' where id=$1", [id]);
  await assert.rejects(registration(id, player, "join", " reservedguest "), /duplicate entry name/);
  assert.equal((await detail(id)).tournament.entry_count, 1);
  await assert.rejects(onsite(id, 1, "NextDay", true), /event day/);
  await eventDay(id);
  for (const status of ["draft", "running", "completed", "cancelled"]) {
    await db.query("update public.tournaments set status=$2 where id=$1", [id, status]);
    await assert.rejects(onsite(id, 1, "不应添加", true), /locked after start/);
  }
  await db.query("update public.tournaments set status='published',state='{}'::jsonb where id=$1", [id]);
  await assert.rejects(onsite(id, 1, "不应添加", true), /locked after start/);
  await db.query("update public.tournaments set state=null,special_state='{}'::jsonb where id=$1", [id]);
  await assert.rejects(onsite(id, 1, "不应添加", true), /locked after start/);
});

test("onsite players enter normal and special pools only after check-in, and locked matches remain unchanged", async () => {
  for (const format of ["pseudo_double", "three_gods"]) {
    const id = await create("published", 8, { format });
    await eventDay(id);
    const first = await onsite(id, 0, "现场已报到甲", true);
    const pending = await onsite(id, 1, "现场待报到乙", false);
    const second = await onsite(id, 2, "现场已报到丙", true);
    const d = await detail(id);
    const checkedIn = d.entrants.filter(e => e.status === "checked_in");
    assert.deepEqual(checkedIn.map(e => e.id).sort(), [first.id, second.id].sort());
    if (format === "three_gods") {
      const forged = specialRoster("single", d.entrants);
      await assert.rejects(call("app_tournament_special_start", [owner, id, d.tournament.revision, JSON.stringify(forged)]), /only checked-in/);
      await call("app_tournament_special_start", [owner, id, d.tournament.revision, JSON.stringify(specialRoster("single", checkedIn))]);
    } else {
      const state = startTournament({ format: "pseudo_double", swissRounds: 3, topCut: 2 }, checkedIn.map((e, i) => ({ id: e.id, name: e.name, seed: i + 1, active: true })));
      await call("app_tournament_commit", [owner, id, d.tournament.revision, JSON.stringify(state), "start"]);
    }
    const locked = await detail(id);
    await assert.rejects(onsite(id, locked.tournament.revision, "迟到补录", true), /locked after start/);
    await assert.rejects(editDeadline(id, locked.tournament.revision, new Date(0).toISOString()), /locked after start/);
    await assert.rejects(registration(id, owner, "checkin", "", pending.id), /event day before start/);
    assert.deepEqual(await detail(id), locked);
  }
});

test("new registration RPCs stay service-only and require a valid opaque application session", async () => {
  const id = await create();
  await assert.rejects(editDeadline(id, 0, new Date(0).toISOString(), "f".repeat(64)), /unauthenticated/);
  await assert.rejects(onsite(id, 0, "无效会话", true, "f".repeat(64)), /unauthenticated/);
  await db.query("update public.app_sessions set revoked_at=now() where token_hash=$1", [owner]);
  try {
    await assert.rejects(editDeadline(id, 0, new Date(0).toISOString()), /unauthenticated/);
    await assert.rejects(onsite(id, 0, "已撤销会话", true), /unauthenticated/);
  } finally { await db.query("update public.app_sessions set revoked_at=null where token_hash=$1", [owner]); }
  for (const signature of ["public.app_tournament_edit_registration(text,uuid,integer,timestamptz)", "public.app_tournament_onsite(text,uuid,integer,text,boolean)"]) {
    for (const role of ["anon", "authenticated", "service_role"]) {
      const privilege = await db.query<{ allowed: boolean }>("select has_function_privilege($1,$2,'execute') allowed", [role, signature]);
      assert.equal(privilege.rows[0].allowed, role === "service_role");
    }
  }
});

async function lateFixture(capacity = 8, grouping: "single" | "ab" = "single", startMain = true) {
  const id = await create("published", capacity, { format: "three_gods", special_grouping: grouping });
  const sessions = grouping === "ab" ? [owner, outsider, player, admin] : [owner, outsider];
  const people = [];
  for (let i = 0; i < sessions.length; i++) people.push(await registration(id, sessions[i], "join", `开赛选手${i + 1}`));
  const pending = grouping === "single" && capacity > 2 ? await registration(id, player, "join", "原待报到选手") : null;
  await eventDay(id);
  for (const entry of people) await registration(id, owner, "checkin", "", entry.id);
  let d = await detail(id), state = specialRoster(grouping, d.entrants.filter(e => e.status === "checked_in"));
  await call("app_tournament_special_start", [owner, id, d.tournament.revision, JSON.stringify(state)]);
  let serial = 800;
  const save = async (command: Parameters<typeof applyThreeGodsCommand>[2]) => {
    d = await detail(id); const key = `90000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`;
    state = applyThreeGodsCommand(d.tournament.special_state!, key, command, () => 0.5);
    await call("app_tournament_special_commit", [owner, id, d.tournament.revision, JSON.stringify(state), key, state.commands[key]]);
  };
  for (let i = 0; i < people.length; i++) await save({ kind: "initial", playerId: people[i].id, initialGod: "slifer", group: grouping === "single" ? "all" : i < 2 ? "A" : "B", note: "现场确认初始神与分组" });
  if (startMain) await save({ kind: "begin_main", note: "现场正式启动正赛配对" });
  return { id, pending, detail: await detail(id) };
}

test("late admission preserves live matches and appends only checked-in players for future real pairing", async () => {
  const f = await lateFixture(); const id = f.id; const original = f.detail.tournament.special_state!;
  const pending = await late(id, f.detail.tournament.revision, "补录待报到", false, null);
  let d = await detail(id);
  assert.deepEqual(d.tournament.special_state, original, "pending registration cannot enter or alter the running pool");
  assert.equal(d.entrants.find(e => e.id === pending.id)!.status, "preregistered");
  const arrived = await late(id, d.tournament.revision, "补录已到场", true, "obelisk");
  d = await detail(id); let state = d.tournament.special_state!;
  const newcomer = state.players.find(p => p.id === arrived.id)!;
  assert.equal(newcomer.initialAssigned, true); assert.equal(newcomer.initialGod, "obelisk");
  assert.deepEqual(newcomer.stock, { slifer: 0, obelisk: 1, ra: 0 });
  assert.equal(newcomer.points, 0); assert.equal(newcomer.revivalPoints, 0);
  assert.equal(newcomer.assignedMatches, 0); assert.equal(newcomer.completedMatches, 0);
  assert.equal(newcomer.mainMatches, 0); assert.equal(newcomer.initialArrangements, 0);
  assert.equal(newcomer.revivalEligible, false); assert.equal(newcomer.extraLife, false);
  assert.deepEqual(state.matches, original.matches); assert.deepEqual(state.batchRecords, original.batchRecords);
  assert.deepEqual(state.players.slice(0, original.players.length), original.players);
  assert.equal(state.startsAt, original.startsAt); assert.equal(state.deadlineAt, original.deadlineAt);
  assert.deepEqual(state.revival, original.revival);
  assert.equal(state.events.at(-1)!.kind, "late_entry");
  await late(id, d.tournament.revision, "", true, null, "all", f.pending!.id);
  d = await detail(id); state = d.tournament.special_state!;
  const noCard = state.players.find(p => p.id === f.pending!.id)!;
  assert.equal(noCard.extraLife, true); assert.equal(noCard.zeroBonusGranted, true);
  assert.equal(noCard.revivalEligible, false); assert.equal(noCard.initialArrangements, 0);
  assert.deepEqual(state.matches, original.matches);
  const oldMatch = original.matches[0], key = "90000000-0000-4000-8000-000000009001";
  const stale = applyThreeGodsCommand(original, key, { kind: "result", matchId: oldMatch.id, outcome: "a_win", aWins: 2, bWins: 0, note: "现场确认最终比分" }, () => 0.5);
  await assert.rejects(call("app_tournament_special_commit", [owner, id, f.detail.tournament.revision, JSON.stringify(stale), key, stale.commands[key]]), /revision conflict/);
  const next = applyThreeGodsCommand(state, key, { kind: "result", matchId: oldMatch.id, outcome: "a_win", aWins: 2, bWins: 0, note: "现场确认最终比分" }, () => 0.5);
  assert.equal(next.matches[0].aId, oldMatch.aId); assert.equal(next.matches[0].bId, oldMatch.bId);
  assert.equal(next.matches[0].result!.aPoints, 4);
  assert.ok(next.matches.slice(original.matches.length).some(m => [m.aId, m.bId].includes(arrived.id)), "the newcomer participates only when the engine creates its next batch");
  await call("app_tournament_special_commit", [owner, id, d.tournament.revision, JSON.stringify(next), key, next.commands[key]]);
  assert.deepEqual((await detail(id)).tournament.special_state, next);
  const committed = await detail(id);
  await late(id, committed.tournament.revision, "已有赛果后补录", true, "ra");
  assert.deepEqual((await detail(id)).tournament.special_state!.matches, next.matches, "both completed and currently running matches remain byte-for-byte equivalent");
});

test("late admission enforces ownership, duplicate/capacity and revision checks without duplicate pool entries", async () => {
  const f = await lateFixture(5); const id = f.id; let d = f.detail;
  await assert.rejects(late(id, d.tournament.revision, "越权补录", true, null, "all", null, outsider), /forbidden/);
  await assert.rejects(late(id, d.tournament.revision, "开赛选手1", true), /duplicate entry name/);
  await assert.rejects(late(id, d.tournament.revision, "配置不符", true, "obelisk", "A"), /invalid late entry configuration/);
  await late(id, d.tournament.revision, "AliceLate", false);
  await assert.rejects(late(id, d.tournament.revision, "AliceLate", false), /revision conflict/);
  d = await detail(id);
  await assert.rejects(late(id, d.tournament.revision, " ＡＬＩＣＥＬＡＴＥ ", true), /duplicate entry name/);
  const outcomes = await Promise.allSettled([late(id, d.tournament.revision, "最后名额甲", true), late(id, d.tournament.revision, "最后名额乙", true, "ra", "all", null, admin)]);
  assert.equal(outcomes.filter(r => r.status === "fulfilled").length, 1);
  d = await detail(id); assert.equal(d.tournament.entry_count, 5);
  await assert.rejects(late(id, d.tournament.revision, "超额补录", true), /full/);
  await late(id, d.tournament.revision, "", true, null, "all", f.pending!.id);
  d = await detail(id);
  await assert.rejects(late(id, d.tournament.revision, "", true, null, "all", f.pending!.id), /already checked in/);
  assert.equal(d.tournament.special_state!.players.filter(p => p.id === f.pending!.id).length, 1);
  assert.equal(d.tournament.checked_in_count, 4);
  const grants = await db.query<{ anon: boolean; authenticated: boolean; service: boolean }>(`select
    has_function_privilege('anon','public.app_tournament_late_entry(text,uuid,integer,uuid,text,boolean,text,text)','execute') anon,
    has_function_privilege('authenticated','public.app_tournament_late_entry(text,uuid,integer,uuid,text,boolean,text,text)','execute') authenticated,
    has_function_privilege('service_role','public.app_tournament_late_entry(text,uuid,integer,uuid,text,boolean,text,text)','execute') service`);
  assert.deepEqual(grants.rows[0], { anon: false, authenticated: false, service: true });
});

test("late admission rejects fixed brackets, closed revival/medal/time windows and stopped groups", async () => {
  const normal = await create();
  await assert.rejects(late(normal, 0, "固定签表不追加", true), /unsupported format/);
  const f = await lateFixture(); const id = f.id; const saved = f.detail;
  for (const change of [
    { phase: "candidate_wait" }, { phase: "placements" }, { phase: "finals" }, { phase: "complete" },
    { revival: { ...saved.tournament.special_state!.revival, status: "playing" } },
    { deadlineAt: new Date(0).toISOString() }, { deadlineAt: null },
    { stoppedGroups: ["all"] }, { selectedCandidates: { all: [] } },
  ]) {
    const changed = { ...saved.tournament.special_state!, ...change };
    await db.query("update public.tournaments set special_state=$2::jsonb where id=$1", [id, JSON.stringify(changed)]);
    await assert.rejects(late(id, saved.tournament.revision, "窗口关闭不追加", true), /window closed/);
  }
  await db.query("update public.tournaments set special_state=$2::jsonb,starts_at=now()-interval '1 day',registration_deadline=now()-interval '1 day' where id=$1", [id, JSON.stringify(saved.tournament.special_state)]);
  await assert.rejects(late(id, saved.tournament.revision, "异日不追加", true), /only on event day/);
  const ab = await lateFixture(8, "ab");
  const s = { ...ab.detail.tournament.special_state!, stoppedGroups: ["A"] };
  await db.query("update public.tournaments set special_state=$2::jsonb where id=$1", [ab.id, JSON.stringify(s)]);
  await assert.rejects(late(ab.id, ab.detail.tournament.revision, "A组已停止", true, "ra", "A"), /window closed/);
  const entry = await late(ab.id, ab.detail.tournament.revision, "B组仍可补录", true, "ra", "B");
  const after = await detail(ab.id);
  assert.equal(after.tournament.special_state!.players.find(p => p.id === entry.id)!.group, "B");
  assert.deepEqual(after.tournament.special_state!.matches, s.matches);
  const setup = await lateFixture(8, "single", false);
  await late(setup.id, setup.detail.tournament.revision, "锁池未匹配补录", true, null);
  const setupAfter = await detail(setup.id);
  assert.equal(setupAfter.tournament.special_state!.phase, "setup");
  assert.equal(setupAfter.tournament.special_state!.matches.length, 0);
  assert.equal(setupAfter.tournament.special_state!.players.at(-1)!.extraLife, true);
});
