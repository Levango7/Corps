"use client";

import { use } from "react";
import { FileManagerPage } from "@/components/files/FileManagerPage";

/**
 * 云盘页面 · /[locale]/w/[wid]/files
 *
 * 薄壳：只解 params，其余逻辑在 FileManagerPage（ADR-015 接线，见其文件头注释）。
 */
export default function FilesPage({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = use(params);
  return <FileManagerPage wid={wid} />;
}
