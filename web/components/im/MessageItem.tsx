"use client";

/**
 * 单条消息气泡
 *
 * - 气泡布局：自己的消息靠右（accent 色），他人消息靠左（surface-2 色）
 * - 头像（24x24）
 * - 作者名（群聊显示，单聊可省略）
 * - 消息体（支持多行、URL 链接、@提及高亮）
 * - 时间（相对时间）
 * - 已读状态（CheckCheck 图标）
 * - 编辑标记（"已编辑"）
 * - 撤回状态（"消息已撤回"）
 * - 回复引用（显示被回复消息的摘要）
 * - 附件预览（图片缩略图 / 文件名）
 * - hover 时显示操作按钮（编辑、撤回、回复）
 * - 内联编辑：点击编辑后变为 textarea，保存/取消
 *
 * 所有样式走 design token（var(--*)），无裸 hex。
 * lucide-react 图标尺寸用 14/16（项目约定）。
 */

import { memo, useState, useCallback, type KeyboardEvent } from "react";
import {
  CheckCheck,
  Check,
  Edit,
  Trash,
  Reply,
  FileText,
  Download,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { Message } from "./types";

/** 回复引用摘要最大长度 */
const REPLY_PREVIEW_MAX = 50;
/** 消息体最大长度 */
const MAX_BODY_LENGTH = 10000;

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
}

/** 相对时间格式化（i18n） */
function formatRelativeTime(
  iso: string,
  t: (key: string, values?: { count?: number }) => string,
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
  return new Date(iso).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
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

/**
 * 渲染消息体：支持多行、URL 链接、@提及高亮。
 * 先按行分割，每行内识别 URL 和 @mention。
 */
function renderBody(body: string): React.ReactNode {
  const lines = body.split("\n");
  return lines.map((line, lineIdx) => (
    <span key={lineIdx}>
      {renderLine(line)}
      {lineIdx < lines.length - 1 && <br />}
    </span>
  ));
}

/** 渲染单行：识别 URL 和 @mention */
function renderLine(line: string): React.ReactNode[] {
  // 合并 URL 和 mention 的匹配
  const tokens: { text: string; type: "url" | "mention" | "text" }[] = [];
  let remaining = line;

  while (remaining.length > 0) {
    const urlMatch = remaining.match(URL_REGEX);
    const mentionMatch = remaining.match(MENTION_REGEX);

    const urlIdx = urlMatch ? remaining.indexOf(urlMatch[0]) : -1;
    const mentionIdx = mentionMatch ? remaining.indexOf(mentionMatch[0]) : -1;

    // 取最先匹配的
    if (urlIdx === -1 && mentionIdx === -1) {
      tokens.push({ text: remaining, type: "text" });
      break;
    }

    let chosenIdx: number;
    let chosenText: string;
    let chosenType: "url" | "mention";

    if (urlIdx !== -1 && (mentionIdx === -1 || urlIdx <= mentionIdx)) {
      chosenIdx = urlIdx;
      chosenText = urlMatch![0];
      chosenType = "url";
    } else {
      chosenIdx = mentionIdx;
      chosenText = mentionMatch![0];
      chosenType = "mention";
    }

    if (chosenIdx > 0) {
      tokens.push({ text: remaining.slice(0, chosenIdx), type: "text" });
    }
    tokens.push({ text: chosenText, type: chosenType });
    remaining = remaining.slice(chosenIdx + chosenText.length);
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
}: MessageItemProps) {
  const t = useTranslations("chat");
  const tTime = useTranslations("time");
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(message.body);

  const author = message.author;
  const displayName = author
    ? author.name ?? author.email ?? t("unknownUser")
    : t("unknownUser");
  const initial = (author?.name ?? author?.email ?? "?")[0]?.toUpperCase() ?? "?";

  const isRevoked = message.revokedAt !== null;
  const isEdited = message.editedAt !== null && !isRevoked;
  const timeStr = formatRelativeTime(message.createdAt, tTime);

  /** 进入编辑模式 */
  const handleStartEdit = useCallback(() => {
    setEditBody(message.body);
    setEditing(true);
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

  return (
    <div
      className={`group flex gap-[var(--space-2)] relative ${isOwn ? "flex-row-reverse" : "flex-row"}`}
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
            {message.body && <span>{renderBody(message.body)}</span>}

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
              <span title={t("read")}>
                <CheckCheck size={14} />
              </span>
            )}
          </div>
        )}
      </div>

      {/* hover 操作按钮 */}
      {!editing && !isRevoked && (
        <div
          className={`absolute top-0 ${isOwn ? "left-0" : "right-0"} opacity-0 group-hover:opacity-100 transition-opacity duration-[var(--motion-fast)] flex items-center gap-0.5 rounded-[var(--radius-sm)] bg-[var(--surface)] border border-[var(--border)] shadow-[var(--elev-sm)] p-0.5`}
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
                onClick={() => onRevoke(message.id)}
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
  );
}

export const MessageItem = memo(MessageItemImpl);