"use client";

/**
 * 会议控制栏 · components/meetings/MeetingControls.tsx
 *
 * 自定义底部控制栏（不使用 LiveKit 预置 ControlBar）：
 *  - 麦克风开关（useLocalParticipant.isMicrophoneEnabled + setMicrophoneEnabled）
 *  - 摄像头开关（useLocalParticipant.isCameraEnabled + setCameraEnabled）
 *  - 屏幕共享开关（useLocalParticipant.isScreenShareEnabled + setScreenShareEnabled）
 *  - 离开会议按钮（调用 onLeave 回调，由父组件负责 leave API + 断开连接）
 *
 * design token 样式 + lucide-react 图标（尺寸 16）。
 * 必须在 <LiveKitRoom> 内使用（依赖 RoomContext）。
 */

import { useState, useCallback } from "react";
import { useLocalParticipant } from "@livekit/components-react";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
  MonitorOff,
  Phone,
  Loader2,
} from "lucide-react";
import { useTranslations } from "next-intl";

export interface MeetingControlsProps {
  /** 离开会议回调（父组件负责调用 leave API + 断开 LiveKit 连接 + 路由跳转） */
  onLeave: () => void;
}

/** 圆形控制按钮基础样式（design token） */
const controlBtnBase =
  "inline-flex items-center justify-center w-11 h-11 rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--fg)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] hover:bg-[var(--surface-2)] disabled:opacity-50 disabled:cursor-not-allowed";

/** 开启态按钮样式（accent 强调） */
const controlBtnActive =
  "inline-flex items-center justify-center w-11 h-11 rounded-full bg-[var(--accent)] text-[var(--accent-fg)] border border-transparent transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed";

/** 关闭态按钮样式（muted 提示） */
const controlBtnOff =
  "inline-flex items-center justify-center w-11 h-11 rounded-full border border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] hover:bg-[var(--surface)] disabled:opacity-50 disabled:cursor-not-allowed";

export function MeetingControls({ onLeave }: MeetingControlsProps) {
  const t = useTranslations("meetings.room");
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } =
    useLocalParticipant();

  // 屏幕共享切换中状态（setScreenShareEnabled 是异步的）
  const [screenShareBusy, setScreenShareBusy] = useState(false);

  const handleToggleMic = useCallback(async () => {
    try {
      await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
    } catch {
      // 设备错误静默处理：UI 状态由 hook 自动同步
    }
  }, [localParticipant, isMicrophoneEnabled]);

  const handleToggleCamera = useCallback(async () => {
    try {
      await localParticipant.setCameraEnabled(!isCameraEnabled);
    } catch {
      // 设备错误静默处理
    }
  }, [localParticipant, isCameraEnabled]);

  const handleToggleScreenShare = useCallback(async () => {
    setScreenShareBusy(true);
    try {
      await localParticipant.setScreenShareEnabled(!isScreenShareEnabled);
    } catch {
      // 屏幕共享被浏览器拒绝（用户取消授权）静默处理
    } finally {
      setScreenShareBusy(false);
    }
  }, [localParticipant, isScreenShareEnabled]);

  return (
    <div className="flex items-center justify-center gap-3 px-[var(--space-4)] py-[var(--space-3)] bg-[var(--surface)] border-t border-[var(--border)]">
      {/* 麦克风开关 */}
      <button
        type="button"
        onClick={handleToggleMic}
        className={isMicrophoneEnabled ? controlBtnActive : controlBtnOff}
        aria-label={isMicrophoneEnabled ? t("micOff") : t("micOn")}
        aria-pressed={isMicrophoneEnabled}
        title={isMicrophoneEnabled ? t("micOff") : t("micOn")}
      >
        {isMicrophoneEnabled ? <Mic size={16} /> : <MicOff size={16} />}
      </button>

      {/* 摄像头开关 */}
      <button
        type="button"
        onClick={handleToggleCamera}
        className={isCameraEnabled ? controlBtnActive : controlBtnOff}
        aria-label={isCameraEnabled ? t("cameraOff") : t("cameraOn")}
        aria-pressed={isCameraEnabled}
        title={isCameraEnabled ? t("cameraOff") : t("cameraOn")}
      >
        {isCameraEnabled ? <Video size={16} /> : <VideoOff size={16} />}
      </button>

      {/* 屏幕共享开关 */}
      <button
        type="button"
        onClick={handleToggleScreenShare}
        disabled={screenShareBusy}
        className={isScreenShareEnabled ? controlBtnActive : controlBtnBase}
        aria-label={
          isScreenShareEnabled ? t("screenShareStop") : t("screenShare")
        }
        aria-pressed={isScreenShareEnabled}
        title={isScreenShareEnabled ? t("screenShareStop") : t("screenShare")}
      >
        {screenShareBusy ? (
          <Loader2 size={16} className="animate-spin" />
        ) : isScreenShareEnabled ? (
          <MonitorOff size={16} />
        ) : (
          <Monitor size={16} />
        )}
      </button>

      {/* 离开会议（红色挂断） */}
      <button
        type="button"
        onClick={onLeave}
        className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-[var(--danger)] text-[var(--accent-fg)] border border-transparent transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] hover:opacity-90"
        aria-label={t("leave")}
        title={t("leave")}
      >
        <Phone size={16} />
      </button>
    </div>
  );
}