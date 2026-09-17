"use client";

import { useRef, useState } from "react";
import { AttachmentPreviewModal } from "@/components/AttachmentPreviewModal";

import { Check, CheckCheck, FileText, Download, MoreHorizontal, Pencil, Undo2, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ChatMessage, MessageAttachment } from "./types";

/**
 * 单条消息气泡
 *
 * - 自己的消息：右对齐，accent 背景色
 * - 他人的消息：左对齐，surface-2 背景色，显示作者名
 * - 已读回执：双勾✓✓（已读）/ 单勾✓（未读）
 * - 文件附件：图片显示缩略图，文档显示文件卡片
 * - 未读高亮：左侧 3px 色条
 */

export type EditableChatMessage = ChatMessage & {
  workspaceId?: string;
  taskId?: string | null;
  isRecalled?: boolean;
  revokedAt?: string | null;
  editedAt?: string | null;
};

interface MessageBubbleProps {
  /** 消息 */
  message: EditableChatMessage;
  onMessageUpdated?: (message: EditableChatMessage) => void;
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
  // split 用带 g 的正则保留分隔符；test 用不带 g 的正则避免 lastIndex 状态问题
  const splitRegex = new RegExp(`(${escaped})`, "gi");
  const testRegex = new RegExp(`^${escaped}$`, "i");
  const parts = text.split(splitRegex);
  return parts.map((part, i) =>
    testRegex.test(part) ? (
      <mark key={i} className="bg-[var(--accent-soft)] text-[var(--accent)] rounded-[var(--radius-sm)] px-0.5">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

export function MessageBubble({ message, currentUserId, unread, searchQuery, onMessageUpdated }: MessageBubbleProps) {
  const [previewAttachment, setPreviewAttachment] = useState<{
    url: string;
    fileName: string;
    fileType: string;
  } | null>(null);
  const t = useTranslations("chat");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const menuRef = useRef<HTMLDetailsElement>(null);
  const savingRef = useRef(false);
  const isRecalled = Boolean(message.isRecalled || message.revokedAt);
  const isOwn = Boolean(currentUserId) && message.authorId === currentUserId;
  const canUpdate = isOwn && !isRecalled && Boolean(message.workspaceId && message.taskId);
  const canRecall = Date.now() - new Date(message.createdAt).getTime() <= 30 * 60 * 1000;

  const updateMessage = async (action: "recall" | "edit") => {
    if (!canUpdate || savingRef.current || (action === "edit" && !draft.trim())) return;
    if (menuRef.current) menuRef.current.open = false;
    if (action === "recall" && !window.confirm(t("recallConfirm"))) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const url = `/api/v1/workspaces/${encodeURIComponent(message.workspaceId!)}/tasks/${encodeURIComponent(message.taskId!)}/messages/${encodeURIComponent(message.id)}`;
      const response = await fetch(url, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "edit" ? { action, body: draft.trim() } : { action }),
      });
      const result: { code?: number; data?: EditableChatMessage; reason?: string } = await response.json();
      if (!response.ok || result.code !== 0 || !result.data || result.data.id !== message.id) {
        throw new Error(result.reason === "recallExpired" ? t("recallExpired") : result.reason === "recalled" ? t("messageRevoked") : t("actionFailed"));
      }
      onMessageUpdated?.(result.data);
      setPreviewAttachment(null);
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("actionFailed"));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const author = message.author;
  const displayName = author ? author.name || author.email.split("@")[0] : t("unknownUser");
  const initial = (author ? author.name || author.email : "?")[0]?.toUpperCase();

  // 已读回执：自己发的消息才显示
  const readCount = message.reads?.length ?? 0;
  const isRead = isOwn && readCount > 0;

  return (
    <div
      className={`group/message flex gap-[var(--space-2)] ${isOwn ? "flex-row-reverse" : "flex-row"} relative`}
    >
      {/* 未读高亮色条 */}
      {unread && (
        <span className="absolute left-0 top-0 bottom-0 w-[3px] rounded-full bg-[var(--accent)]" />
      )}

      {/* 头像 */}
      <div className="w-6 h-6 shrink-0 rounded-full bg-[var(--surface-3)] text-[var(--fg-2)] flex items-center justify-center text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] overflow-hidden">
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
          <span className="text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--fg)] mb-0.5">
            {displayName}
          </span>
        )}
        {canUpdate && !editing && (
          <details ref={menuRef} className="relative mb-0.5 opacity-100 sm:opacity-0 group-hover/message:opacity-100 group-focus-within/message:opacity-100 open:opacity-100"
            onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }}
            onKeyDown={(event) => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
            <summary aria-label={t("moreActions")} title={t("moreActions")} className="flex cursor-pointer list-none items-center justify-center rounded-[var(--radius-sm)] p-1 text-[var(--meta)] hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]">
              <MoreHorizontal size={14} />
            </summary>
            <div className="absolute right-0 top-full z-20 min-w-[140px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-1 shadow-[var(--elev-md)] text-[length:var(--text-sm)] text-[var(--fg)]">
              <button type="button" disabled={saving} onClick={() => { if (menuRef.current) menuRef.current.open = false; setDraft(message.body); setEditing(true); setError(""); }} className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] p-2 hover:bg-[var(--surface-2)] disabled:opacity-50">
                <Pencil size={14} />{t("edit")}
              </button>
              <button type="button" disabled={saving || !canRecall} title={!canRecall ? t("recallExpired") : undefined} onClick={() => void updateMessage("recall")} className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] p-2 text-[var(--danger-fg)] hover:bg-[var(--danger-soft)] disabled:opacity-50">
                <Undo2 size={14} />{t("revoke")}
              </button>
            </div>
          </details>
        )}
        <div
          className={`px-[var(--space-3)] py-[var(--space-2)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] leading-[var(--leading-relaxed)] whitespace-pre-wrap break-words ${
            isRecalled || editing ? "bg-[var(--surface-2)] text-[var(--meta)]" : isOwn
              ? "bg-[var(--accent)] text-[var(--accent-fg)]"
              : "bg-[var(--surface-2)] text-[var(--fg-2)]"
          }`}
        >
          {isRecalled ? <span>{t("messageRevoked")}</span> : editing ? (
            <form onSubmit={(event) => { event.preventDefault(); void updateMessage("edit"); }} className="flex min-w-0 flex-col gap-2">
              <textarea autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={10000} rows={3} disabled={saving} aria-label={t("editMessage")}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && !saving) setEditing(false);
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void updateMessage("edit"); }
                }}
                className="w-full min-w-0 resize-y rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-2 text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]" />
              <div className="flex justify-end gap-2">
                <button type="button" disabled={saving} onClick={() => setEditing(false)} className="rounded-[var(--radius-sm)] px-2 py-1 text-[var(--fg-2)] hover:bg-[var(--surface-3)] disabled:opacity-50">{t("cancel")}</button>
                <button type="submit" disabled={saving || !draft.trim()} className="flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--accent)] px-2 py-1 text-[var(--accent-fg)] disabled:opacity-50">{saving && <Loader2 size={14} className="animate-spin" />}{t(saving ? "saving" : "save")}</button>
              </div>
            </form>
          ) : message.body && <span>{highlightText(message.body, searchQuery)}</span>}
          {/* 附件列表 */}
          {!isRecalled && !editing && message.attachments && message.attachments.length > 0 && (
            <div className={`mt-1 space-y-1 ${message.body ? "pt-1" : ""}`}>
              {message.attachments.map((att) =>
                isImageAttachment(att) && att.thumbnailUrl ? (
                  // 图片附件：缩略图
                  <a
                    key={att.id}
                    href={att.url}
                    onClick={(e) => {
                      e.preventDefault();
                      setPreviewAttachment(att);
                    }}
                    className="block rounded-[var(--radius-sm)] overflow-hidden hover:opacity-90 transition-opacity cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
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
                    onClick={(e) => {
                      e.preventDefault();
                      setPreviewAttachment(att);
                    }}
                    download={att.fileName}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--radius-sm)] border ${
                      isOwn
                        ? "border-[color-mix(in_srgb,var(--accent-fg)_20%,transparent)] bg-[color-mix(in_srgb,var(--accent-fg)_10%,transparent)]"
                        : "border-[var(--border)] bg-[var(--surface-3)]"
                    } hover:opacity-80 transition-opacity min-w-0 sm:min-w-[200px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]`}
                  >
                    <FileText size={16} className="shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] truncate">{att.fileName}</div>
                      <div className="text-[length:var(--text-xs)] opacity-70">{formatFileSize(att.fileSize)}</div>
                    </div>
                    <Download size={14} className="shrink-0 opacity-70" />
                  </a>
                ),
              )}
            </div>
          )}
        </div>

        {error && <p role="alert" className="mt-1 text-[length:var(--text-xs)] text-[var(--danger-fg)]">{error}</p>}
        {!isRecalled && message.editedAt && <span className="mt-0.5 text-[length:var(--text-xs)] text-[var(--meta)]">{t("edited")}</span>}
        {/* 已读回执（仅自己的消息显示） */}
        {isOwn && !isRecalled && (
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
      <AttachmentPreviewModal
        attachment={previewAttachment}
        onClose={() => setPreviewAttachment(null)}
      />
    </div>
  );
}
