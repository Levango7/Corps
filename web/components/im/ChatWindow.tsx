"use client";

/**
 * 聊天窗口主体
 *
 * - 顶部：会话标题 + 成员数 + 设置按钮
 * - 中间：MessageList（消息列表）
 * - 底部：MessageInput（消息输入区，支持 @提及/文件上传/字数计数）
 * - 回复引用：点击回复时由 MessageInput 上方显示被回复消息摘要
 *
 * 所有样式走 design token（var(--*)），无裸 hex。
 * lucide-react 图标尺寸用 14/16（项目约定）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Settings, Users, Video, Phone, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter, useParams } from "next/navigation";
import type { Conversation, Message, SendMessageOptions } from "./types";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import {
  IncomingCallNotification,
  type IncomingCallData,
} from "./IncomingCallNotification";
import { api } from "@/lib/api";

/** 通话超时：5 分钟内对方未加入则自动发送 call_ended */
const CALL_TIMEOUT_MS = 5 * 60 * 1000;

interface ChatWindowProps {
  /** 当前会话 */
  conversation: Conversation;
  /** 消息列表 */
  messages: Message[];
  /** 当前用户 ID */
  currentUserId: string;
  /** 发送消息 */
  onSend: (body: string, opts?: SendMessageOptions) => void;
  /** 编辑消息 */
  onEdit: (mid: string, body: string) => void;
  /** 撤回消息 */
  onRevoke: (mid: string) => void;
  /** 加载更多历史消息（向上滚动触发） */
  onLoadMore?: () => void;
  /** 是否正在加载更多历史消息 */
  loadingMore?: boolean;
  /** 点击设置按钮（可选） */
  onSettings?: () => void;
  /** 正在输入的用户 ID 列表（当前会话） */
  typingUserIds?: string[];
}

export function ChatWindow({
  conversation,
  messages,
  currentUserId,
  onSend,
  onEdit,
  onRevoke,
  onLoadMore,
  loadingMore = false,
  onSettings,
  typingUserIds = [],
}: ChatWindowProps) {
  const t = useTranslations("chat");
  const tIm = useTranslations("im");
  const router = useRouter();
  const params = useParams<{ locale: string; wid: string }>();
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [isCalling, setIsCalling] = useState(false);
  const [isVoiceCalling, setIsVoiceCalling] = useState(false);
  const [incomingCall, setIncomingCall] = useState<IncomingCallData | null>(
    null,
  );
  const callTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const incomingCallRef = useRef<IncomingCallData | null>(null);

  // 组件卸载时清理超时计时器，防止内存泄漏
  useEffect(() => {
    return () => {
      if (callTimeoutRef.current) {
        clearTimeout(callTimeoutRef.current);
        callTimeoutRef.current = null;
      }
    };
  }, []);

  // 监听消息列表中的 call_invite / call_ended / call_rejected 消息
  // 收到 call_invite → 弹出来电通知；收到 call_ended / call_rejected → 关闭来电通知
  useEffect(() => {
    if (messages.length === 0) return;
    // 从最新消息向前扫描，查找最近的通话相关消息
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const msgType = msg.type ?? "text";

      if (msgType === "call_ended" || msgType === "call_rejected") {
        // 通话已结束/被拒绝 → 关闭来电通知
        setIncomingCall(null);
        incomingCallRef.current = null;
        break;
      }

      if (msgType === "call_invite") {
        // 仅当消息不是自己发送的（别人发起的通话邀请）且当前没有来电通知时才弹出
        if (msg.authorId !== currentUserId && !incomingCallRef.current) {
          // 从消息体中解析会议链接
          const bodyMatch = msg.body?.match(
            /(\/[a-z]+\/w\/[a-zA-Z0-9-]+\/meetings\/[a-zA-Z0-9-]+)/,
          );
          const meetingUrl = bodyMatch?.[1] ?? msg.meetingUrl ?? "";
          const meetingIdMatch = meetingUrl.match(/meetings\/([a-zA-Z0-9-]+)/);
          const meetingId = meetingIdMatch?.[1] ?? "";

          // 判断通话类型：消息体中包含"语音"关键词则为语音通话
          const isVoice = msg.body?.includes("语音") || msg.body?.includes("voice") || false;

          const callData: IncomingCallData = {
            messageId: msg.id,
            callerId: msg.authorId ?? "",
            callerName: msg.author?.name ?? msg.author?.email ?? t("unknownUser"),
            callerImage: msg.author?.image ?? null,
            callType: isVoice ? "voice" : "video",
            meetingUrl,
            meetingId,
          };
          setIncomingCall(callData);
          incomingCallRef.current = callData;
        }
        break;
      }
    }
  }, [messages, currentUserId, t]);

  const isGroup = conversation.type === "group";

  // 单聊：找对方成员作为标题
  const otherMember = !isGroup
    ? conversation.members.find((m) => m.userId !== currentUserId)
    : null;
  const title = isGroup
    ? conversation.title ?? t("groupConversation")
    : otherMember?.user.name ?? otherMember?.user.email ?? t("unknownUser");

  /**
   * 发起通话（视频或语音）：
   * 1. 创建 instant meeting（POST /api/v1/workspaces/{wid}/meetings）
   * 2. 发送 call_invite 系统消息（body 含会议链接，通知对方加入）
   * 3. 跳转到会议页面（跳过大厅，直接进入会议室）
   *
   * @param videoEnabled true=视频通话, false=语音通话
   */
  const handleCall = useCallback(
    async (videoEnabled: boolean) => {
      if (isCalling || isVoiceCalling) return;
      const wid = conversation.workspaceId;
      const locale = params?.locale ?? "zh";
      if (videoEnabled) {
        setIsCalling(true);
      } else {
        setIsVoiceCalling(true);
      }
      try {
        // 创建即时会议
        const meeting = await api<{ id: string }>(
          `/api/v1/workspaces/${wid}/meetings`,
          {
            method: "POST",
            body: JSON.stringify({
              title: videoEnabled ? tIm("videoCall") : tIm("voiceCall"),
              type: "instant",
              videoEnabled,
            }),
          },
        );

        // 发送 call_invite 消息（body 包含会议链接，对方可点击加入）
        const meetingUrl = `/${locale}/w/${wid}/meetings/${meeting.id}`;
        onSend(
          `${videoEnabled ? tIm("callInvite") : tIm("voiceCallInvite")}: ${meetingUrl}`,
          { type: "call_invite" },
        );

        // 设置超时：如果对方未加入，自动发送 call_ended 消息
        const meetingId = meeting.id;
        if (callTimeoutRef.current) {
          clearTimeout(callTimeoutRef.current);
        }
        callTimeoutRef.current = setTimeout(async () => {
          try {
            const meetingData = await api<{
              status: string;
              participants: Array<{ userId: string; joinedAt: string }>;
            }>(`/api/v1/workspaces/${wid}/meetings/${meetingId}`);
            // 会议已结束 或 无其他参与者（只有发起者自己）→ 发送 call_ended
            const hasOtherParticipants =
              (meetingData?.participants ?? []).length > 1;
            if (meetingData?.status === "ended" || !hasOtherParticipants) {
              onSend(tIm("callEnded"), { type: "call_ended" });
            }
          } catch {
            // API 检查失败时不发送，避免误报
          }
          callTimeoutRef.current = null;
        }, CALL_TIMEOUT_MS);

        // 跳转到会议页面，跳过大厅直接进入会议室（skipLobby=true）
        router.push(
          `${meetingUrl}?conversationId=${conversation.id}&skipLobby=true`,
        );
      } catch {
        // 静默失败：网络错误时用户可重试
      } finally {
        if (videoEnabled) {
          setIsCalling(false);
        } else {
          setIsVoiceCalling(false);
        }
      }
    },
    [
      conversation.workspaceId,
      conversation.id,
      onSend,
      router,
      params,
      tIm,
      isCalling,
      isVoiceCalling,
    ],
  );

  /** 发起视频通话 */
  const handleVideoCall = useCallback(() => handleCall(true), [handleCall]);

  /** 发起语音通话 */
  const handleVoiceCall = useCallback(() => handleCall(false), [handleCall]);

  /** 接听来电：跳转到 MeetingRoom */
  const handleAcceptCall = useCallback(
    (callData: IncomingCallData) => {
      setIncomingCall(null);
      incomingCallRef.current = null;
      const wid = conversation.workspaceId;
      const locale = params?.locale ?? "zh";
      // 跳转到会议页面，跳过大厅直接进入会议室
      router.push(
        `/${locale}${callData.meetingUrl}?conversationId=${conversation.id}&skipLobby=true`,
      );
    },
    [router, conversation.id, conversation.workspaceId, params],
  );

  /** 拒绝来电：发送 call_rejected 消息 */
  const handleRejectCall = useCallback(
    (callData: IncomingCallData) => {
      setIncomingCall(null);
      incomingCallRef.current = null;
      onSend(tIm("callRejected"), { type: "call_rejected" });
    },
    [onSend, tIm],
  );

  /** 点击回复 */
  const handleReply = useCallback((mid: string) => {
    const msg = messages.find((m) => m.id === mid);
    if (msg) setReplyTo(msg);
  }, [messages]);

  /** 取消回复 */
  const handleCancelReply = useCallback(() => {
    setReplyTo(null);
  }, []);

  /** 回复引用目标（转换为 MessageInput 期望的格式） */
  const replyTarget = useMemo(
    () =>
      replyTo
        ? {
            id: replyTo.id,
            authorName: replyTo.author?.name ?? t("unknownUser"),
            body: replyTo.body,
          }
        : null,
    [replyTo, t],
  );

  /** 可提及的成员列表（群聊才需要，单聊只有两人也一并传入） */
  const mentionMembers = useMemo(
    () =>
      conversation.members.map((m) => ({
        userId: m.userId,
        user: {
          id: m.user.id,
          name: m.user.name,
          image: m.user.image,
        },
      })),
    [conversation.members],
  );

  /**
   * 正在输入提示文本。
   * - 1 人：xxx 正在输入…
   * - 2 人：xxx、yyy 正在输入…
   * - 3+ 人：多人正在输入…
   * 排除当前用户自己（自己输入不提示）。
   * 复用现有 i18n key: chat.typing ({names} 正在输入…) / chat.typingMany
   */
  const typingText = useMemo(() => {
    if (typingUserIds.length === 0) return "";
    // 过滤掉当前用户，并将 userId 映射到显示名
    const others = typingUserIds
      .filter((id) => id !== currentUserId)
      .map((id) => {
        const member = conversation.members.find((m) => m.userId === id);
        return member?.user.name ?? t("unknownUser");
      });
    if (others.length === 0) return "";
    if (others.length <= 2) return t("typing", { names: others.join("、") });
    return t("typingMany");
  }, [typingUserIds, currentUserId, conversation.members, t]);

  return (
    <div className="relative flex flex-col h-full bg-[var(--surface)]">
      {/* 实时来电通知（浮动在顶部） */}
      <IncomingCallNotification
        callData={incomingCall}
        onAccept={handleAcceptCall}
        onReject={handleRejectCall}
      />

      {/* 顶部 Header */}
      <div className="flex items-center justify-between gap-[var(--space-3)] px-[var(--space-4)] py-[var(--space-3)] border-b border-[var(--border)]">
        <div className="flex items-center gap-[var(--space-2)] min-w-0">
          {/* 会话标题 */}
          <h2
            className="truncate text-[length:var(--text-base)] font-[weight:var(--weight-semibold)] text-[var(--fg)]"
            title={title}
          >
            {title}
          </h2>
          {/* 成员数（群聊显示） */}
          {isGroup && (
            <span className="shrink-0 flex items-center gap-1 text-[length:var(--text-xs)] text-[var(--muted)]">
              <Users size={14} />
              {conversation.members.length}
            </span>
          )}
        </div>
        {/* 语音通话 + 视频通话 + 设置按钮 */}
        <div className="flex items-center gap-[var(--space-1)]">
          {/* 语音通话按钮：创建即时语音会议 → 发送 call_invite → 跳转会议页 */}
          <button
            type="button"
            onClick={handleVoiceCall}
            disabled={isVoiceCalling || isCalling}
            aria-label={
              isVoiceCalling ? tIm("calling") : tIm("voiceCall")
            }
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-[var(--radius-md)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)] focus-visible:outline-offset-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-[var(--muted)]"
          >
            {isVoiceCalling ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Phone size={16} />
            )}
          </button>
          {/* 视频通话按钮：创建即时视频会议 → 发送 call_invite → 跳转会议页 */}
          <button
            type="button"
            onClick={handleVideoCall}
            disabled={isCalling || isVoiceCalling}
            aria-label={isCalling ? tIm("calling") : tIm("videoCall")}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-[var(--radius-md)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)] focus-visible:outline-offset-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-[var(--muted)]"
          >
            {isCalling ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Video size={16} />
            )}
          </button>
          {/* 设置按钮 */}
          {onSettings && (
            <button
              type="button"
              onClick={onSettings}
              aria-label={t("settings")}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-[var(--radius-md)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)] focus-visible:outline-offset-2"
            >
              <Settings size={16} />
            </button>
          )}
        </div>
      </div>

      {/* 消息列表 */}
      <MessageList
        messages={messages}
        currentUserId={currentUserId}
        onEdit={onEdit}
        onRevoke={onRevoke}
        onReply={handleReply}
        onLoadMore={onLoadMore}
        hasMore={conversation.hasMoreMessages}
        loading={loadingMore}
      />

      {/* 正在输入指示器：紧贴输入框上方，仅当有 typing 文本时显示 */}
      {typingText && (
        <div
          className="px-[var(--space-4)] pt-[var(--space-2)] animate-pulse"
          aria-live="polite"
        >
          <span className="text-[length:var(--text-xs)] text-[var(--muted)]">
            {typingText}
          </span>
        </div>
      )}

      {/* 底部输入区：MessageInput 集成 @提及/文件上传/字数计数/AI 回复建议 */}
      <div className="border-t border-[var(--border)] px-[var(--space-4)] py-[var(--space-3)]">
        <MessageInput
          onSend={onSend}
          replyTo={replyTarget}
          onCancelReply={handleCancelReply}
          members={mentionMembers}
          conversationId={conversation.id}
        />
      </div>
    </div>
  );
}