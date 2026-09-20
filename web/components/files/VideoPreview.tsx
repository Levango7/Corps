
/**
 * 视频预览组件
 *
 * 使用 HTML5 <video> 标签 + 浏览器原生控件（controls）。
 * 支持 mp4/webm/ogg/mov/avi 等浏览器可解码格式。
 * 视频居中展示，最大宽高填满容器，支持全屏（浏览器原生 controls 提供）。
 *
 * 所有样式走 design token（var(--*)），无裸 hex。
 */

export interface VideoPreviewProps {
  /** 视频文件的 URL */
  url: string;
}

export function VideoPreview({ url }: VideoPreviewProps) {
  return (
    <div
      className="flex items-center justify-center w-full h-full bg-[var(--surface-2)]"
      data-testid="video-preview"
    >
      <video
        src={url}
        controls
        className="max-w-full max-h-full"
      />
    </div>
  );
}