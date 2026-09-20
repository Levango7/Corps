
/**
 * 文件预览模态对话框
 *
 * 包装 FilePreview，提供全屏模态预览能力。
 * 通过 open 状态控制显示/隐藏，点击关闭按钮或 ESC 键关闭。
 *
 * 用 design token 样式，无裸 hex。
 * 图标：lucide-react，尺寸 14。
 */

import { FilePreview } from "./FilePreview";
import type { FilePreviewProps } from "./FilePreview";

export interface FilePreviewDialogProps {
  /** 是否显示对话框 */
  open: boolean;
  /** 文件预览所需的属性（url、fileName、fileType、onClose） */
  file: Omit<FilePreviewProps, never>;
}

export function FilePreviewDialog({ open, file }: FilePreviewDialogProps) {
  if (!open) return null;

  return <FilePreview {...file} />;
}