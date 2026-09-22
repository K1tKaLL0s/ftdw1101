/** 列：周一 = 0 … 周日 = 6 */
export const DAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"] as const;

/** 行：四个固定时段 */
export const SLOT_LABELS = [
  "12:00 之前",
  "12:00 - 15:00",
  "15:00 - 18:00",
  "18:00 之后",
] as const;

export function cellKey(dayIndex: number, slotIndex: number) {
  return `${dayIndex}-${slotIndex}`;
}
