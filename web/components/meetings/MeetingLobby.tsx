"use client";

/**
 * 会议大厅/等待页 · components/meetings/MeetingLobby.tsx
 *
 * 加入会议前的准备页面：
 *  - 显示会议标题 + 副标题
 *  - 摄像头/麦克风设备预览与选择（LiveKit PreJoin 预置组件）
 *  - "加入会议"按钮 → 调用 onJoin 回调（由父组件切换到 MeetingRoom）
 *
 * PreJoin 是 LiveKit 预置组件，独立于 LiveKitRoom（不需要房间上下文），
 * 仅访问本地媒体轨道做设备检测。用户选择会通过 usePersistentUserChoices
 * 持久化，MeetingRoom 内的 VideoConference 会自动继承这些选择。
 */

import { useState, useCallback } from "react";
import { PreJoin, type LocalUserChoices } from "@livekit/components-react";
import { Video, ArrowLeft, Loader2, AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";

export interface MeetingLobbyProps {
  meetingTitle: string;
  /** 当前用户名（预填到 PreJoin 输入框） */
  currentUserName?: string;
  /** 加入会议回调（父组件切换到 MeetingRoom） */
  onJoin: () => void;
  /** 取消/返回回调 */
  onCancel: () => void;
}

export function MeetingLobby({
  meetingTitle,
  currentUserName,
  onJoin,
  onCancel,
}: MeetingLobbyProps) {
  const t = useTranslations("meetings.room");
  const [joining, setJoining] = useState(false);
  const [deviceError, setDeviceError] = useState("");

  // PreJoin 提交：用户已确认设备选择，触发加入
  const handlePreJoinSubmit = useCallback(
    (_values: LocalUserChoices) => {
      setJoining(true);
      // 用户选择已由 PreJoin 持久化，直接通知父组件切换到 MeetingRoom
      onJoin();
    },
    [onJoin],
  );

  const handlePreJoinError = useCallback((error: Error) => {
    setDeviceError(error.message);
  }, []);

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex flex-col items-center justify-center bg-[var(--bg)] px-[var(--space-4)]">
      {/* 返回按钮（左上角） */}
      <button
        type="button"
        onClick={onCancel}
        className="absolute top-[var(--space-4)] left-[var(--space-4)] inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[var(--fg-2)] text-[length:var(--text-sm)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
        aria-label={t("leave")}
      >
        <ArrowLeft size={16} />
        {t("leave")}
      </button>

      {/* 标题区 */}
      <div className="text-center mb-[var(--space-6)]">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] mb-[var(--space-3)]">
          <Video size={20} />
        </div>
        <h1 className="text-[length:var(--text-2xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tracking-[var(--tracking-tight)] mb-[var(--space-1)]">
          {meetingTitle}
        </h1>
        <p className="text-[length:var(--text-sm)] text-[var(--muted)]">{t("lobbySubtitle")}</p>
      </div>

      {/* 设备预览区 */}
      <div className="w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-5)]">
        <h2 className="text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--meta)] uppercase tracking-[var(--tracking-caps)] mb-[var(--space-3)]">
          {t("testDevices")}
        </h2>

        {deviceError && (
          <div className="flex items-start gap-2 mb-[var(--space-3)] px-3 py-2 rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger)] text-[length:var(--text-xs)]">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span className="flex-1">{deviceError}</span>
          </div>
        )}

        {joining ? (
          <div className="flex flex-col items-center justify-center py-[var(--space-8)]">
            <Loader2 size={24} className="animate-spin text-[var(--accent)] mb-[var(--space-2)]" />
            <p className="text-[length:var(--text-sm)] text-[var(--muted)]">{t("joining")}</p>
          </div>
        ) : (
          <PreJoin
            defaults={{
              username: currentUserName ?? "",
              audioEnabled: true,
              videoEnabled: true,
            }}
            onSubmit={handlePreJoinSubmit}
            onError={handlePreJoinError}
            joinLabel={t("joinNow")}
            micLabel={t("micOn")}
            camLabel={t("cameraOn")}
            userLabel={t("username")}
            className="w-full"
          />
        )}
      </div>

      {/* 底部提示 */}
      <p className="mt-[var(--space-4)] text-[length:var(--text-xs)] text-[var(--muted)] text-center max-w-sm">
        {t("lobbyHint")}
      </p>
    </div>
  );
}
