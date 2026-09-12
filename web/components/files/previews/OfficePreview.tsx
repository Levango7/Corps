"use client";

/**
 * Office 文件预览组件（降级方案）
 *
 * docx/xlsx/pptx 等 Office 格式无法在浏览器中直接渲染，
 * 完整方案需接入 Google Docs Viewer 或后端转换服务。
 * 当前采用简化降级：提示用户下载查看，并提供下载按钮。
 *
 * 所有样式走 design token（var(--*)），无裸 hex。
 * 图标：lucide-react，尺寸 14。
 */

import { Download } from "lucide-react";

export interface OfficePreviewProps {
  src: string;
  fileType: string;
}

export function OfficePreview({ src, fileType }: OfficePreviewProps) {
  const label = fileType.toUpperCase().replace(/^\./, "");

  return (
    <div
      className="flex flex-col items-center justify-center gap-4 w-full h-full text-center px-6 bg-[var(--surface-2)]"
      data-testid="office-preview"
    >
      <p className="text-[var(--muted)] text-[length:var(--text-sm)]">
        {label} 文件预览需要在线服务，请下载查看
      </p>
      <a
        href={src}
        download
        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] transition-colors duration-[var(--motion-base)] motion-reduce:transition-none hover:bg-[var(--accent-hover)] focus-visible:outline-none focus-visible:ring-[var(--focus-ring)]"
      >
        <Download size={14} />
        <span>下载文件</span>
      </a>
    </div>
  );
}