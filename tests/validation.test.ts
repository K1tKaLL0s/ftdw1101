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

test("shared mark fields fit the full legal Chinese payload under 16 KiB and normalize legacy input", () => {
  const coordinates = Array.from({ length: WEEK_CELL_COUNT }, (_, index) => ({
    day_index: Math.floor(index / SLOT_COUNT),
    slot_index: index % SLOT_COUNT,
  }));
  const shared = {
    week_key: "2026-09-21",
    schedule_version: SCHEDULE_VERSION,
    nickname: "林".repeat(30),
    location: "场".repeat(100),
    note: "备".repeat(200),
    items: coordinates,
  };
  const sharedBytes = Buffer.byteLength(JSON.stringify(shared), "utf8");
  assert.ok(sharedBytes < 16_384, `shared input must fit the existing request limit (${sharedBytes} bytes)`);
  const parsedShared = marksWriteSchema.safeParse(shared);
  assert.equal(parsedShared.success, true);
  if (!parsedShared.success) return;
  assert.equal(parsedShared.data.items.length, WEEK_CELL_COUNT);
  assert.equal(parsedShared.data.items[34].nickname, shared.nickname);
  assert.equal(parsedShared.data.items[34].location, shared.location);
  assert.equal(parsedShared.data.note, shared.note);
  assert.equal(parsedShared.data.items.every((item) => item.location === shared.location), true);

  const legacy = {
    week_key: shared.week_key,
    schedule_version: SCHEDULE_VERSION,
    note: shared.note,
    items: coordinates.map((item) => ({ ...item, nickname: shared.nickname, location: shared.location })),
  };
  assert.equal(Buffer.byteLength(JSON.stringify(legacy), "utf8"), 16_396);
  const parsedLegacy = marksWriteSchema.safeParse(legacy);
  assert.equal(parsedLegacy.success, true, "the previous per-item shape remains accepted when within HTTP limit");
  if (parsedLegacy.success) assert.deepEqual(parsedLegacy.data.items[0], { ...coordinates[0], nickname: shared.nickname, location: shared.location });

  assert.equal(marksWriteSchema.safeParse({ ...shared, items: legacy.items }).success, false, "root shared fields cannot mix with per-item nicknames and locations");
  assert.equal(marksWriteSchema.safeParse({ ...legacy, nickname: shared.nickname, location: shared.location }).success, false, "old clients cannot add shared fields on top of full items");
  assert.equal(marksWriteSchema.safeParse({ ...shared, location: "" }).success, true, "an empty shared location remains valid and maps to the existing default downstream");
});
