/** 列：周一 = 0 … 周日 = 6 */
export const DAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"] as const;

/** Shanghai wall-clock windows; the start is included and the end is excluded. */
export const SCHEDULE_SLOTS = [
  { label: "08:00–11:00", startMinute: 8 * 60, endMinute: 11 * 60 },
  { label: "11:00–14:00", startMinute: 11 * 60, endMinute: 14 * 60 },
  { label: "14:00–17:00", startMinute: 14 * 60, endMinute: 17 * 60 },
  { label: "17:00–20:00", startMinute: 17 * 60, endMinute: 20 * 60 },
  { label: "20:00–22:00", startMinute: 20 * 60, endMinute: 22 * 60 },
] as const;

export const SLOT_COUNT = SCHEDULE_SLOTS.length;
export const WEEK_CELL_COUNT = DAY_LABELS.length * SLOT_COUNT;
export const SCHEDULE_VERSION = "daily-08-22-v1" as const;

export function getCurrentSlotIndex(now: Date): number {
  if (!Number.isFinite(now.getTime())) return -1;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  const wallMinute = hour * 60 + minute;
  return SCHEDULE_SLOTS.findIndex((slot) => wallMinute >= slot.startMinute && wallMinute < slot.endMinute);
}

export function cellKey(dayIndex: number, slotIndex: number) {
  return `${dayIndex}-${slotIndex}`;
}
