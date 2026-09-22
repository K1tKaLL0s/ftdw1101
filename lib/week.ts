/**
 * 计算本周 week_key：该周周一的日期，格式 YYYY-MM-DD。
 * 使用本地时区；周一为一周第一天（周日算在上一周之后的同一周末）。
 */
export function getCurrentWeekKey(now: Date = new Date()): string {
  // 只用年月日，避免时分秒干扰
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // getDay(): 0=周日 ... 6=周六 → 转成距离周一的天数
  const daysFromMonday = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - daysFromMonday);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
