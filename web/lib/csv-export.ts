/**
 * CSV 导出工具（P4：数据导出 CSV）
 *
 * 设计要点：
 *  - 前端 Blob API 生成，不需要后端端点
 *  - 包含 UTF-8 BOM（\uFEFF）确保 Excel 中文兼容
 *  - 字段含逗号/引号/换行时用双引号包裹并转义内部引号（RFC 4180）
 *  - 文件名带时间戳，避免覆盖
 */

/** CSV 字段转义：含逗号、引号、换行时用双引号包裹，内部引号双写 */
function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** 将二维数组转为 CSV 字符串（含 BOM） */
function rowsToCsv(rows: (string | number | null | undefined)[][]): string {
  const body = rows
    .map((row) => row.map((cell) => escapeCsvField(String(cell ?? ""))).join(","))
    .join("\r\n");
  // UTF-8 BOM：Excel 中文兼容
  return `\uFEFF${body}`;
}

/** 触发浏览器下载 CSV 文件 */
function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // 释放 URL 对象，避免内存泄漏
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

/** 格式化时间戳用于文件名：YYYYMMDD-HHMM */
function timestampForFilename(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/** 任务列表 CSV 导出 */
export interface CsvTask {
  id: string;
  title: string;
  status: string;
  assigneeName: string | null;
  dueDate: string | null;
  createdAt: string;
}

export function exportTasksCsv(tasks: CsvTask[], workspaceSlug: string): void {
  const header = ["标题", "状态", "指派人", "截止日期", "创建日期"];
  const rows = tasks.map((t) => [
    t.title,
    t.status,
    t.assigneeName ?? "",
    t.dueDate ? new Date(t.dueDate).toLocaleDateString("zh-CN") : "",
    new Date(t.createdAt).toLocaleDateString("zh-CN"),
  ]);
  const csv = rowsToCsv([header, ...rows]);
  downloadCsv(`corps-${workspaceSlug}-tasks-${timestampForFilename()}.csv`, csv);
}

/** 决策记录 CSV 导出 */
export interface CsvDecision {
  id: string;
  taskTitle: string;
  markdown: string;
  authorName: string | null;
  createdAt: string;
}

export function exportDecisionsCsv(decisions: CsvDecision[], workspaceSlug: string): void {
  const header = ["任务标题", "决策内容", "作者", "时间"];
  const rows = decisions.map((d) => [
    d.taskTitle,
    d.markdown,
    d.authorName ?? "",
    new Date(d.createdAt).toLocaleDateString("zh-CN"),
  ]);
  const csv = rowsToCsv([header, ...rows]);
  downloadCsv(`corps-${workspaceSlug}-decisions-${timestampForFilename()}.csv`, csv);
}