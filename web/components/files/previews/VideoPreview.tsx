"use client";

/**
 * 视频预览组件
 *
 * 使用 HTML5 <video> 标签 + 浏览器原生控件。
 * 支持 mp4/webm 等浏览器可解码格式。
 *
 * 所有样式走 design token（var(--*)），无裸 hex。
 */

export interface VideoPreviewProps {
  src: string;
}

export function VideoPreview({ src }: VideoPreviewProps) {
  return (
    <div
      className="flex items-center justify-center w-full h-full bg-[var(--surface-2)]"
      data-testid="video-preview"
    >
      <video
        src={src}
        controls
        className="max-w-full max-h-full"
      />
    </div>
  );
}