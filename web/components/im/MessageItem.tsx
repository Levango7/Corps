"use client";

/**
 * 单条消息气泡
 *
 * - 气泡布局：自己的消息靠右（accent 色），他人消息靠左（surface-2 色）
 * - 头像（24x24）
 * - 作者名（群聊显示，单聊可省略）
 * - 消息体（支持多行、URL 链接、@提及高亮）
 * - 时间（相对时间）
 * - 已读状态（readByCount > 0 → CheckCheck，否则 Check）
 * - 编辑标记（"已编辑"）
 * - 撤回状态（"消息已撤回"）
 * - 回复引用（显示被回复消息的摘要）
 * - 附件预览（图片缩略图 / 文件名）
 * - 桌面端 hover 时显示操作按钮（编辑、撤回、回复）
 * - 移动端长按弹出底部操作菜单
 * - 撤回消息前弹出确认弹窗
 * - call_invite 卡片显示通话状态（进行中 / 已结束）
 * - 内联编辑：点击编辑后变为 textarea，保存/取消
 *
 * 所有样式走 design token（var(--*)），无裸 hex。
 * lucide-react 图标尺寸用 14/16（项目约定）。
 */

import { memo, useState, useCallback, useRef, useEffect, type KeyboardEvent, type TouchEvent } from "react";
import {
  CheckCheck,
  Check,
  Edit,
  Trash,
  Reply,
  FileText,
  Download,
  ListTodo,
  Video,
  PhoneOff,
} from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { Message } from "./types";

/** 回复引用摘要最大长度 */
const REPLY_PREVIEW_MAX = 50;
/** 消息体最大长度 */
const MAX_BODY_LENGTH = 10000;
/** 长按触发时长（ms） */
const LONG_PRESS_DURATION = 500;
/** 长按触发阈值（px），超过此距离则取消 */
const LONG_PRESS_TOLERANCE = 10;

interface MessageItemProps {
  /** 消息数据 */
  message: Message;
  /** 是否为自己的消息 */
  isOwn: boolean;
  /** 是否显示作者名（群聊显示，单聊可省略） */
  showAuthor: boolean;
  /** 编辑消息 */
  onEdit: (mid: string, body: string) => void;
  /** 撤回消息 */
  onRevoke: (mid: string) => void;
  /** 回复消息（可选） */
  onReply?: (mid: string) => void;
  /** 该 call_invite 消息对应的通话是否已结束（仅 call_invite 类型使用） */
  callEnded?: boolean;
}

/** 相对时间格式化（i18n） */
function formatRelativeTime(
  iso: string,
  t: (key: string, values?: { count?: number }) => string,
  locale: string,
): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diff = Math.max(0, Date.now() - then);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return t("justNow");
  const min = Math.floor(sec / 60);
  if (min < 60) return t("minutesAgo", { count: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("hoursAgo", { count: hr });
  const day = Math.floor(hr / 24);
  if (day < 30) return t("daysAgo", { count: day });
  return new Date(iso).toLocaleDateString(locale, { month: "numeric", day: "numeric" });
}

/** 格式化文件大小 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 判断是否为图片类型 */
function isImageAttachment(fileType: string): boolean {
  return fileType.startsWith("image/");
}

/** URL 正则 */
const URL_REGEX = /(https?:\/\/[^\s<>"']+)/g;
/** @提及正则 */
const MENTION_REGEX = /(@[\w\u4e00-\u9fa5]+)/g;
/** 任务链接正则：[task:taskId:taskTitle]（taskId 为 UUID，taskTitle 为任意非 ] 字符） */
const TASK_REGEX = /\[task:([a-zA-Z0-9-]+):([^\]]+)\]/g;

/** 任务链接 token（renderLine 中识别后渲染为任务卡片） */
interface TaskToken {
  taskId: string;
  taskTitle: string;
}

/**
 * 渲染消息体：支持多行、URL 链接、@提及高亮、任务卡片。
 * 先按行分割，每行内识别 URL、@mention 和 [task:...] 链接。
 * wid 用于构造任务卡片跳转链接 /w/{wid}/task/{taskId}。
 */
function renderBody(body: string, wid: string | undefined): React.ReactNode {
  const lines = body.split("\n");
  return lines.map((line, lineIdx) => (
    <span key={lineIdx}>
      {renderLine(line, wid)}
      {lineIdx < lines.length - 1 && <br />}
    </span>
  ));
}

/** 渲染单行：识别 URL、@mention 和 [task:...] 任务链接 */
function renderLine(line: string, wid: string | undefined): React.ReactNode[] {
  // 合并 URL、mention 和 task 的匹配
  const tokens: {
    text: string;
    type: "url" | "mention" | "task" | "text";
    task?: TaskToken;
  }[] = [];
  let remaining = line;

  while (remaining.length > 0) {
    const urlMatch = remaining.match(URL_REGEX);
    const mentionMatch = remaining.match(MENTION_REGEX);
    const taskMatch = remaining.match(TASK_REGEX);

    const urlIdx = urlMatch ? remaining.indexOf(urlMatch[0]) : -1;
    const mentionIdx = mentionMatch ? remaining.indexOf(mentionMatch[0]) : -1;
    const taskIdx = taskMatch ? remaining.indexOf(taskMatch[0]) : -1;

    // 三者都未匹配：剩余作为纯文本
    if (urlIdx === -1 && mentionIdx === -1 && taskIdx === -1) {
      tokens.push({ text: remaining, type: "text" });
      break;
    }

    // 取最先匹配的（最小索引）
    const candidates: Array<{ idx: number; type: "url" | "mention" | "task"; text: string }> = [];
    if (urlIdx !== -1) candidates.push({ idx: urlIdx, type: "url", text: urlMatch?.[0] ?? "" });
    if (mentionIdx !== -1)
      candidates.push({ idx: mentionIdx, type: "mention", text: mentionMatch?.[0] ?? "" });
    if (taskIdx !== -1) candidates.push({ idx: taskIdx, type: "task", text: taskMatch?.[0] ?? "" });

    candidates.sort((a, b) => a.idx - b.idx);
    const chosen = candidates[0];

    if (chosen.idx > 0) {
      tokens.push({ text: remaining.slice(0, chosen.idx), type: "text" });
    }

    if (chosen.type === "task") {
      // 解析 [task:taskId:taskTitle]
      const match = chosen.text.match(TASK_REGEX);
      // match 不会为 null（已确认 taskIdx !== -1）
      tokens.push({
        text: chosen.text,
        type: "task",
        task: { taskId: match?.[1] ?? "", taskTitle: match?.[2] ?? "" },
      });
    } else {
      tokens.push({ text: chosen.text, type: chosen.type });
    }
    remaining = remaining.slice(chosen.idx + chosen.text.length);
  }

  return tokens.map((tok, i) => {
    if (tok.type === "url") {
      return (
        <a
          key={i}
          href={tok.text}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:opacity-80 break-all"
        >
          {tok.text}
        </a>
      );
    }
    if (tok.type === "mention") {
      return (
        <span
          key={i}
          className="text-[var(--accent)] font-[weight:var(--weight-medium)]"
        >
          {tok.text}
        </span>
      );
    }
    if (tok.type === "task" && tok.task) {
      // 任务卡片：带边框的 inline 元素，点击跳转到任务详情页
      const href = wid ? `/w/${wid}/task/${tok.task.taskId}` : "#";
      return (
        <Link
          key={i}
          href={href}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-sm)] border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent)] hover:text-[var(--accent-fg)] transition-colors"
        >
          <ListTodo size={14} className="shrink-0" />
          <span className="truncate max-w-[200px]">{tok.task.taskTitle}</span>
        </Link>
      );
    }
    return <span key={i}>{tok.text}</span>;
  });
}

function MessageItemImpl({
  message,
  isOwn,
  showAuthor,
  onEdit,
  onRevoke,
  onReply,
  callEnded = false,
}: MessageItemProps) {
  const t = useTranslations("chat");
  const tIm = useTranslations("im");
  const tTime = useTranslations("time");
  const locale = useLocale();
  // 从路由 /[locale]/w/[wid]/im 获取当前工作区 ID（用于任务卡片跳转链接）
  const params = useParams<{ locale: string; wid: string }>();
  const wid = params?.wid;
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(message.body);
  // 撤回确认弹窗
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);
  // 移动端操作菜单（底部弹出）
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  // 长按手势检测
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);

  // 组件卸载时清理长按计时器，防止卸载后 setState
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    };
  }, []);

  const author = message.author;
  const displayName = author
    ? author.name ?? author.email ?? t("unknownUser")
    : t("unknownUser");
  const initial = (author?.name ?? author?.email ?? "?")[0]?.toUpperCase() ?? "?";

  const isRevoked = message.revokedAt !== null;
  const isEdited = message.editedAt !== null && !isRevoked;
  const timeStr = formatRelativeTime(message.createdAt, tTime, locale);
  // 已读回执：readByCount > 0 显示双勾（已读），否则显示单勾（已发送未读）
  const readByCount = message.readByCount ?? 0;
  const isRead = readByCount > 0;

  /** 进入编辑模式 */
  const handleStartEdit = useCallback(() => {
    setEditBody(message.body);
    setEditing(true);
    setShowMobileMenu(false);
  }, [message.body]);

  /** 保存编辑 */
  const handleSaveEdit = useCallback(() => {
    const trimmed = editBody.trim();
    if (!trimmed || trimmed === message.body) {
      setEditing(false);
      return;
    }
    onEdit(message.id, trimmed);
    setEditing(false);
  }, [editBody, message.id, message.body, onEdit]);

  /** 取消编辑 */
  const handleCancelEdit = useCallback(() => {
    setEditing(false);
    setEditBody(message.body);
  }, [message.body]);

  /** 编辑框键盘事件 */
  const handleEditKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSaveEdit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleCancelEdit();
      }
    },
    [handleSaveEdit, handleCancelEdit],
  );

  /** 确认撤回消息 */
  const handleConfirmRevoke = useCallback(() => {
    setShowRevokeConfirm(false);
    setShowMobileMenu(false);
    onRevoke(message.id);
  }, [message.id, onRevoke]);

  /** 长按开始：启动计时器 */
  const handleTouchStart = useCallback(
    (e: TouchEvent<HTMLDivElement>) => {
      const touch = e.touches[0];
      longPressStartRef.current = { x: touch.clientX, y: touch.clientY };
      longPressTimerRef.current = setTimeout(() => {
        setShowMobileMenu(true);
        // 触觉反馈（如果设备支持）
        if (typeof navigator !== "undefined" && navigator.vibrate) {
          navigator.vibrate(50);
        }
      }, LONG_PRESS_DURATION);
    },
    [],
  );

  /** 长按结束：清除计时器 */
  const handleTouchEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
  }, []);

  /** 长按移动：超过阈值则取消 */
  const handleTouchMove = useCallback(
    (e: TouchEvent<HTMLDivElement>) => {
      const start = longPressStartRef.current;
      if (!start) return;
      const touch = e.touches[0];
      const dx = Math.abs(touch.clientX - start.x);
      const dy = Math.abs(touch.clientY - start.y);
      if (dx > LONG_PRESS_TOLERANCE || dy > LONG_PRESS_TOLERANCE) {
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
      }
    },
    [],
  );

  // 撤回消息：只显示"消息已撤回"
  if (isRevoked) {
    return (
      <div className={`flex gap-[var(--space-2)] ${isOwn ? "flex-row-reverse" : "flex-row"}`}>
        {/* 头像 */}
        <div className="shrink-0 w-6 h-6 rounded-full bg-[var(--surface-3)] text-[var(--muted)] flex items-center justify-center text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] overflow-hidden">
          {author?.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={author.image} alt={displayName} className="w-full h-full object-cover" />
          ) : (
            initial
          )}
        </div>
        <div className={`flex flex-col ${isOwn ? "items-end" : "items-start"}`}>
          <div className="px-[var(--space-3)] py-[var(--space-2)] rounded-[var(--radius-md)] bg-[var(--surface-2)] text-[var(--meta)] text-[length:var(--text-sm)] italic">
            {t("messageRevoked")}
          </div>
        </div>
      </div>
    );
  }

  // ── call / system 消息特殊渲染 ──
  const messageType = message.type ?? "text";

  // call_ended / call_rejected / system: 居中系统消息（灰色、无气泡、居中）
  if (
    messageType === "call_ended" ||
    messageType === "call_rejected" ||
    messageType === "system"
  ) {
    const systemText =
      messageType === "call_ended"
        ? tIm("callEnded")
        : messageType === "call_rejected"
          ? tIm("callRejected")
          : message.body;
    return (
      <div className="flex justify-center py-1">
        <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
          {systemText}
        </span>
      </div>
    );
  }

  // call_invite: 通话邀请卡片（含通话状态 + "加入通话"按钮）
  if (messageType === "call_invite") {
    const meetingUrl = message.meetingUrl;
    const callStatus = message.callStatus ?? "ongoing";
    const isCallEnded = callStatus === "ended" || callStatus === "rejected";
    return (
      <div className="flex justify-center py-2">
        <div className="inline-flex flex-col items-center gap-2 px-4 py-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] max-w-[280px]">
          {isCallEnded ? (
            <PhoneOff size={16} className="text-[var(--meta)]" />
          ) : (
            <Video size={16} className="text-[var(--accent)]" />
          )}
          <span className="text-[length:var(--text-sm)] text-[var(--fg)] text-center">
            {tIm("callInvite")}
          </span>
          {isCallEnded ? (
            <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
              {callStatus === "rejected" ? tIm("callRejected") : tIm("callEndedLabel")}
            </span>
          ) : (
            <>
              <span className="text-[length:var(--text-xs)] text-[var(--accent)]">
                {tIm("callInProgress")}
              </span>
              {meetingUrl && (
                <Link
                  href={meetingUrl}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-fast)]"
                >
                  {tIm("joinCall")}
                </Link>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        className={`group flex gap-[var(--space-2)] relative ${isOwn ? "flex-row-reverse" : "flex-row"}`}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchMove}
      >
        {/* 头像 */}
        <div className="shrink-0 w-6 h-6 rounded-full bg-[var(--surface-3)] text-[var(--muted)] flex items-center justify-center text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] overflow-hidden">
          {author?.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={author.image} alt={displayName} className="w-full h-full object-cover" />
          ) : (
            initial
          )}
        </div>

        {/* 气泡 */}
        <div className={`min-w-0 max-w-[70%] flex flex-col ${isOwn ? "items-end" : "items-start"}`}>
          {/* 作者名（群聊且非自己的消息） */}
          {showAuthor && !isOwn && (
            <span className="text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--fg)] mb-0.5">
              {displayName}
            </span>
          )}

          {/* 回复引用 */}
          {message.replyTo && (
            <div
              className={`mb-1 px-[var(--space-2)] py-1 rounded-[var(--radius-sm)] border-l-2 border-[var(--accent)] bg-[var(--surface-2)] text-[length:var(--text-xs)] text-[var(--muted)] max-w-full truncate ${
                isOwn ? "text-right" : "text-left"
              }`}
            >
              <span className="text-[var(--accent)] font-[weight:var(--weight-medium)]">
                {message.replyTo.author?.name ?? t("unknownUser")}:
              </span>{" "}
              {message.replyTo.body.slice(0, REPLY_PREVIEW_MAX)}
              {message.replyTo.body.length > REPLY_PREVIEW_MAX ? "…" : ""}
            </div>
          )}

          {/* 消息体 */}
          {editing ? (
            // 编辑模式
            <div className="w-full">
              <textarea
                value={editBody}
                onChange={(e) => setEditBody(e.target.value.slice(0, MAX_BODY_LENGTH))}
                onKeyDown={handleEditKeyDown}
                rows={Math.min(5, editBody.split("\n").length)}
                autoFocus
                className="w-full px-[var(--space-3)] py-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--accent)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none resize-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
              />
              <div className={`flex gap-[var(--space-2)] mt-1 ${isOwn ? "justify-end" : "justify-start"}`}>
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="px-[var(--space-2)] py-1 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] text-[var(--muted)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
                >
                  {t("cancel")}
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  className="px-[var(--space-2)] py-1 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-fast)]"
                >
                  {t("save")}
                </button>
              </div>
            </div>
          ) : (
            <div
              className={`px-[var(--space-3)] py-[var(--space-2)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] leading-[var(--leading-relaxed)] break-words ${
                isOwn
                  ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                  : "bg-[var(--surface-2)] text-[var(--fg)]"
              }`}
            >
              {/* 正文 */}
              {message.body && <span>{renderBody(message.body, wid)}</span>}

              {/* 附件列表 */}
              {message.attachments.length > 0 && (
                <div className={`space-y-1 ${message.body ? "mt-1 pt-1" : ""}`}>
                  {message.attachments.map((att) =>
                    isImageAttachment(att.fileType) && att.thumbnailUrl ? (
                      // 图片附件：缩略图
                      <a
                        key={att.id}
                        href={att.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block rounded-[var(--radius-sm)] overflow-hidden hover:opacity-90 transition-opacity cursor-zoom-in"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={att.thumbnailUrl}
                          alt={att.fileName}
                          className="max-w-[200px] max-h-[150px] object-cover"
                        />
                      </a>
                    ) : (
                      // 文档附件：文件卡片
                      <a
                        key={att.id}
                        href={att.url}
                        download={att.fileName}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--radius-sm)] border ${
                          isOwn
                            ? "border-[color-mix(in_srgb,var(--accent-fg)_20%,transparent)] bg-[color-mix(in_srgb,var(--accent-fg)_10%,transparent)]"
                            : "border-[var(--border)] bg-[var(--surface-3)]"
                        } hover:opacity-80 transition-opacity min-w-0 sm:min-w-[200px]`}
                      >
                        <FileText size={16} className="shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] truncate">
                            {att.fileName}
                          </div>
                          <div className="text-[length:var(--text-xs)] opacity-70">
                            {formatFileSize(att.fileSize)}
                          </div>
                        </div>
                        <Download size={14} className="shrink-0 opacity-70" />
                      </a>
                    ),
                  )}
                </div>
              )}
            </div>
          )}

          {/* 元信息行：时间 + 已编辑 + 已读 */}
          {!editing && (
            <div
              className={`mt-0.5 flex items-center gap-1 text-[length:var(--text-xs)] text-[var(--meta)] ${isOwn ? "flex-row-reverse" : "flex-row"}`}
            >
              <span>{timeStr}</span>
              {isEdited && <span className="italic">· {t("edited")}</span>}
              {isOwn && (
                <span title={isRead ? t("read") : t("sent")}>
                  {isRead ? <CheckCheck size={14} /> : <Check size={14} />}
                </span>
              )}
            </div>
          )}
        </div>

        {/* hover 操作按钮 — 仅桌面端（支持 hover 的设备）显示 */}
        {!editing && !isRevoked && (
          <div
            className={`absolute top-0 ${isOwn ? "left-0" : "right-0"} opacity-0 group-hover:opacity-100 transition-opacity duration-[var(--motion-fast)] flex items-center gap-0.5 rounded-[var(--radius-sm)] bg-[var(--surface)] border border-[var(--border)] shadow-[var(--elev-sm)] p-0.5 [@media(hover:hover)]:flex hidden`}
          >
            {onReply && (
              <button
                type="button"
                onClick={() => onReply(message.id)}
                aria-label={t("reply")}
                className="w-6 h-6 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
              >
                <Reply size={14} />
              </button>
            )}
            {isOwn && (
              <>
                <button
                  type="button"
                  onClick={handleStartEdit}
                  aria-label={t("edit")}
                  className="w-6 h-6 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
                >
                  <Edit size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => setShowRevokeConfirm(true)}
                  aria-label={t("revoke")}
                  className="w-6 h-6 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] transition-colors duration-[var(--motion-fast)]"
                >
                  <Trash size={14} />
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* 撤回确认弹窗 */}
      {showRevokeConfirm && (
        <div
          className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-[var(--overlay)] p-[var(--space-4)]"
          role="dialog"
          aria-modal="true"
          aria-label={t("confirmRevoke")}
          onClick={() => setShowRevokeConfirm(false)}
        >
          <div
            className="w-full max-w-sm rounded-[var(--radius-lg)] bg-[var(--surface)] border border-[var(--border)] shadow-[var(--elev-lg)] p-[var(--space-5)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)] mb-[var(--space-2)]">
              {t("confirmRevoke")}
            </h3>
            <div className="flex items-center justify-end gap-[var(--space-2)] mt-[var(--space-4)]">
              <button
                type="button"
                onClick={() => setShowRevokeConfirm(false)}
                className="h-8 px-[var(--space-3)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={handleConfirmRevoke}
                className="h-8 px-[var(--space-3)] rounded-[var(--radius-md)] bg-[var(--danger)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:opacity-90 transition-opacity duration-[var(--motion-fast)]"
              >
                {t("confirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 移动端底部操作菜单 */}
      {showMobileMenu && (
        <div
          className="fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-[var(--overlay)]"
          role="dialog"
          aria-modal="true"
          aria-label={t("moreActions")}
          onClick={() => setShowMobileMenu(false)}
        >
          <div
            className="w-full max-w-sm rounded-t-[var(--radius-lg)] bg-[var(--surface)] border border-[var(--border)] shadow-[var(--elev-lg)] p-[var(--space-3)] pb-safe"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 操作选项 */}
            <div className="flex flex-col gap-[var(--space-1)]">
              {onReply && (
                <button
                  type="button"
                  onClick={() => {
                    onReply(message.id);
                    setShowMobileMenu(false);
                  }}
                  className="flex items-center gap-[var(--space-3)] px-[var(--space-4)] py-[var(--space-3)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] text-[var(--fg)] hover:bg-[var(--surface-2)] active:bg-[var(--surface-3)] transition-colors duration-[var(--motion-fast)]"
                >
                  <Reply size={16} className="text-[var(--muted)]" />
                  {t("reply")}
                </button>
              )}
              {isOwn && (
                <>
                  <button
                    type="button"
                    onClick={handleStartEdit}
                    className="flex items-center gap-[var(--space-3)] px-[var(--space-4)] py-[var(--space-3)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] text-[var(--fg)] hover:bg-[var(--surface-2)] active:bg-[var(--surface-3)] transition-colors duration-[var(--motion-fast)]"
                  >
                    <Edit size={16} className="text-[var(--muted)]" />
                    {t("edit")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowMobileMenu(false);
                      setShowRevokeConfirm(true);
                    }}
                    className="flex items-center gap-[var(--space-3)] px-[var(--space-4)] py-[var(--space-3)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] text-[var(--danger)] hover:bg-[var(--danger-soft)] active:bg-[var(--danger-soft)] transition-colors duration-[var(--motion-fast)]"
                  >
                    <Trash size={16} />
                    {t("revoke")}
                  </button>
                </>
              )}
            </div>
            {/* 取消按钮 */}
            <button
              type="button"
              onClick={() => setShowMobileMenu(false)}
              className="w-full mt-[var(--space-2)] px-[var(--space-4)] py-[var(--space-3)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] text-[var(--fg-2)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)] transition-colors duration-[var(--motion-fast)]"
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export const MessageItem = memo(MessageItemImpl);
