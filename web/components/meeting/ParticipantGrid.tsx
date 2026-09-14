"use client";

/**
 * 参与者视频网格 · components/meeting/ParticipantGrid.tsx
 *
 * 响应式网格（2 / 3 / 4 列），每个参与者卡片包含视频占位区与麦克风状态图标。
 * 说话者边框高亮（var(--accent)）。
 *
 * 当前为占位实现：视频区显示黑色背景 + 用户名（LiveKit SDK 接入后替换为
 * <VideoTrack> 组件）。
 */

import { Mic, MicOff } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Participant } from "./useMeeting";

export interface ParticipantGridProps {
  participants: Participant[];
}

export function ParticipantGrid({ participants }: ParticipantGridProps) {
  const t = useTranslations("meeting");

  if (participants.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[var(--bg)]">
        <div className="text-center text-[var(--muted)]">
          <p className="text-[length:var(--text-sm)]">{t("noMeetings")}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 overflow-auto p-[var(--space-3)] bg-[var(--bg)]"
      role="group"
      aria-label={t("participants")}
    >
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-[var(--space-3)] h-full">
        {participants.map((p) => (
          <ParticipantCard key={p.id} participant={p} />
        ))}
      </div>
    </div>
  );
}

/** 单个参与者卡片 */
function ParticipantCard({ participant }: { participant: Participant }) {
  const { name, isSpeaking, hasVideo, hasAudio } = participant;

  return (
    <div
      className={[
        "relative flex items-center justify-center rounded-[var(--radius-md)] overflow-hidden border-2 transition-colors duration-[var(--motion-fast)]",
        isSpeaking
          ? "border-[var(--accent)]"
          : "border-[var(--border-soft)]",
      ].join(" ")}
      // 视频占位区：黑色背景。LiveKit SDK 接入后替换为 <VideoTrack trackRef={...} />
      style={{ background: "var(--surface-2)" }}
      aria-label={name}
    >
      {/* 视频占位区（hasVideo=false 时显示用户名首字母） */}
      <div className="flex flex-col items-center justify-center w-full h-full min-h-[160px]">
        {hasVideo ? (
          // TODO: 安装 LiveKit SDK 后渲染 <VideoTrack trackRef={videoTrack} />
          <div className="w-full h-full bg-black flex items-center justify-center">
            <span className="text-[length:var(--text-sm)] text-[var(--accent-fg)] opacity-70">
              {name}
            </span>
          </div>
        ) : (
          <>
            {/* 头像占位（首字母圆圈） */}
            <div className="w-12 h-12 rounded-full bg-[var(--accent)] text-[var(--accent-fg)] flex items-center justify-center text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] mb-2">
              {name.charAt(0).toUpperCase()}
            </div>
            <span className="text-[length:var(--text-sm)] text-[var(--fg)] truncate max-w-full px-2">
              {name}
            </span>
          </>
        )}
      </div>

      {/* 麦克风状态图标（左下角） */}
      <div className="absolute bottom-2 left-2 inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--overlay)] text-[var(--accent-fg)]">
        {hasAudio ? (
          <Mic size={14} className="text-[var(--success)]" />
        ) : (
          <MicOff size={14} className="text-[var(--danger)]" />
        )}
      </div>

      {/* 说话指示器（右下角小圆点） */}
      {isSpeaking && (
        <div
          className="absolute bottom-2 right-2 w-2 h-2 rounded-full bg-[var(--accent)]"
          aria-hidden="true"
        />
      )}
    </div>
  );
}