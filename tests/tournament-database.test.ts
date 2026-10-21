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
type Detail = { tournament: { id: string; revision: number; state: unknown; special_state: ThreeGodsState | null; entry_count: number; checked_in_count: number; status: string }; entrants: { id: string; name: string; status: string }[]; mine: string | null; canManage: boolean };
const detail = (id: string, session = owner) => call<Detail>("app_tournament_detail", [session, id]);
const registration = (id: string, session: string, action: string, name = "", entryId: string | null = null) => call<{ id: string }>("app_tournament_registration", [session, id, action, name, entryId]);
before(async () => {
  db = new PGlite();
  await db.exec("create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text unique,raw_user_meta_data jsonb not null default '{}'::jsonb,raw_app_meta_data jsonb not null default '{}'::jsonb,created_at timestamptz not null default now());");
  await db.exec("create schema storage;create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);");
  const migrations = (await readdir("supabase/migrations")).filter(path => path.endsWith(".sql") && path !== tournamentMigration).sort();
  for (const path of migrations) await db.exec(await readFile(`supabase/migrations/${path}`, "utf8"));
  for (let i = 1; i <= 4; i++) {
    const id = `00000000-0000-4000-8000-00000000000${i}`;
    await db.query("insert into auth.users(id,email,raw_app_meta_data) values($1,$2,$3::jsonb)", [id, `test${i}@team-slots.local`, JSON.stringify({ username: `test${i}`, device_hash: String(i).repeat(64) })]);
    await db.query("insert into public.app_sessions(user_id,token_hash,expires_at) values($1,$2,now()+interval '1 day')", [id, String(i).repeat(64)]);
  }
  await db.exec("update public.profiles set role='admin' where username='test4'");
  productionBefore = await productionSnapshot();
  await db.exec(await readFile(`supabase/migrations/${tournamentMigration}`, "utf8"));
  productionAfter = await productionSnapshot();
});
after(async () => { await db.close(); });

test("the single additive tournament migration preserves production account/session data and five-slot writers", () => {
  assert.deepEqual(productionAfter, productionBefore);
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
