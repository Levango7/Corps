"use client";

import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Send, Loader2, Paperclip, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { AttachmentMeta } from "./types";

/**
 * 消息输入区域
 *
 * - 文件按钮：📎 点击选择文件（≤10MB），上传后显示待发送附件预览
 * - 文本框：自动高度，⌘/Ctrl + Enter 发送
 * - 发送按钮：禁用状态（空文本 + 无附件时）
 * - 待发送附件预览：图片缩略图 / 文件名 + 移除按钮
 *
 * memo：ChatPanel 每收到一条 SSE 推送就重渲染整棵树；不隔离时 textarea
 * 会随之重建，用户正在输入的 draft 被受控 value 重置（输入吞字）。
 * props 均为稳定的回调/标量，memo 可安全跳过无关重渲染。
 */

interface MessageInputProps {
  /** 发送消息（文本 + 附件元数据） */
  onSend: (body: string, attachments: AttachmentMeta[]) => Promise<void>;
  /** 上传文件（返回附件元数据） */
  onUploadFile: (file: File) => Promise<AttachmentMeta>;
  /** 是否正在发送 */
  sending: boolean;
  /** 附件上传端点 URL */
  uploadUrl: string;
}

/** 消息体最大长度（与 API zod schema 对齐） */
const MAX_BODY_LENGTH = 10000;
/** 最大文件大小：10MB */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

function MessageInputImpl({ onSend, onUploadFile, sending }: MessageInputProps) {
  const t = useTranslations("chat");
  const [draft, setDraft] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<AttachmentMeta[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const draftRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 输入框自动高度
  useEffect(() => {
    const el = draftRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
    }
  }, [draft]);

  /** 选择文件 */
  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      // 重置 input 允许重复选择同一文件
      e.target.value = "";

      // 校验文件大小
      if (file.size > MAX_FILE_SIZE) {
        setError(t("fileTooLarge"));
        return;
      }
      setError("");

      setUploading(true);
      try {
        const meta = await onUploadFile(file);
        // 图片附件：未发送前用本地 Blob URL 预览。下载端点要求附件已关联消息
        // （孤儿文件 404），直接请求服务器 URL 会裂图；发送后记录自带服务器 url。
        const previewMeta =
          file.type.startsWith("image/") && meta.thumbnailUrl
            ? { ...meta, thumbnailUrl: URL.createObjectURL(file) }
            : meta;
        setPendingAttachments((prev) => [...prev, previewMeta]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "上传失败");
      } finally {
        setUploading(false);
      }
    },
    [onUploadFile, t],
  );

  /** 移除待发送附件 */
  const removeAttachment = useCallback((index: number) => {
    setPendingAttachments((prev) => {
      const removed = prev[index];
      if (removed?.thumbnailUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(removed.thumbnailUrl);
      }
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  /** 发送 */
  const send = useCallback(async () => {
    const trimmed = draft.trim();
    if ((!trimmed && pendingAttachments.length === 0) || sending) return;

    // 有附件但无文本时，使用附件名作为 body（满足 API body min(1) 约束）
    const body = trimmed || (pendingAttachments.length > 0 ? t("attachmentFallback") : "");

    await onSend(body, pendingAttachments);
    pendingAttachments.forEach((a) => {
      if (a.thumbnailUrl?.startsWith("blob:")) URL.revokeObjectURL(a.thumbnailUrl);
    });
    setDraft("");
    setPendingAttachments([]);
    // 非受控回写：textarea 不绑 value（见下方 JSX 注释），发送后直接清 DOM 值。
    // 此处在 await 后同步清，避免 React 滞后渲染用旧 draft 竞争覆盖用户输入
    if (draftRef.current) draftRef.current.value = "";
  }, [draft, pendingAttachments, sending, onSend, t]);

  /** 键盘事件 */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        send();
      }
    },
    [send],
  );

  const canSend = (draft.trim() || pendingAttachments.length > 0) && !sending;

  return (
    <div className="mt-[var(--space-2)]">
      {/* 错误提示 */}
      {error && (
        <div className="mb-1.5 px-2 py-1 rounded-[var(--radius-sm)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-xs)]">
          {error}
        </div>
      )}

      {/* 待发送附件预览 */}
      {pendingAttachments.length > 0 && (
        <div className="mb-1.5 flex gap-1.5 flex-wrap">
          {pendingAttachments.map((att, i) => (
            <div
              key={i}
              className="relative flex items-center gap-1.5 px-2 py-1 rounded-[var(--radius-sm)] bg-[var(--surface-2)] border border-[var(--border)]"
            >
              {att.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={att.thumbnailUrl}
                  alt={att.fileName}
                  className="w-8 h-8 object-cover rounded-[var(--radius-sm)]"
                />
              ) : (
                <div className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] bg-[var(--surface-3)]">
                  <Paperclip size={14} className="text-[var(--muted)]" />
                </div>
              )}
              <span className="text-[length:var(--text-xs)] text-[var(--fg-2)] max-w-[120px] truncate">
                {att.fileName}
              </span>
              <button
                onClick={() => removeAttachment(i)}
                className="shrink-0 w-4 h-4 flex items-center justify-center rounded-full hover:bg-[var(--surface-3)] text-[var(--meta)]"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 输入区 */}
      <div className="flex items-end gap-[var(--space-2)]">
        {/* 文件按钮 */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || sending}
          aria-label={t("attachFile")}
          className="shrink-0 w-9 h-9 flex items-center justify-center rounded-[var(--radius-md)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-fast)]"
        >
          {uploading ? <Loader2 size={16} className="animate-spin" /> : <Paperclip size={16} />}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileSelect}
          className="hidden"
          accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,.doc,.docx,.xls,.xlsx,.zip"
        />

        {/* 文本框：非受控（不绑 value）。受控 value 在 SSE 高频推送的滞后渲染
            中会用旧 draft 覆盖用户刚输入的文本（发送后 300ms 内的渲染即复现）；
            非受控 + onChange 同步 draft state（仅用于 canSend 判定）消除该竞争 */}
        <textarea
          ref={draftRef}
          onChange={(e) => setDraft(e.target.value.slice(0, MAX_BODY_LENGTH))}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder={t("placeholder")}
          className="flex-1 px-[var(--space-3)] py-[var(--space-2)] overflow-hidden resize-none border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface-2)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:border-[var(--accent)] placeholder:text-[var(--meta)] transition-colors duration-[var(--motion-fast)]"
        />

        {/* 发送按钮（aria-label 区分评论表单的"发送"按钮——两者同页面共存） */}
        <button
          onClick={send}
          disabled={!canSend}
          aria-label={t("sendAria")}
          className="h-9 px-[var(--space-3)] shrink-0 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] font-[var(--weight-medium)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] flex items-center gap-1.5"
        >
          {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          {t("send")}
        </button>
      </div>
    </div>
  );
}

export const MessageInput = memo(MessageInputImpl);
