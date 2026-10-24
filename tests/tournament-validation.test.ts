import assert from "node:assert/strict";
import { test } from "node:test";
import { tournamentActionSchema, tournamentCreateSchema, titleLength } from "../lib/tournaments/validation";
import { calendarCell, localEventTime } from "../lib/tournaments/dates";

const valid = () => ({ title: "校园杯", location: "活动室", format: "swiss_cut", capacity: 16, swiss_rounds: 3, top_cut: 4,
  timezone: "Asia/Shanghai", starts_at: new Date(Date.now() + 86_400_000).toISOString(),
  registration_deadline: new Date(Date.now() + 3600_000).toISOString(), tie_break_policy: "现场公开抽签", status: "published" });
test("late entry commands require explicit initial issuance, group, revision and check-in state", () => {
  const entryId = "90000000-0000-4000-8000-000000000001";
  const command = { action: "late_onsite", revision: 1, name: " 晚到选手 ", checkedIn: false, initialGod: null, group: "all" };
  assert.equal(tournamentActionSchema.parse(command).action, "late_onsite");
  assert.equal(tournamentActionSchema.safeParse({ action: "late_checkin", revision: 1, entryId, initialGod: "ra", group: "B" }).success, true);
  for (const change of [{ checkedIn: undefined }, { initialGod: undefined }, { initialGod: "invented" }, { group: "C" }, { revision: -1 }, { name: " " }]) {
    assert.equal(tournamentActionSchema.safeParse({ ...command, ...change }).success, false);
  }
  assert.equal(tournamentActionSchema.safeParse({ action: "late_checkin", revision: 1, entryId, group: "all" }).success, false);
});
test("registration edits require an offset timestamp and revision; onsite check-in must be explicit", () => {
  assert.equal(tournamentActionSchema.safeParse({ action: "edit_registration", revision: 0, registration_deadline: "2026-10-24T12:00:00+08:00" }).success, true);
  // Past cutoffs are useful for immediately closing registration; ordering is checked against the locked event in SQL.
  assert.equal(tournamentActionSchema.safeParse({ action: "edit_registration", revision: 0, registration_deadline: new Date(0).toISOString() }).success, true);
  for (const value of ["invalid", "2026-10-24T12:00", "2026-02-30T12:00:00Z"]) {
    assert.equal(tournamentActionSchema.safeParse({ action: "edit_registration", revision: 0, registration_deadline: value }).success, false);
  }
  assert.equal(tournamentActionSchema.safeParse({ action: "edit_registration", registration_deadline: valid().registration_deadline }).success, false);
  assert.deepEqual(tournamentActionSchema.parse({ action: "onsite", revision: 2, name: " 现场甲 ", checkedIn: false }), { action: "onsite", revision: 2, name: "现场甲", checkedIn: false });
  for (const change of [{ checkedIn: undefined }, { checkedIn: "true" }, { name: "  " }, { name: "人".repeat(31) }, { revision: -1 }]) {
    assert.equal(tournamentActionSchema.safeParse({ action: "onsite", revision: 0, name: "现场甲", checkedIn: true, ...change }).success, false);
  }
});
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
