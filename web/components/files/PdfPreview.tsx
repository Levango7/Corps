/**
 * PDF 预览组件
 *
 * 使用 iframe 嵌入，依赖浏览器原生 PDF 渲染能力。
 * 现代浏览器（Chrome/Edge/Firefox）均内置 PDF Viewer。
 *
 * 所有样式走 design token（var(--*)），无裸 hex。
 */

import { getTranslations } from "next-intl/server";

export interface PdfPreviewProps {
  /** PDF 文件的 URL */
  url: string;
}

export async function PdfPreview({ url }: PdfPreviewProps) {
  const t = await getTranslations("files.preview");

  return (
    <iframe
      src={url}
      title={t("title")}
      className="w-full h-full border-0 bg-[var(--surface)]"
      data-testid="pdf-preview"
    />
  );
}
