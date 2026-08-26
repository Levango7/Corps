/**
 * Asia/Shanghai 时区纯函数（FUNNEL-METRICS §6.4 / D1 修复）。
 *
 * 中国无夏令时，UTC+8 固定偏移；物理存储保持 Timestamptz UTC 不变，
 * 仅在聚合边界换算。抽取纯函数供 overview daily/WAW/retention 三处复用，可单测。
 */

const SHANGHAI_OFFSET_MS = 8 * 3600_000;

/**
 * 将 UTC 时间映射到北京时间所在自然日的 YYYY-MM-DD。
 * 例：UTC 2026-08-27T16:30:00Z → 北京 2026-08-28T00:30:00 → "2026-08-28"
 *     UTC 2026-08-27T15:59:00Z → 北京 2026-08-27T23:59:00 → "2026-08-27"
 */
export function shanghaiDay(date: Date): string {
  return new Date(date.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * 将 UTC 时间映射到北京时间所在自然周的周 key（YYYY-Www，周一为界）。
 * 周一 00:00 UTC+8 为周界；以 (getUTCDay()+6)%7 回推：周日=6，周一=0。
 * 例：UTC 2026-08-30T16:00:00Z → 北京 2026-08-31T00:00:00（周一）→ "2026-W36"
 */
export function shanghaiWeekKey(date: Date): string {
  const offset = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  // 周一=0 ... 周日=6
  const dow = (offset.getUTCDay() + 6) % 7;
  // 回推到本周周一 00:00 UTC+8
  const monday = new Date(offset.getTime() - dow * 86_400_000);
  const y = monday.getUTCFullYear();
  const m = String(monday.getUTCMonth() + 1).padStart(2, "0");
  const d = String(monday.getUTCDate()).padStart(2, "0");
  // ISO 周序：以周一为起点的周序，用 UTC 时间计算（与 YYYY-MM-DD 周一对应）
  // 简化：直接以周一日期为周 key（YYYY-MM-DD），稳定且可比较，避免 ISO 周跨年边界复杂度
  return `${y}-${m}-${d}`;
}

/** CORE_EVENTS 集合（FUNNEL-METRICS §2.1）。 */
export const CORE_EVENTS = new Set([
  "session_start",
  "create_task",
  "task_status_change",
  "create_comment",
  "create_decision",
  "invite_member",
]);
