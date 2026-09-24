import assert from "node:assert/strict";
import { test } from "node:test";
import { DAY_LABELS, getCurrentSlotIndex, SCHEDULE_SLOTS, SLOT_COUNT, WEEK_CELL_COUNT } from "../lib/schedule";
import { formatShanghaiClock, getCurrentWeekKey, getShanghaiDateKey, getShanghaiDayIndex } from "../lib/week";

test("schedule has five contiguous Shanghai-time windows from 08:00 through 22:00", () => {
  assert.deepEqual(SCHEDULE_SLOTS.map((slot) => slot.label), [
    "08:00–11:00", "11:00–14:00", "14:00–17:00", "17:00–20:00", "20:00–22:00",
  ]);
  assert.equal(SLOT_COUNT, 5);
  assert.equal(WEEK_CELL_COUNT, 35);
  assert.equal(DAY_LABELS.length * SLOT_COUNT, 35);
  assert.equal(SCHEDULE_SLOTS[0].startMinute, 480);
  assert.equal(SCHEDULE_SLOTS.at(-1)?.endMinute, 1320);
  for (let index = 1; index < SLOT_COUNT; index += 1) {
    assert.equal(SCHEDULE_SLOTS[index - 1].endMinute, SCHEDULE_SLOTS[index].startMinute);
  }
});

test("current schedule slot uses Shanghai wall time and half-open boundaries", () => {
  const cases: [string, number][] = [
    ["2026-09-24T07:59:00+08:00", -1],
    ["2026-09-24T08:00:00+08:00", 0],
    ["2026-09-24T10:59:59+08:00", 0],
    ["2026-09-24T11:00:00+08:00", 1],
    ["2026-09-24T14:00:00+08:00", 2],
    ["2026-09-24T17:00:00+08:00", 3],
    ["2026-09-24T20:00:00+08:00", 4],
    ["2026-09-24T21:59:00+08:00", 4],
    ["2026-09-24T22:00:00+08:00", -1],
  ];
  for (const [value, expected] of cases) assert.equal(getCurrentSlotIndex(new Date(value)), expected, value);
  assert.equal(getCurrentSlotIndex(new Date(Number.NaN)), -1);
});

test("Shanghai date, week, and clock are invariant to the input timezone notation", () => {
  const sundayBefore = new Date("2026-09-27T15:59:00Z");
  const sundayInTokyoNotation = new Date("2026-09-28T00:59:00+09:00");
  assert.equal(sundayBefore.getTime(), sundayInTokyoNotation.getTime());
  assert.equal(getShanghaiDateKey(sundayBefore), "2026-09-27");
  assert.equal(getShanghaiDateKey(sundayInTokyoNotation), "2026-09-27");
  assert.equal(getCurrentWeekKey(sundayBefore), "2026-09-21");
  assert.equal(getShanghaiDayIndex(sundayBefore), 6);
  assert.equal(formatShanghaiClock(sundayBefore), "23:59:00");

  const mondayAfter = new Date("2026-09-27T16:00:00Z");
  const mondayInTokyoNotation = new Date("2026-09-28T01:00:00+09:00");
  assert.equal(mondayAfter.getTime(), mondayInTokyoNotation.getTime());
  assert.equal(getShanghaiDateKey(mondayAfter), "2026-09-28");
  assert.equal(getCurrentWeekKey(mondayAfter), "2026-09-28");
  assert.equal(getShanghaiDayIndex(mondayAfter), 0);
  assert.equal(formatShanghaiClock(mondayInTokyoNotation), "00:00:00");
});
