"use client";

/**
 * 音频预览组件
 *
 * 使用 HTML5 <audio> 标签 + 浏览器原生控件。
 * 居中显示音频装饰图标 + 播放器。
 *
 * 所有样式走 design token（var(--*)），无裸 hex。
 * 图标：lucide-react（装饰图标用 32px，按钮图标用 14px）。
 */

import { Music } from "lucide-react";

export interface AudioPreviewProps {
  src: string;
}

export function AudioPreview({ src }: AudioPreviewProps) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-6 w-full h-full bg-[var(--surface-2)]"
      data-testid="audio-preview"
    >
      <div className="flex items-center justify-center w-16 h-16 rounded-[var(--radius-lg)] bg-[var(--accent-soft)] text-[var(--accent-soft-fg)]">
        <Music size={32} />
      </div>
      <audio
        src={src}
        controls
        className="w-full max-w-[400px]"
      />
    </div>
  );
}