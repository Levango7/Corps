/**
 * 共享格式化工具 —— 单一编辑源。
 *
 * formatRelativeDueDate / formatTaskId / relativeTime / markdownToPlainText / dueMeta
 * 曾在 board、my-tasks、home、decisions、notifications、task 详情页各自重复定义，
 * 且出现行为漂移（逾期文案在 board 是"逾期 N 天"，在 my-tasks 是"已逾期 N 天"）。
 *
 * 统一从此处 import，确保跨页一致。
 */

/** 一天的毫秒数，避免魔法数字 86400000 / (1000*60*60*24) 散落各处。 */
const MS_PER_DAY = 86_400_000;

/**
 * 截止日期相对格式化："今天" / "明天" / "N 天后" / "逾期 N 天"。
 * 以日期（00:00）粒度比较，避免时区与时分秒抖动。
 */
export function formatRelativeDueDate(dueDate: string): {
  text: string;
  tone: "overdue" | "today" | "normal";
} {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due.getTime() - now.getTime()) / MS_PER_DAY);
  if (diffDays < 0) return { text: `逾期 ${-diffDays} 天`, tone: "overdue" };
  if (diffDays === 0) return { text: "今天", tone: "today" };
  if (diffDays === 1) return { text: "明天", tone: "normal" };
  return { text: `${diffDays} 天后`, tone: "normal" };
}

/**
 * 概览页 dueMeta：返回文案 + 颜色 token。
 * 与 formatRelativeDueDate 互补：前者用于看板/我的任务（tone 三态），后者用于概览（多档颜色）。
 */
export function dueMeta(iso?: string | null): {
  text: string;
  color: string;
} | null {
  if (!iso) return null;
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / MS_PER_DAY);
  if (days < 0) return { text: `逾期 ${Math.abs(days)} 天`, color: "var(--danger)" };
  if (days === 0) return { text: "今天到期", color: "var(--warn)" };
  if (days === 1) return { text: "明天到期", color: "var(--warn)" };
  if (days <= 7) return { text: `${days} 天后`, color: "var(--muted)" };
  return {
    text: d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }),
    color: "var(--meta)",
  };
}

/**
 * 相对时间戳：刚刚 / N 分钟前 / N 小时前 / N 天前 / 月-日。
 * 用于评论、通知、决策列表等"发生时刻"展示。
 */
export function relativeTime(iso?: string): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const diff = Math.max(0, Date.now() - then);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "刚刚";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

/**
 * 任务详情页 relTime：与 relativeTime 行为一致，但无 "月-日" 兜底（用 toLocaleDateString）。
 * 保留独立函数以兼容详情页既有调用形态（无 null 返回）。
 */
export function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
}

/** 生成专业任务 ID：CORP-XXXX（大写 mono），如 CORP-4A2B。 */
export function formatTaskId(id: string): string {
  return `CORP-${id.slice(0, 4).toUpperCase()}`;
}

/** markdown 摘要截取上限，避免魔法数字散落。 */
export const SUMMARY_LIMIT = 200;

/**
 * 将 markdown 转为纯文本并截取前 N 字符作为摘要。
 * 仅做轻量剥离（标题符号、强调、链接、代码、列表标记、HTML），
 * 不引入 markdown 解析依赖；摘要仅用于列表预览，完整内容在任务详情查看。
 */
export function markdownToPlainText(md: string, limit = SUMMARY_LIMIT): string {
  const text = md
    // 去除标题井号
    .replace(/^#{1,6}\s+/gm, "")
    // 去除强调/加粗/斜体
    .replace(/(\*{1,3}|_{1,3})(.+?)\1/g, "$2")
    // 去除行内代码反引号
    .replace(/`([^`]+)`/g, "$1")
    // 去除图片
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    // 链接保留文本
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // 去除无序列表标记
    .replace(/^\s*[-*+]\s+/gm, "")
    // 去除有序列表标记
    .replace(/^\s*\d+\.\s+/gm, "")
    // 去除引用块 >
    .replace(/^\s*>\s?/gm, "")
    // 去除水平分隔线
    .replace(/^---+\s*$/gm, "")
    // 去除 HTML 标签
    .replace(/<[^>]+>/g, "")
    // 折叠多余空白
    .replace(/\n{2,}/g, "\n")
    .trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/**
 * 任务列表排序：recent / due / priority 三键。
 * - recent：按 updatedAt 倒序（默认）
 * - due：按截止日期升序，无截止日期排最后
 * - priority：urgent > high > medium > low
 */
export type SortKey = "recent" | "due" | "priority";

export function sortTasks<T extends { updatedAt?: string; dueDate?: string | null; priority: string }>(
  tasks: T[],
  sortKey: SortKey,
  priorityOrder: Record<string, number>,
): T[] {
  const arr = tasks.slice();
  if (sortKey === "due") {
    arr.sort((a, b) => {
      const aDue = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const bDue = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      return aDue - bDue;
    });
  } else if (sortKey === "priority") {
    arr.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  } else {
    arr.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  }
  return arr;
}