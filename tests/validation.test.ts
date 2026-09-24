import assert from "node:assert/strict";
import { test } from "node:test";
import { loginSchema, registerSchema, adminActionSchema, marksWriteSchema } from "../lib/server/validation";
import { decodeUuidCursor, encodeCursor } from "../lib/server/pagination";
import { SCHEDULE_VERSION, SLOT_COUNT, WEEK_CELL_COUNT } from "../lib/schedule";

test("new and reset passwords enforce the app's exact policy while old login passwords remain compatible", () => {
  const valid = "ABCDEFG!";
  assert.equal(registerSchema.safeParse({ username: "alice_1", password: valid }).success, true);
  assert.equal(registerSchema.safeParse({ username: "alice_1", password: "ABCDEFG1" }).success, false, "a digit is not punctuation");
  assert.equal(registerSchema.safeParse({ username: "alice_1", password: "abcdefg!" }).success, false, "uppercase is required");
  assert.equal(registerSchema.safeParse({ username: "alice_1", password: "ABCDEF1 " }).success, false, "whitespace is not a symbol");
  assert.equal(registerSchema.safeParse({ username: "alice_1", password: "ABCDEF!" }).success, false, "seven characters is too short");
  assert.equal(registerSchema.safeParse({ username: "alice_1", password: "A!😀😀😀" }).success, false, "five Unicode code points cannot pass via UTF-16 surrogate length");
  assert.equal(registerSchema.safeParse({ username: "alice_1", password: "A!😀😀😀😀😀😀" }).success, true, "eight Unicode code points pass without imposing lowercase or digit rules");
  assert.equal(registerSchema.safeParse({ username: "alice_1", password: "A".repeat(71) + "!" }).success, true, "72 ASCII bytes are accepted");
  assert.equal(registerSchema.safeParse({ username: "alice_1", password: "A".repeat(72) + "!" }).success, false, "73 ASCII bytes are rejected");
  assert.equal(registerSchema.safeParse({ username: "alice_1", password: "A!!" + "汉".repeat(23) }).success, true, "mixed UTF-8 password of exactly 72 bytes is accepted");
  assert.equal(registerSchema.safeParse({ username: "alice_1", password: "A!!" + "汉".repeat(23) + "x" }).success, false, "73 UTF-8 bytes are rejected");
  assert.equal(loginSchema.safeParse({ username: "alice_1", password: "old6!!" }).success, true);
  assert.equal(adminActionSchema.safeParse({ action: "reset_password", reason: "operator approved", password: valid }).success, true);
  assert.equal(adminActionSchema.safeParse({ action: "reset_password", reason: "operator approved", password: "ABCDEFG1" }).success, false);
});

test("keyset timestamp cursors preserve PostgreSQL microseconds and timezone offsets", () => {
  const timestamp = "2026-09-24T00:00:00.123456+00:00";
  const encoded = encodeCursor(timestamp, "00000000-0000-4000-8000-000000000001");
  assert.equal(decodeUuidCursor(encoded)?.createdAt, timestamp);
});

test("mark validation requires the current schedule version and accepts exactly 35 cells", () => {
  const items = Array.from({ length: WEEK_CELL_COUNT }, (_, index) => ({
    day_index: Math.floor(index / SLOT_COUNT),
    slot_index: index % SLOT_COUNT,
    nickname: `player-${index}`,
    location: "",
  }));
  const current = { week_key: "2026-09-21", schedule_version: SCHEDULE_VERSION, items };
  assert.equal(marksWriteSchema.safeParse(current).success, true);
  assert.equal(marksWriteSchema.safeParse({ ...current, items: [{ ...items[4] }] }).success, true, "slot index 4 is valid");
  assert.equal(marksWriteSchema.safeParse({ ...current, items: [{ ...items[0], slot_index: 5 }] }).success, false);
  assert.equal(marksWriteSchema.safeParse({ ...current, items: [...items, { ...items[0] }] }).success, false, "36 cells are rejected");

  const missingVersion = marksWriteSchema.safeParse({ week_key: current.week_key, items: [items[0]] });
  assert.equal(missingVersion.success, false, "old page requests without the version are rejected");
  if (!missingVersion.success) assert.ok(missingVersion.error.issues.some((issue) => issue.message === "时段已更新，请刷新页面后重试。"));
  const staleVersion = marksWriteSchema.safeParse({ ...current, schedule_version: "old-four-slot-v0", items: [items[0]] });
  assert.equal(staleVersion.success, false);
  if (!staleVersion.success) assert.ok(staleVersion.error.issues.some((issue) => issue.message === "时段已更新，请刷新页面后重试。"));
});
