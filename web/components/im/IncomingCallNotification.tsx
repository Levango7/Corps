"use client";

/**
 * 实时来电通知组件
 *
 * 当 WebSocket 收到 call_invite 消息且通话仍在进行中时，
 * 浮动在 ChatWindow 顶部显示来电通知。
 *
 * - 显示发起人头像/名称、通话类型（语音/视频）
 * - "接听"按钮：跳转到 MeetingRoom
 * - "拒绝"按钮：发送 call_rejected 消息
 * - 通话结束（收到 call_ended）后自动关闭
 *
 * 所有样式走 design token（var(--*)），无裸 hex。
 * lucide-react 图标尺寸用 14/16（项目约定）。
 */

import { useCallback } from "react";
import { Phone, Video, PhoneOff } from "lucide-react";
import { useTranslations } from "next-intl";

export interface IncomingCallData {
  /** 消息 ID */
  messageId: string;
  /** 发起人用户 ID */
  callerId: string;
  /** 发起人名称 */
  callerName: string;
  /** 发起人头像 */
  callerImage: string | null;
  /** 通话类型：语音 / 视频 */
  callType: "voice" | "video";
  /** 会议链接（用于接听跳转） */
  meetingUrl: string;
  /** 会议 ID */
  meetingId: string;
}

interface IncomingCallNotificationProps {
  /** 来电数据 */
  callData: IncomingCallData | null;
  /** 接听通话：跳转到 MeetingRoom */
  onAccept: (callData: IncomingCallData) => void;
  /** 拒绝通话：发送 call_rejected 消息 */
  onReject: (callData: IncomingCallData) => void;
}

export function IncomingCallNotification({
  callData,
  onAccept,
  onReject,
}: IncomingCallNotificationProps) {
  const t = useTranslations("im");

  const handleAccept = useCallback(() => {
    if (callData) onAccept(callData);
  }, [callData, onAccept]);

  const handleReject = useCallback(() => {
    if (callData) onReject(callData);
  }, [callData, onReject]);

  if (!callData) return null;

  const isVideo = callData.callType === "video";

  return (
    <div className="absolute top-0 left-0 right-0 z-[var(--z-sticky)] px-[var(--space-4)] py-[var(--space-3)] bg-[var(--surface)] border-b border-[var(--border)] shadow-[var(--elev-sm)] animate-in slide-in-from-top duration-[var(--motion-fast)]">
      <div className="flex items-center gap-[var(--space-3)]">
        {/* 发起人头像 */}
        <div className="shrink-0 w-10 h-10 rounded-full bg-[var(--surface-3)] text-[var(--muted)] flex items-center justify-center text-[length:var(--text-base)] font-[weight:var(--weight-medium)] overflow-hidden">
          {callData.callerImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={callData.callerImage}
              alt={callData.callerName}
              className="w-full h-full object-cover"
            />
          ) : (
            (callData.callerName ?? "?")[0]?.toUpperCase() ?? "?"
          )}
        </div>

        {/* 通话信息 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {isVideo ? (
              <Video size={14} className="text-[var(--accent)]" />
            ) : (
              <Phone size={14} className="text-[var(--accent)]" />
            )}
            <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)] truncate">
              {callData.callerName}
            </span>
          </div>
          <span className="text-[length:var(--text-xs)] text-[var(--muted)]">
            {isVideo ? t("incomingVideoCall") : t("incomingVoiceCall")}
          </span>
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center gap-[var(--space-2)]">
          {/* 拒绝 */}
          <button
            type="button"
            onClick={handleReject}
            aria-label={t("rejectCall")}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--danger)] hover:text-[var(--accent-fg)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
          >
            <PhoneOff size={14} />
            {t("rejectCall")}
          </button>
          {/* 接听 */}
          <button
            type="button"
            onClick={handleAccept}
            aria-label={t("acceptCall")}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] bg-[var(--success)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--success-hover)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--success-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
          >
            {isVideo ? (
              <Video size={14} />
            ) : (
              <Phone size={14} />
            )}
            {t("acceptCall")}
          </button>
        </div>
      </div>
    </div>
  );
}