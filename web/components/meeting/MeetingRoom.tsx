"use client";

/**
 * 会议主界面 · components/meeting/MeetingRoom.tsx
 *
 * 全屏布局（fixed inset-0）：顶部状态条 + ParticipantGrid（主区域）+ MeetingControls（底部）。
 * 使用 useMeeting hook 管理连接：挂载时自动 joinMeeting，离开时调用 leaveMeeting。
 */

import { useEffect, useState, useCallback } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMeeting } from "./useMeeting";
import { ParticipantGrid } from "./ParticipantGrid";
import { MeetingControls } from "./MeetingControls";

export interface MeetingRoomProps {
  meetingId: string;
  workspaceId: string;
  onLeave: () => void;
}

export function MeetingRoom({ meetingId, workspaceId, onLeave }: MeetingRoomProps) {
  const t = useTranslations("meeting");
  const { isConnected, isJoining, participants, error, joinMeeting, leaveMeeting } =
    useMeeting(workspaceId, meetingId);

  // 本地媒体设备开关状态（占位：仅 UI 状态，未实际控制 WebRTC）
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);

  // 挂载时自动加入会议
  useEffect(() => {
    joinMeeting(meetingId);
  }, [meetingId, joinMeeting]);

  const handleToggleMic = useCallback(() => {
    // TODO: 安装 LiveKit SDK 后调用 localParticipant.setMicrophoneEnabled(!micOn)
    setMicOn((v) => !v);
  }, []);

  const handleToggleCamera = useCallback(() => {
    // TODO: 安装 LiveKit SDK 后调用 localParticipant.setCameraEnabled(!cameraOn)
    setCameraOn((v) => !v);
  }, []);

  const handleShareScreen = useCallback(() => {
    // TODO: 安装 LiveKit SDK 后调用 localParticipant.setScreenShareEnabled(true)
  }, []);

  const handleLeave = useCallback(async () => {
    await leaveMeeting();
    onLeave();
  }, [leaveMeeting, onLeave]);

  // 连接中
  if (isJoining && !isConnected) {
    return (
      <div className="fixed inset-0 z-[var(--z-modal)] flex flex-col items-center justify-center bg-[var(--bg)]">
        <Loader2 size={28} className="animate-spin text-[var(--accent)] mb-3" />
        <p className="text-[length:var(--text-sm)] text-[var(--muted)]">
          {t("joining")}
        </p>
      </div>
    );
  }

  // 连接失败
  if (error && !isConnected) {
    return (
      <div className="fixed inset-0 z-[var(--z-modal)] flex flex-col items-center justify-center bg-[var(--bg)]">
        <AlertCircle size={28} className="text-[var(--danger)] mb-3" />
        <p className="text-[length:var(--text-sm)] text-[var(--danger)] mb-4">
          {t("connectionFailed")}
        </p>
        <button
          type="button"
          onClick={onLeave}
          className="h-9 px-4 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-fast)]"
        >
          {t("leave")}
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex flex-col bg-[var(--bg)]">
      {/* 顶部状态条 */}
      <header className="flex items-center justify-between px-[var(--space-4)] py-[var(--space-2)] bg-[var(--surface)] border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-2 h-2 rounded-full bg-[var(--success)]"
            aria-hidden="true"
          />
          <span className="text-[length:var(--text-sm)] text-[var(--fg)]">
            {t("connected")}
          </span>
        </div>
        <span className="text-[length:var(--text-xs)] text-[var(--muted)]">
          {t("participants")} · {participants.length + 1}
        </span>
      </header>

      {/* 参与者视频网格（主区域） */}
      <ParticipantGrid participants={participants} />

      {/* 底部控制栏 */}
      <MeetingControls
        micOn={micOn}
        cameraOn={cameraOn}
        onToggleMic={handleToggleMic}
        onToggleCamera={handleToggleCamera}
        onShareScreen={handleShareScreen}
        onLeave={handleLeave}
      />
    </div>
  );
}