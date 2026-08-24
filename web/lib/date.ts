/**
 * 日期工具：统一本地时区与 ISO 字符串的转换，
 * 避免 new Date("YYYY-MM-DD") 被解析为 UTC 导致偏移一天的问题。
 */

/**
 * Date → 本地时区 YYYY-MM-DD 字符串。
 * 用于 <input type="date"> 的 value 展示。
 */
export function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * YYYY-MM-DD 字符串 → 当地时区午夜的 ISO 字符串。
 * 用于存储到后端（timestamptz 列）。
 * new Date("2024-03-15") 在 UTC+8 会解析为 2024-03-14T16:00:00Z，
 * 本函数显式构造本地日期避免此问题。
 */
export function localDateToISOString(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}
