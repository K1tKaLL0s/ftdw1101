import assert from "node:assert/strict";
import { test } from "node:test";
import { tournamentCreateSchema, titleLength } from "../lib/tournaments/validation";
import { calendarCell, localEventTime } from "../lib/tournaments/dates";

const valid = () => ({ title: "校园杯", location: "活动室", format: "swiss_cut", capacity: 16, swiss_rounds: 3, top_cut: 4,
  timezone: "Asia/Shanghai", starts_at: new Date(Date.now() + 86_400_000).toISOString(),
  registration_deadline: new Date(Date.now() + 3600_000).toISOString(), tie_break_policy: "现场公开抽签", status: "published" });
test("title is trimmed, mandatory, and limited to 25 perceived characters for CJK, emoji and combining sequences", () => {
  for (const char of ["赛", "🃏", "👨‍👩‍👧‍👦", "e\u0301", "🇨🇳"]) {
    assert.equal(titleLength(`  ${char.repeat(25)}  `), 25);
    assert.equal(tournamentCreateSchema.safeParse({ ...valid(), title: char.repeat(25) }).success, true);
    assert.equal(tournamentCreateSchema.safeParse({ ...valid(), title: char.repeat(26) }).success, false);
  }
  assert.equal(tournamentCreateSchema.safeParse({ ...valid(), title: "　 \t" }).success, false);
  assert.equal(tournamentCreateSchema.parse({ ...valid(), title: " 校赛 " }).title, "校赛");
});
test("Swiss 3–7 rounds, top cut size, date ordering and capacity validated before publication", () => {
  assert.equal(tournamentCreateSchema.safeParse(valid()).success, true);
  for (const change of [{ swiss_rounds: 2 }, { swiss_rounds: 8 }, { top_cut: 3 }, { capacity: 3, top_cut: 4 },
    { capacity: 4, swiss_rounds: 7 }, { registration_deadline: new Date(Date.now() + 2 * 86_400_000).toISOString() },
    { registration_deadline: new Date(0).toISOString() }]) assert.equal(tournamentCreateSchema.safeParse({ ...valid(), ...change }).success, false);
});
test("event timezones map to the same existing Shanghai calendar and reject invalid local dates", () => {
  assert.equal(localEventTime("2026-10-24T13:30", "Asia/Shanghai"), "2026-10-24T05:30:00.000Z");
  assert.equal(localEventTime("2026-10-24T14:30", "Asia/Tokyo"), "2026-10-24T05:30:00.000Z");
  assert.deepEqual(calendarCell("2026-10-24T05:30:00Z", "2026-10-19"), { day: 5, slot: 1 });
  assert.deepEqual(calendarCell("2026-10-23T17:30:00Z", "2026-10-19"), { day: 5, slot: -1 });
  for (const [time, slot] of [["00:00", 0], ["03:00", 1], ["06:00", 2], ["09:00", 3], ["12:00", 4], ["14:00", -1]] as const)
    assert.deepEqual(calendarCell(`2026-10-24T${time}:00Z`, "2026-10-19"), { day: 5, slot });
  assert.equal(calendarCell("2026-10-27T05:30:00Z", "2026-10-19"), null);
  assert.throws(() => localEventTime("2026-02-30T12:00", "Asia/Shanghai"));
  assert.throws(() => localEventTime("2026-10-24T12:00", "invalid"));
});
