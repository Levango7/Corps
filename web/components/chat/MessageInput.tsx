"use client";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ChangeEvent,
} from "react";
import { Send, Loader2, Paperclip, X, AtSign, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import type { AttachmentMeta, Person } from "./types";

/**
 * 消息输入区域
 *
 * - 文件按钮：📎 点击选择文件（≤10MB），上传后显示待发送附件预览
 * - 文本框：自动高度，⌘/Ctrl + Enter 发送
 * - 发送按钮：禁用状态（空文本 + 无附件时）
 * - 待发送附件预览：图片缩略图 / 文件名 + 移除按钮
 * - @提及：输入 @ 触发成员选择浮窗，选择后插入 @username
 * - 拖拽上传：拖文件到输入区直接上传（复用 onUploadFile）
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
  /** 工作区成员列表（用于 @提及；不传则禁用提及） */
  members?: Person[];
}

/** 消息体最大长度（与 API zod schema 对齐） */
const MAX_BODY_LENGTH = 10000;
/** 最大文件大小：10MB */
const MAX_FILE_SIZE = 10 * 1024 * 1024;
/** @提及浮窗最大显示成员数 */
const MENTION_MAX_ITEMS = 8;


function MessageInputImpl({
  onSend,
  onUploadFile,
  sending,
  members,
}: MessageInputProps) {
  const t = useTranslations("chat");
  const [draft, setDraft] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<AttachmentMeta[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  // @提及状态
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionActive, setMentionActive] = useState(0);
  // @触发起始位置（@ 字符的 index）
  const mentionStartRef = useRef<number>(-1);
  // 拖拽状态
  const [dragOver, setDragOver] = useState(false);

  const draftRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // 输入框自动高度
  useEffect(() => {
    const el = draftRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
    }
  }, [draft]);

  /** 同步 draft state（非受控 textarea 的 onChange 仅同步 state 用于 canSend 判定） */
  const syncDraft = useCallback(() => {
    const el = draftRef.current;
    if (el) setDraft(el.value);
  }, []);

  /** 上传单个文件并加入待发送列表 */
  const uploadAndAppend = useCallback(
    async (file: File) => {
      if (file.size > MAX_FILE_SIZE) {
        setError(t("fileTooLarge"));
        return;
      }
      setError("");
      setUploading(true);
      try {
        const meta = await onUploadFile(file);
        const previewMeta =
          file.type.startsWith("image/") && meta.thumbnailUrl
            ? { ...meta, thumbnailUrl: URL.createObjectURL(file) }
            : meta;
        setPendingAttachments((prev) => [...prev, previewMeta]);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("uploadFailed"));
      } finally {
        setUploading(false);
      }
    },
    [onUploadFile, t],
  );

  /** 选择文件 */
  const handleFileSelect = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = "";
      await uploadAndAppend(file);
    },
    [uploadAndAppend],
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

    const body = trimmed || (pendingAttachments.length > 0 ? t("attachmentFallback") : "");

    await onSend(body, pendingAttachments);
    pendingAttachments.forEach((a) => {
      if (a.thumbnailUrl?.startsWith("blob:")) URL.revokeObjectURL(a.thumbnailUrl);
    });
    setDraft("");
    setPendingAttachments([]);
    setMentionOpen(false);
    if (draftRef.current) draftRef.current.value = "";
  }, [draft, pendingAttachments, sending, onSend, t]);

  /** 提及候选列表（按 query 过滤成员，排除无 name 的） */
  const mentionCandidates = (() => {
    if (!members || members.length === 0) return [] as Person[];
    const q = mentionQuery.toLowerCase();
    return members
      .filter((m) => {
        const name = m.name || m.email.split("@")[0];
        return name.toLowerCase().includes(q);
      })
      .slice(0, MENTION_MAX_ITEMS);
  })();

  /** 关闭提及浮窗 */
  const closeMention = useCallback(() => {
    setMentionOpen(false);
    setMentionQuery("");
    setMentionActive(0);
    mentionStartRef.current = -1;
  }, []);

  /** 选择某个成员插入 @mention */
  const pickMention = useCallback(
    (person: Person) => {
      const el = draftRef.current;
      if (!el) return;
      const name = person.name || person.email.split("@")[0];
      const start = mentionStartRef.current;
      // 替换从 @ 触发点到当前光标的内容为 "@name "
      const cursor = el.selectionStart ?? el.value.length;
      const before = start >= 0 ? el.value.slice(0, start) : el.value.slice(0, cursor);
      const after = el.value.slice(cursor);
      const insertText = `@${name} `;
      const next = (before + insertText + after).slice(0, MAX_BODY_LENGTH);
      el.value = next;
      const pos = Math.min(before.length + insertText.length, next.length);
      el.setSelectionRange(pos, pos);
      setDraft(next);
      closeMention();
      el.focus();
    },
    [closeMention],
  );

  /** 检测 @提及触发：onChange 时分析光标前的文本 */
  const detectMention = useCallback(() => {
    const el = draftRef.current;
    if (!el || !members || members.length === 0) {
      closeMention();
      return;
    }
    const pos = el.selectionStart ?? el.value.length;
    const before = el.value.slice(0, pos);
    // 找最后一个未闭合的 @：从光标往前找 @，中间不能有空格/换行
    const atIdx = before.lastIndexOf("@");
    if (atIdx < 0) {
      closeMention();
      return;
    }
    // @ 必须在行首或前面是空白
    const charBefore = atIdx > 0 ? before[atIdx - 1] : "";
    if (charBefore && !/\s/.test(charBefore)) {
      closeMention();
      return;
    }
    const query = before.slice(atIdx + 1);
    // query 中不能有空格/换行（否则视为普通文本）
    if (/\s/.test(query)) {
      closeMention();
      return;
    }
    mentionStartRef.current = atIdx;
    setMentionQuery(query);
    setMentionOpen(true);
    setMentionActive(0);
  }, [members, closeMention]);

  /** 键盘事件 */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // 提及浮窗导航
      if (mentionOpen && mentionCandidates.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setMentionActive((prev) => (prev + 1) % mentionCandidates.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setMentionActive(
            (prev) => (prev - 1 + mentionCandidates.length) % mentionCandidates.length,
          );
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          const target = mentionCandidates[mentionActive];
          if (target) pickMention(target);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          closeMention();
          return;
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        send();
      }
    },
    [mentionOpen, mentionCandidates, mentionActive, pickMention, closeMention, send],
  );

  /** 拖拽上传处理 */
  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    // 仅当拖入文件时才阻止默认行为并显示遮罩
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      if (!dragOver) setDragOver(true);
    }
  }, [dragOver]);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    // 仅当离开根容器时才关闭遮罩（避免子元素切换闪烁）
    if (e.relatedTarget && rootRef.current?.contains(e.relatedTarget as Node)) return;
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    async (e: DragEvent<HTMLDivElement>) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      setDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;
      // 串行上传，避免并发超出附件端点限制
      for (const file of files) {
        await uploadAndAppend(file);
      }
    },
    [uploadAndAppend],
  );

  // 点击外部关闭提及浮窗
  useEffect(() => {
    if (!mentionOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        closeMention();
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [mentionOpen, closeMention]);

  // 提及浮窗定位（基于 @ 字符位置）
  const [mentionPos, setMentionPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  useLayoutEffect(() => {
    if (!mentionOpen) return;
    const el = draftRef.current;
    if (!el) return;
    // 简化定位：浮窗显示在 textarea 上方左侧
    const rect = el.getBoundingClientRect();
    const rootRect = rootRef.current?.getBoundingClientRect();
    setMentionPos({
      top: rect.top - (rootRect?.top ?? 0) - 8,
      left: rect.left - (rootRect?.left ?? 0),
    });
  }, [mentionOpen]);

  const canSend = (draft.trim() || pendingAttachments.length > 0) && !sending;

  return (
    <div
      ref={rootRef}
      className="mt-[var(--space-2)] relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 拖拽上传遮罩 */}
      {dragOver && (
        <div className="absolute inset-0 z-20 flex items-center justify-center rounded-[var(--radius-md)] border-2 border-dashed border-[var(--accent)] bg-[var(--accent-soft)] pointer-events-none">
          <div className="flex items-center gap-2 text-[length:var(--text-sm)] text-[var(--accent)] font-[weight:var(--weight-medium)]">
            <Upload size={16} />
            {t("dropFileHint")}
          </div>
        </div>
      )}

      {/* @提及浮窗 */}
      {mentionOpen && mentionCandidates.length > 0 && (
        <div
          className="absolute z-30 min-w-[180px] max-w-[240px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-md)] overflow-hidden"
          style={{ top: mentionPos.top, left: mentionPos.left }}
          role="listbox"
          aria-label={t("mentionAria")}
        >
          {mentionCandidates.map((m, i) => {
            const name = m.name || m.email.split("@")[0];
            const initial = (m.name || m.email)[0]?.toUpperCase();
            return (
              <button
                key={m.id}
                type="button"
                role="option"
                aria-selected={i === mentionActive}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickMention(m);
                }}
                onMouseEnter={() => setMentionActive(i)}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-[length:var(--text-sm)] transition-colors duration-[var(--motion-fast)] ${
                  i === mentionActive
                    ? "bg-[var(--surface-2)] text-[var(--fg)]"
                    : "text-[var(--fg-2)] hover:bg-[var(--surface-2)]"
                }`}
              >
                <span className="w-5 h-5 shrink-0 rounded-full bg-[var(--surface-3)] flex items-center justify-center text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] overflow-hidden">
                  {m.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.image} alt={name} className="w-full h-full object-cover" />
                  ) : (
                    initial
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate">{name}</span>
              </button>
            );
          })}
        </div>
      )}

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
                aria-label={t("removeAttachment")}
              >
                <X size={14} />
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
        <div className="flex-1 relative">
          <textarea
            ref={draftRef}
            onChange={(e) => {
              setDraft(e.target.value.slice(0, MAX_BODY_LENGTH));
              detectMention();
            }}
            onKeyDown={handleKeyDown}
            onBlur={syncDraft}
            rows={1}
            maxLength={MAX_BODY_LENGTH}
            placeholder={t("placeholder")}
            className="w-full px-[var(--space-3)] py-[var(--space-2)] overflow-hidden resize-none border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface-2)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:border-[var(--accent)] placeholder:text-[var(--meta)] transition-colors duration-[var(--motion-fast)]"
          />
          {/* @提及提示按钮（无 members 时隐藏） */}
          {members && members.length > 0 && (
            <button
              type="button"
              onClick={() => {
                const el = draftRef.current;
                if (!el) return;
                el.focus();
                const pos = el.selectionStart ?? el.value.length;
                const before = el.value.slice(0, pos);
                const after = el.value.slice(pos);
                const needSpace = pos > 0 && !/\s$/.test(before);
                const insert = needSpace ? " @" : "@";
                const next = (before + insert + after).slice(0, MAX_BODY_LENGTH);
                el.value = next;
                const newPos = Math.min(pos + insert.length, next.length);
                el.setSelectionRange(newPos, newPos);
                setDraft(next);
                mentionStartRef.current = pos + (needSpace ? 1 : 0);
                setMentionQuery("");
                setMentionOpen(true);
                setMentionActive(0);
              }}
              disabled={sending}
              aria-label={t("mentionAria")}
              className="absolute right-2 bottom-2 w-6 h-6 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--meta)] hover:text-[var(--accent)] hover:bg-[var(--surface-3)] disabled:opacity-40 transition-colors duration-[var(--motion-fast)]"
            >
              <AtSign size={14} />
            </button>
          )}
        </div>

        {/* 发送按钮（aria-label 区分评论表单的"发送"按钮——两者同页面共存） */}
        <button
          onClick={send}
          disabled={!canSend}
          aria-label={t("sendAria")}
          className="h-9 px-[var(--space-3)] shrink-0 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] flex items-center gap-1.5"
        >
          {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          {t("send")}
        </button>
      </div>
    </div>
  );
}

export const MessageInput = memo(MessageInputImpl);
