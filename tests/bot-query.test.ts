import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { authorizeBot, botDateRange, botPayload } from "../lib/bot-query";
import { getCurrentWeekKey } from "../lib/week";

const token = "test-only-bot-token-01234567890123456789";
const config = { BOT_QUERY_ENABLED: "true", BOT_QUERY_TOKEN_SHA256: createHash("sha256").update(token).digest("hex"), BOT_QUERY_ALLOWED_GROUPS: "*" };
const request = (group = "123456", auth = token, query = "range=this_week") => new Request(`https://example.test/api/bot/reservations?${query}`, { headers: { Authorization: `Bearer ${auth}`, "X-Group-Id": group } });
test("bot token is isolated, wildcard still requires authentication and a group", () => {
  assert.equal(authorizeBot(request(), config).range, "this_week");
  assert.throws(() => authorizeBot(request(), {}), { status: 503 });
  assert.throws(() => authorizeBot(request(), { ...config, BOT_QUERY_TOKEN_SHA256: "broken" }), { status: 503 });
  assert.throws(() => authorizeBot(request("123456", "wrong"), config), { status: 401 });
  assert.throws(() => authorizeBot(request(""), config), { status: 403 });
  assert.throws(() => authorizeBot(request(), { ...config, BOT_QUERY_ALLOWED_GROUPS: "999" }), { status: 403 });
  assert.equal(authorizeBot(request(), { ...config, BOT_QUERY_ALLOWED_GROUPS: "999,123456" }).range, "this_week");
  for (const query of ["range=all", "range=today&range=tomorrow", "date=2020-01-01"]) assert.throws(() => authorizeBot(request("123456", token, query), config), { status: 400 });
});
test("bot ranges follow Shanghai midnight and Sunday-to-Monday", () => {
  const sunday = new Date("2026-09-27T15:59:59Z");
  assert.deepEqual(botDateRange("this_week", sunday), { start: "2026-09-21", end: "2026-09-27" });
  assert.deepEqual(botDateRange("tomorrow", sunday), { start: "2026-09-28", end: "2026-09-28" });
  assert.deepEqual(botDateRange("next_week", sunday), { start: "2026-09-28", end: "2026-10-04" });
  assert.deepEqual(botDateRange("today", new Date("2026-09-27T16:00:00Z")), { start: "2026-09-28", end: "2026-09-28" });
});
test("bot payload keeps totals, strips identity fields, and distinguishes malformed data from empty", () => {
  const now = new Date("2026-09-25T00:00:00Z");
  const rows = [{ reservation_date: "2026-09-25", slot_index: 4, total_count: 9, members: [{ nickname: "小林[CQ:at,qq=all]", location: " ", note: "备注", user_id: "private", email: "private" }] }];
  const result = botPayload(rows, "today", now, false);
  assert.deepEqual(result.slots[0], { date: "2026-09-25", slot_index: 4, start: "20:00", end: "22:00", count: 9, members: [{ nickname: "小林", location: "皆可" }], omitted_count: 8 });
  assert.equal(result.schema_version, "1");
  assert.equal(botPayload(rows, "today", now, true).slots[0].members[0].note, "备注");
  assert.deepEqual(botPayload([], "today", now, false).slots, []);
  assert.throws(() => botPayload(null, "today", now, false));
  assert.throws(() => botPayload([...rows, ...rows], "today", now, false));
  assert.throws(() => botPayload(rows, "next_week", now, false));
});
test("bot SQL is read-only, service-only, excludes deleted/banned data and counts beyond preview", async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create table profiles(id integer primary key,status text,deleted_at timestamptz); create table marks(id integer primary key,user_id integer,week_key text,day_index integer,slot_index integer,nickname text,location text,note text,created_at timestamptz default now(),deleted_at timestamptz); grant select on profiles,marks to service_role;");
    await db.exec(await readFile("supabase/migrations/20260925115520_bot_reservation_slots.sql", "utf8"));
    const week = getCurrentWeekKey();
    for (let i = 1; i <= 9; i++) {
      await db.query("insert into profiles values($1,$2,null)", [i, i === 8 ? "banned" : "active"]);
      await db.query("insert into marks(id,user_id,week_key,day_index,slot_index,nickname,location,note,deleted_at) values($1,$1,$2,0,0,$3,'','私密备注',case when $1=9 then now() else null end)", [i, week, `牌友${i}`]);
    }
    const before = (await db.query("select count(*) from marks")).rows;
    await db.exec("set role service_role");
    const result = await db.query<{ total_count: number; members: Array<Record<string, unknown>> }>("select * from bot_reservation_slots($1::date,$1::date,5,false)", [week]);
    assert.equal(Number(result.rows[0].total_count), 7);
    assert.equal(result.rows[0].members.length, 5);
    assert.equal(result.rows[0].members[0].location, "皆可");
    assert.equal("note" in result.rows[0].members[0], false);
    await assert.rejects(db.query("select * from bot_reservation_slots($1::date,$1::date+7,5,false)", [week]), /invalid bot query bounds/);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`reset role; set role ${role}`);
      await assert.rejects(db.query("select * from bot_reservation_slots($1::date,$1::date,5,false)", [week]), /permission denied/);
    }
    await db.exec("reset role");
    assert.deepEqual((await db.query("select count(*) from marks")).rows, before);
  } finally { await db.close(); }
});
