/**
 * 计算本周 week_key：该周周一的日期，格式 YYYY-MM-DD。
 * 使用 Asia/Shanghai；周一为一周第一天（周日算在上一周之后的同一周末）。
 */
export function getShanghaiDateKey(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function shiftWeekKey(weekKey: string, count: number): string {
  const date = new Date(`${weekKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count * 7);
  return date.toISOString().slice(0, 10);
}

export function shiftDayKey(dayKey: string, count: number): string {
  const date = new Date(`${dayKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

export function getCurrentWeekKey(now: Date = new Date()): string {
  const date = new Date(`${getShanghaiDateKey(now)}T00:00:00Z`);
  const daysFromMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysFromMonday);
  return date.toISOString().slice(0, 10);
}

export function getShanghaiDayIndex(now: Date): number {
  const date = new Date(`${getShanghaiDateKey(now)}T00:00:00Z`);
  return (date.getUTCDay() + 6) % 7;
}

export function getWeekOffset(currentWeekKey: string, viewedWeekKey: string): number {
  const current = Date.parse(`${currentWeekKey}T00:00:00Z`);
  const viewed = Date.parse(`${viewedWeekKey}T00:00:00Z`);
  return Math.round((viewed - current) / (7 * 86_400_000));
}

export function formatShanghaiClock(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: "hour" | "minute" | "second") => parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("hour")}:${value("minute")}:${value("second")}`;
}

export function formatWeekDay(weekKey: string, dayIndex: number): string {
  const date = new Date(`${weekKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + dayIndex);
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "UTC", month: "numeric", day: "numeric" }).format(date);
}
