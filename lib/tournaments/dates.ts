import { SCHEDULE_SLOTS } from "../schedule";
export const eventTimezones = ["Asia/Shanghai", "Asia/Hong_Kong", "Asia/Tokyo", "Etc/UTC"] as const;
const offsets: Record<string, number> = { "Asia/Shanghai": 8, "Asia/Hong_Kong": 8, "Asia/Tokyo": 9, "Etc/UTC": 0 };
export function localEventTime(value: string, timezone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || !(timezone in offsets)) throw new Error("请选择有效的赛事日期、时间及时区。");
  const utc = new Date(value + ":00Z");
  if (!Number.isFinite(utc.getTime()) || utc.toISOString().slice(0, 16) !== value) throw new Error("赛事日期或时间无效。");
  return new Date(utc.getTime() - offsets[timezone] * 3_600_000).toISOString();
}
export function displayEventTime(value: string, timezone = "Asia/Shanghai"): string {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, dateStyle: "medium", timeStyle: "short", hour12: false }).format(new Date(value));
}
/** Match the production calendar's five Shanghai windows; -1 means outside reservation hours. */
export function calendarCell(value: string, weekKey: string): { day: number; slot: number } | null {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const part = (type: string) => parts.find(part => part.type === type)!.value;
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  const day = (Date.parse(date + "T00:00:00Z") - Date.parse(weekKey + "T00:00:00Z")) / 86_400_000;
  const minute = Number(part("hour")) * 60 + Number(part("minute"));
  return day >= 0 && day <= 6 ? { day, slot: SCHEDULE_SLOTS.findIndex(slot => minute >= slot.startMinute && minute < slot.endMinute) } : null;
}
