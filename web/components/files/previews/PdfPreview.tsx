"use client";

/**
 * PDF 预览组件
 *
 * 使用 iframe 嵌入，依赖浏览器原生 PDF 渲染能力。
 * 现代浏览器（Chrome/Edge/Firefox）均内置 PDF Viewer。
 * 若浏览器不支持，会显示空白或下载提示，由浏览器自行处理。
 *
 * 所有样式走 design token（var(--*)），无裸 hex。
 */

import { useTranslations } from "next-intl";

export interface PdfPreviewProps {
  src: string;
}

export function PdfPreview({ src }: PdfPreviewProps) {
  const t = useTranslations("files.pdfPreview");
  return (
    <iframe
      src={src}
      title={t("title")}
      className="w-full h-full border-0 bg-[var(--surface)]"
      data-testid="pdf-preview"
    />
  );
}