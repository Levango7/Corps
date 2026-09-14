"use client";

/**
 * 会议控制栏 · components/meeting/MeetingControls.tsx
 *
 * 底部固定栏：麦克风开关、摄像头开关、屏幕共享、挂断（红色）。
 * 按钮使用 lucide-react 图标（尺寸 16），design token 样式。
 */

import { Mic, MicOff, Video, VideoOff, ScreenShare, PhoneOff } from "lucide-react";
import { useTranslations } from "next-intl";

export interface MeetingControlsProps {
  micOn: boolean;
  cameraOn: boolean;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onShareScreen: () => void;
  onLeave: () => void;
}

/** 圆形控制按钮基础样式 */
const controlBtnBase =
  "inline-flex items-center justify-center w-11 h-11 rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--fg)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] hover:bg-[var(--surface-2)]";

/** 开启态按钮样式（accent 强调） */
const controlBtnActive =
  "inline-flex items-center justify-center w-11 h-11 rounded-full bg-[var(--accent)] text-[var(--accent-fg)] border border-transparent transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] hover:bg-[var(--accent-hover)]";

/** 关闭态按钮样式（muted + 红色边框提示） */
const controlBtnOff =
  "inline-flex items-center justify-center w-11 h-11 rounded-full border border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] hover:bg-[var(--surface)]";

export function MeetingControls({
  micOn,
  cameraOn,
  onToggleMic,
  onToggleCamera,
  onShareScreen,
  onLeave,
}: MeetingControlsProps) {
  const t = useTranslations("meeting");

  return (
    <div className="flex items-center justify-center gap-3 px-[var(--space-4)] py-[var(--space-3)] bg-[var(--surface)] border-t border-[var(--border)]">
      {/* 麦克风开关 */}
      <button
        type="button"
        onClick={onToggleMic}
        className={micOn ? controlBtnActive : controlBtnOff}
        aria-label={micOn ? t("micOff") : t("micOn")}
        aria-pressed={micOn}
        title={micOn ? t("micOff") : t("micOn")}
      >
        {micOn ? <Mic size={16} /> : <MicOff size={16} />}
      </button>

      {/* 摄像头开关 */}
      <button
        type="button"
        onClick={onToggleCamera}
        className={cameraOn ? controlBtnActive : controlBtnOff}
        aria-label={cameraOn ? t("cameraOff") : t("cameraOn")}
        aria-pressed={cameraOn}
        title={cameraOn ? t("cameraOff") : t("cameraOn")}
      >
        {cameraOn ? <Video size={16} /> : <VideoOff size={16} />}
      </button>

      {/* 屏幕共享 */}
      <button
        type="button"
        onClick={onShareScreen}
        className={controlBtnBase}
        aria-label={t("shareScreen")}
        title={t("shareScreen")}
      >
        <ScreenShare size={16} />
      </button>

      {/* 挂断（红色） */}
      <button
        type="button"
        onClick={onLeave}
        className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-[var(--danger)] text-[var(--accent-fg)] border border-transparent transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] hover:opacity-90"
        aria-label={t("hangUp")}
        title={t("hangUp")}
      >
        <PhoneOff size={16} />
      </button>
    </div>
  );
}