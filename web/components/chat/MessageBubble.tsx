"use client";

import { Check, CheckCheck, FileText, Download } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ChatMessage, Person, MessageAttachment } from "./types";

/**
 * 单条消息气泡
 *
 * - 自己的消息：右对齐，accent 背景色
 * - 他人的消息：左对齐，surface-2 背景色，显示作者名
 * - 已读回执：双勾✓✓（已读）/ 单勾✓（未读）
 * - 文件附件：图片显示缩略图，文档显示文件卡片
 * - 未读高亮：左侧 3px 色条
 */

interface MessageBubbleProps {
  /** 消息 */
  message: ChatMessage;
  /** 当前用户 ID */
  currentUserId: string;
  /** 是否未读（用于高亮） */
  unread: boolean;
  /** 搜索关键词（用于高亮匹配文本） */
  searchQuery: string;
}

/** 格式化文件大小 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 判断是否为图片类型 */
function isImageAttachment(att: MessageAttachment): boolean {
  return att.fileType.startsWith("image/");
}

/** 高亮搜索关键词 */
function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark key={i} className="bg-[var(--accent-soft)] text-[var(--accent-fg)] rounded-sm px-0.5">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

export function MessageBubble({ message, currentUserId, unread, searchQuery }: MessageBubbleProps) {
  const t = useTranslations("chat");
  const isOwn = message.authorId === currentUserId;
  const author = message.author;
  const displayName = author ? author.name || author.email.split("@")[0] : t("unknownUser");
  const initial = (author ? author.name || author.email : "?")[0]?.toUpperCase();

  // 已读回执：自己发的消息才显示
  const readCount = message.reads?.length ?? 0;
  const isRead = isOwn && readCount > 0;

  return (
    <div
      className={`flex gap-[var(--space-2)] ${isOwn ? "flex-row-reverse" : "flex-row"} relative`}
    >
      {/* 未读高亮色条 */}
      {unread && (
        <span className="absolute left-0 top-0 bottom-0 w-[3px] rounded-full bg-[var(--accent)]" />
      )}

      {/* 头像 */}
      <div className="w-6 h-6 shrink-0 rounded-full bg-[var(--surface-3)] text-[var(--fg-2)] flex items-center justify-center text-[length:var(--text-xs)] font-[var(--weight-medium)] overflow-hidden">
        {author?.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={author.image} alt={displayName} className="w-full h-full object-cover" />
        ) : (
          initial
        )}
      </div>

      {/* 气泡 */}
      <div className={`min-w-0 max-w-[70%] ${isOwn ? "items-end" : "items-start"} flex flex-col`}>
        {!isOwn && (
          <span className="text-[length:var(--text-xs)] font-[var(--weight-medium)] text-[var(--fg)] mb-0.5">
            {displayName}
          </span>
        )}
        <div
          className={`px-[var(--space-3)] py-[var(--space-2)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] leading-[1.6] whitespace-pre-wrap break-words ${
            isOwn
              ? "bg-[var(--accent)] text-[var(--accent-fg)]"
              : "bg-[var(--surface-2)] text-[var(--fg-2)]"
          }`}
        >
          {message.body && (
            <span>{highlightText(message.body, searchQuery)}</span>
          )}
          {/* 附件列表 */}
          {message.attachments && message.attachments.length > 0 && (
            <div className={`mt-1 space-y-1 ${message.body ? "pt-1" : ""}`}>
              {message.attachments.map((att) =>
                isImageAttachment(att) && att.thumbnailUrl ? (
                  // 图片附件：缩略图
                  <a
                    key={att.id}
                    href={att.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-[var(--radius-sm)] overflow-hidden hover:opacity-90 transition-opacity"
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
                    target="_blank"
                    rel="noopener noreferrer"
                    download={att.fileName}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--radius-sm)] border ${
                      isOwn
                        ? "border-[var(--accent-fg)]/20 bg-[var(--accent-fg)]/10"
                        : "border-[var(--border)] bg-[var(--surface-3)]"
                    } hover:opacity-80 transition-opacity min-w-[200px]`}
                  >
                    <FileText size={16} className="shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium truncate">{att.fileName}</div>
                      <div className="text-[10px] opacity-70">{formatFileSize(att.fileSize)}</div>
                    </div>
                    <Download size={14} className="shrink-0 opacity-70" />
                  </a>
                ),
              )}
            </div>
          )}
        </div>

        {/* 已读回执（仅自己的消息显示） */}
        {isOwn && (
          <span
            className={`mt-0.5 flex items-center gap-0.5 text-[length:var(--text-xs)] ${
              isRead ? "text-[var(--accent-success)]" : "text-[var(--meta)]"
            }`}
            title={isRead ? t("readBy", { count: readCount }) : t("unread")}
          >
            {isRead ? <CheckCheck size={14} /> : <Check size={14} />}
          </span>
        )}
      </div>
    </div>
  );
}