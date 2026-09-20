// 文件辅助函数 — 纯函数，不带 "use client" 指令。
// 可在 server component 和 client component 中通用导入。
// 从 FileListItem.tsx 提取，供 FileListItem / FileGridItem 复用。

import {
  File,
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  Code,
  type LucideIcon,
} from "lucide-react";

/** 文件大小格式化：B/KB/MB/GB，保留 1 位小数 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** 文件类型 → lucide 图标映射（按 MIME type 前缀/关键字判断） */
export function getFileIcon(fileType: string): LucideIcon {
  const ft = fileType.toLowerCase();
  if (ft.startsWith("image/")) return ImageIcon;
  if (ft.startsWith("video/")) return Film;
  if (ft.startsWith("audio/")) return Music;
  if (ft.includes("pdf")) return FileText;
  if (
    ft.includes("javascript") ||
    ft.includes("typescript") ||
    ft.includes("python") ||
    ft.includes("json") ||
    ft.includes("html") ||
    ft.includes("css") ||
    ft.includes("xml") ||
    ft.includes("java") ||
    ft.includes("go") ||
    ft.includes("markdown")
  ) {
    return Code;
  }
  if (ft.startsWith("text/")) return FileText;
  return File;
}

/** 日期格式化为 YYYY-MM-DD（用 new Date() 包装以兼容序列化 string，运行时健壮） */
export function formatDate(date: Date): string {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}