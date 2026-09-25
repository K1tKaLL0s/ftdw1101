import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { SCHEDULE_SLOTS } from "./schedule";
import { getCurrentWeekKey, getShanghaiDateKey, shiftDayKey } from "./week";
import { AppError } from "./server/errors";

export const botRanges = ["this_week", "today", "tomorrow", "next_week"] as const;
export type BotRange = (typeof botRanges)[number];

export function authorizeBot(request: Request, env: Record<string, string | undefined>) {
  if (env.BOT_QUERY_ENABLED !== "true") throw new AppError(503, "disabled", "预约查询未启用。");
  const digest = env.BOT_QUERY_TOKEN_SHA256?.trim() ?? "";
  const groups = (env.BOT_QUERY_ALLOWED_GROUPS ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  if (!/^[a-f0-9]{64}$/i.test(digest) || !groups.length) throw new AppError(503, "unconfigured", "预约查询尚未配置完成。");
  const token = /^Bearer ([^\s]{1,512})$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token || !timingSafeEqual(createHash("sha256").update(token).digest(), Buffer.from(digest, "hex"))) {
    throw new AppError(401, "unauthorized", "机器人令牌无效。");
  }
  const group = request.headers.get("x-group-id") ?? "";
  if (!/^\d{1,20}$/.test(group) || (!groups.includes("*") && !groups.includes(group))) {
    throw new AppError(403, "group_not_allowed", "该群未获准查询。");
  }
  const params = new URL(request.url).searchParams;
  const range = params.get("range") ?? "this_week";
  if (!botRanges.includes(range as BotRange) || params.getAll("range").length > 1 || [...params.keys()].some((key) => key !== "range")) {
    throw new AppError(400, "bad_range", "查询范围无效。");
  }
  return { digest: digest.toLowerCase(), range: range as BotRange, showNotes: env.BOT_QUERY_SHOW_NOTES === "true" };
}

export function botDateRange(range: BotRange, now: Date) {
  const today = getShanghaiDateKey(now);
  const monday = getCurrentWeekKey(now);
  const start = range === "today" ? today : range === "tomorrow" ? shiftDayKey(today, 1) : range === "next_week" ? shiftDayKey(monday, 7) : monday;
  return { start, end: range === "today" || range === "tomorrow" ? start : shiftDayKey(start, 6) };
}

const rowsSchema = z.array(z.object({
  reservation_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slot_index: z.number().int().min(0).max(SCHEDULE_SLOTS.length - 1),
  total_count: z.number().int().positive().safe(),
  members: z.array(z.object({ nickname: z.string(), location: z.string(), note: z.string().nullable().optional() })).max(5),
})).max(35);

function text(value: string, limit: number) {
  return Array.from(value.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\[CQ:[^\]]*\]/gi, " ").replace(/@(全体成员|all|everyone)/gi, " ").replace(/\s+/g, " ").trim()).slice(0, limit).join("");
}

export function botPayload(data: unknown, range: BotRange, now: Date, showNotes: boolean) {
  const bounds = botDateRange(range, now);
  const rows = rowsSchema.parse(data);
  const seen = new Set<string>();
  const slots = rows.map((row) => {
    const key = `${row.reservation_date}:${row.slot_index}`;
    if (row.reservation_date < bounds.start || row.reservation_date > bounds.end || seen.has(key) || row.members.length > row.total_count) throw new Error("Invalid bot query response");
    seen.add(key);
    const slot = SCHEDULE_SLOTS[row.slot_index];
    const time = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    const members = row.members.map((member) => ({
      nickname: text(member.nickname, 30), location: text(member.location, 100) || "皆可",
      ...(showNotes && member.note ? { note: text(member.note, 80) } : {}),
    }));
    return { date: row.reservation_date, slot_index: row.slot_index, start: time(slot.startMinute), end: time(slot.endMinute), count: row.total_count, members, omitted_count: row.total_count - members.length };
  }).sort((a, b) => a.date.localeCompare(b.date) || a.slot_index - b.slot_index);
  return { schema_version: "1", timezone: "Asia/Shanghai", range, range_start: bounds.start, range_end: bounds.end, fetched_at: now.toISOString(), slots };
}
