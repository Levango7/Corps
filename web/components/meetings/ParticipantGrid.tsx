"use client";

/**
 * 参与者视频网格 · components/meetings/ParticipantGrid.tsx
 *
 * 基于 LiveKit SDK 的自定义参与者网格：
 *  - useTracks 获取所有摄像头轨道引用（含占位，用于无视频参与者显示头像）
 *  - useParticipants 获取参与者元数据（名称、麦克风状态、说话状态）
 *  - 自适应网格布局：1 人全屏 / 2 人并排 / 3-4 人 2×2 / 5-6 人 3×2 / 7+ 人 3×3 分页
 *  - 说话者边框高亮（var(--accent)）
 *  - 麦克风状态图标（左下角）
 *
 * 必须在 <LiveKitRoom> 内使用（依赖 RoomContext）。
 */

import { Track } from "livekit-client";
import {
  useTracks,
  useParticipants,
  ParticipantTile,
  type TrackReferenceOrPlaceholder,
} from "@livekit/components-react";
import { Mic, MicOff } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Participant } from "livekit-client";

/** 单页最多展示 9 个参与者（3×3） */
const PAGE_SIZE = 9;

export interface ParticipantGridProps {
  /** 当前页码（从 1 开始），由父组件控制 */
  page?: number;
}

export function ParticipantGrid({ page = 1 }: ParticipantGridProps) {
  const t = useTranslations("meetings.room");

  // 获取所有摄像头轨道引用（含占位，无视频的参与者也会出现）
  const trackRefs = useTracks(
    [{ source: Track.Source.Camera, withPlaceholder: true }],
    { onlySubscribed: false },
  ) as TrackReferenceOrPlaceholder[];

  // 获取所有参与者（本地 + 远端），用于显示名称与麦克风状态
  const participants = useParticipants();

  if (trackRefs.length === 0) {
    return (
      <div
        className="flex-1 flex items-center justify-center bg-[var(--bg)]"
        role="status"
      >
        <p className="text-[length:var(--text-sm)] text-[var(--muted)]">
          {t("noParticipants")}
        </p>
      </div>
    );
  }

  // 分页切片
  const startIndex = (page - 1) * PAGE_SIZE;
  const pageTrackRefs = trackRefs.slice(startIndex, startIndex + PAGE_SIZE);

  // 根据当前页参与者数量决定网格列数
  const cols = getGridColumnCount(pageTrackRefs.length);

  return (
    <div
      className="flex-1 overflow-auto p-[var(--space-3)] bg-[var(--bg)]"
      role="group"
      aria-label={t("participants")}
    >
      <div
        className="grid gap-[var(--space-3)] h-full"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {pageTrackRefs.map((trackRef, idx) => (
          <ParticipantCell
            key={getTrackRefKey(trackRef, idx)}
            trackRef={trackRef}
            participants={participants}
          />
        ))}
      </div>
    </div>
  );
}

/** 根据参与者数量决定网格列数 */
function getGridColumnCount(count: number): number {
  if (count <= 1) return 1;
  if (count <= 2) return 2;
  if (count <= 4) return 2;
  if (count <= 6) return 3;
  return 3;
}

/** 生成 trackRef 的稳定 key */
function getTrackRefKey(
  trackRef: TrackReferenceOrPlaceholder,
  idx: number,
): string {
  const p = trackRef.participant;
  return `${p?.identity ?? "unknown"}-${idx}`;
}

/** 单个参与者单元格 */
function ParticipantCell({
  trackRef,
  participants,
}: {
  trackRef: TrackReferenceOrPlaceholder;
  participants: (Participant)[];
}) {
  const t = useTranslations("meetings.room");

  const identity = trackRef.participant?.identity;
  const participant = identity
    ? participants.find((p) => p.identity === identity)
    : undefined;

  const name = participant?.name ?? trackRef.participant?.name ?? t("participants");
  const isSpeaking = participant?.isSpeaking ?? false;
  // 麦克风轨道是否已发布且未静音
  const micPublication = participant?.getTrackPublication(Track.Source.Microphone);
  const hasAudio = micPublication?.isMuted === false && !!micPublication?.track;

  return (
    <div
      className={[
        "relative rounded-[var(--radius-md)] overflow-hidden border-2 transition-colors duration-[var(--motion-fast)] bg-[var(--surface-2)]",
        isSpeaking ? "border-[var(--accent)]" : "border-[var(--border-soft)]",
      ].join(" ")}
      aria-label={name}
    >
      {/* LiveKit 参与者视频磁贴（含视频/占位头像） */}
      <ParticipantTile trackRef={trackRef} className="w-full h-full min-h-[160px]" />

      {/* 麦克风状态图标（左下角） */}
      <div className="absolute bottom-2 left-2 inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--surface-3)] text-[var(--fg)] opacity-90">
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