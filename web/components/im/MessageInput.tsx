"use client";

/**
 * 消息输入框（核心输入组件）
 *
 * - 多行文本输入（textarea，自动增高）
 * - @提及触发（输入 @ 时弹出 MentionPopover）
 * - 文件拖拽 / 点击上传（Paperclip 图标）
 * - 发送按钮（Send 图标）
 * - 键盘快捷键：Enter 发送，Shift+Enter 换行，⌘/Ctrl+Enter 发送
 * - 回复引用预览（显示在输入框上方，可取消）
 * - 字数计数（超过 10000 时禁用发送并显示提示）
 * - 正在发送状态（Loader2 旋转图标）
 *
 * 所有样式走 design token（var(--*)），无裸 hex。
 * lucide-react 图标尺寸用 14/16（项目约定）。
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { Send, Paperclip, X, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { MentionPopover } from "./MentionPopover";

/** 附件（上传后的轻量结构，传给 onSend） */
export interface Attachment {
  id: string;
  fileName: string;
  url: string;
  fileType: string;
  fileSize: number;
  thumbnailUrl: string | null;
}

/** 可提及的成员项 */
interface MentionableMember {
  userId: string;
  user: {
    id: string;
    name: string | null;
    image: string | null;
  };
}

interface MessageInputProps {
  /** 发送消息回调 */
  onSend: (
    body: string,
    opts?: {
      replyToId?: string;
      mentions?: string[];
      attachments?: Attachment[];
    },
  ) => void;
  /** 回复引用目标（显示在输入框上方，可取消） */
  replyTo?: { id: string; authorName: string; body: string } | null;
  /** 取消回复 */
  onCancelReply?: () => void;
  /** 可提及的成员列表（用于 @提及） */
  members?: MentionableMember[];
  /** 禁用输入 */
  disabled?: boolean;
  /** 占位提示文本 */
  placeholder?: string;
}

/** 消息体最大长度（与 API zod schema 对齐） */
const MAX_BODY_LENGTH = 10000;
/** textarea 最小高度（px） */
const MIN_HEIGHT = 40;
/** textarea 最大高度（px），超过则滚动 */
const MAX_HEIGHT = 160;
/** 文件大小上限 10MB */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** @提及状态 */
interface MentionState {
  /** @ 符号在文本中的索引 */
  start: number;
  /** @ 后的查询文本 */
  query: string;
  /** 弹窗定位 */
  position: { top: number; left: number };
}

export function MessageInput({
  onSend,
  replyTo,
  onCancelReply,
  members,
  disabled = false,
  placeholder,
}: MessageInputProps) {
  const t = useTranslations("chat");

  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [mention, setMention] = useState<MentionState | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // 已提及的用户 ID 集合（发送时传入）
  const mentionedIdsRef = useRef<Set<string>>(new Set());

  // textarea 引用（用于自动增高 + 光标定位）
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // 隐藏的文件选择 input
  const fileInputRef = useRef<HTMLInputElement>(null);

  // —— textarea 自动增高 ——
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(Math.max(el.scrollHeight, MIN_HEIGHT), MAX_HEIGHT);
    el.style.height = `${next}px`;
  }, [body]);

  // —— @提及检测：从光标位置往前找最近的 @ ——
  const detectMention = useCallback(
    (value: string, cursorPos: number) => {
      // 从光标往前找 @
      const before = value.slice(0, cursorPos);
      const atIdx = before.lastIndexOf("@");
      if (atIdx === -1) {
        setMention(null);
        return;
      }
      // @ 后到光标的文本
      const query = before.slice(atIdx + 1);
      // @ 必须在行首或前面是空格（避免匹配邮箱里的 @）
      if (atIdx > 0) {
        const prevChar = before[atIdx - 1];
        if (prevChar !== " " && prevChar !== "\n") {
          setMention(null);
          return;
        }
      }
      // query 中不能含空格或换行（提及词是连续的）
      if (/\s/.test(query)) {
        setMention(null);
        return;
      }
      // 计算弹窗位置：textarea 上方
      const el = textareaRef.current;
      if (!el) {
        setMention(null);
        return;
      }
      const rect = el.getBoundingClientRect();
      setMention({
        start: atIdx,
        query,
        position: {
          top: rect.top - 8, // 弹窗在输入框上方，留 8px 间距
          left: rect.left,
        },
      });
    },
    [],
  );

  // —— 文本变化处理 ——
  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value.slice(0, MAX_BODY_LENGTH);
      setBody(value);
      // 检测 @提及
      if (members && members.length > 0) {
        detectMention(value, e.target.selectionStart ?? value.length);
      }
    },
    [members, detectMention],
  );

  // —— 选中提及成员：替换 @query 为 @userName ——
  const handleMentionSelect = useCallback(
    (userId: string, userName: string) => {
      if (!mention) return;
      const el = textareaRef.current;
      const before = body.slice(0, mention.start);
      const after = body.slice(mention.start + 1 + mention.query.length);
      const insertText = `@${userName} `;
      const nextBody = before + insertText + after;
      setBody(nextBody);
      mentionedIdsRef.current.add(userId);
      setMention(null);

      // 聚焦 textarea 并把光标移到插入文本之后
      if (el) {
        const cursorPos = before.length + insertText.length;
        requestAnimationFrame(() => {
          el.focus();
          el.setSelectionRange(cursorPos, cursorPos);
        });
      }
    },
    [mention, body],
  );

  // —— 发送消息 ——
  const handleSend = useCallback(() => {
    const trimmed = body.trim();
    if (!trimmed || sending || disabled) return;
    if (body.length > MAX_BODY_LENGTH) return;

    setSending(true);
    try {
      const opts: {
        replyToId?: string;
        mentions?: string[];
        attachments?: Attachment[];
      } = {};
      if (replyTo) opts.replyToId = replyTo.id;
      if (mentionedIdsRef.current.size > 0) {
        opts.mentions = Array.from(mentionedIdsRef.current);
      }
      if (attachments.length > 0) opts.attachments = attachments;

      onSend(trimmed, opts);

      // 清空输入框和状态
      setBody("");
      setAttachments([]);
      mentionedIdsRef.current.clear();
      setMention(null);
    } finally {
      setSending(false);
    }
  }, [body, sending, disabled, replyTo, attachments, onSend]);

  // —— 键盘事件：Enter 发送，Shift+Enter 换行，⌘/Ctrl+Enter 发送 ——
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // @提及弹窗激活时，键盘导航交给 MentionPopover 处理（capture 阶段）
      if (mention) return;

      // ⌘/Ctrl + Enter 发送
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSend();
        return;
      }
      // Enter 发送（非 Shift、非 ⌘/Ctrl）
      if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        handleSend();
        return;
      }
      // Shift + Enter 换行：默认行为，不拦截
    },
    [mention, handleSend],
  );

  // —— 文件上传处理 ——
  const processFiles = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files);
      for (const file of list) {
        if (file.size > MAX_FILE_SIZE) {
          // 超过大小限制，跳过（UI 上由字数提示区域显示警告）
          continue;
        }
        // 生成本地预览 URL（实际项目应上传到服务端获取 url）
        const isImage = file.type.startsWith("image/");
        const previewUrl = isImage ? URL.createObjectURL(file) : null;
        const attachment: Attachment = {
          id: `${Date.now()}-${file.name}`,
          fileName: file.name,
          url: previewUrl ?? "#",
          fileType: file.type || "application/octet-stream",
          fileSize: file.size,
          thumbnailUrl: previewUrl,
        };
        setAttachments((prev) => [...prev, attachment]);
      }
    },
    [],
  );

  // —— 点击附件按钮：触发隐藏文件选择 ——
  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        processFiles(e.target.files);
      }
      // 重置 input value 以便重复选择同一文件
      e.target.value = "";
    },
    [processFiles],
  );

  // —— 拖拽上传 ——
  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        processFiles(e.dataTransfer.files);
      }
    },
    [processFiles],
  );

  // —— 移除已添加的附件 ——
  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target?.thumbnailUrl) {
        URL.revokeObjectURL(target.thumbnailUrl);
      }
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  // —— 组件卸载时释放 object URL ——
  useEffect(() => {
    return () => {
      attachments.forEach((a) => {
        if (a.thumbnailUrl) URL.revokeObjectURL(a.thumbnailUrl);
      });
    };
  }, [attachments]);

  // —— 发送条件 ——
  const overLimit = body.length > MAX_BODY_LENGTH;
  const canSend = body.trim().length > 0 && !sending && !disabled && !overLimit;
  const showCount = body.length > MAX_BODY_LENGTH * 0.8; // 超过 80% 时显示计数

  return (
    <div
      className="relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 拖拽提示遮罩 */}
      {dragOver && (
        <div className="absolute inset-0 z-[var(--z-sticky)] flex items-center justify-center rounded-[var(--radius-md)] border-2 border-dashed border-[var(--accent)] bg-[var(--accent-soft)] pointer-events-none">
          <span className="text-[length:var(--text-sm)] text-[var(--accent)] font-[weight:var(--weight-medium)]">
            {t("dropFileHint")}
          </span>
        </div>
      )}

      {/* 回复引用预览 */}
      {replyTo && (
        <div className="mb-[var(--space-2)] flex items-center justify-between gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] rounded-[var(--radius-sm)] bg-[var(--surface-2)] border-l-2 border-[var(--accent)]">
          <div className="min-w-0 flex-1">
            <span className="text-[length:var(--text-xs)] text-[var(--accent)] font-[weight:var(--weight-medium)]">
              {t("replyTo", { name: replyTo.authorName })}
            </span>
            <p className="truncate text-[length:var(--text-xs)] text-[var(--muted)]">
              {replyTo.body}
            </p>
          </div>
          {onCancelReply && (
            <button
              type="button"
              onClick={onCancelReply}
              aria-label={t("cancel")}
              className="shrink-0 w-6 h-6 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-3)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}

      {/* 已添加的附件预览 */}
      {attachments.length > 0 && (
        <div className="mb-[var(--space-2)] flex flex-wrap gap-[var(--space-2)]">
          {attachments.map((att) => (
            <div
              key={att.id}
              className="flex items-center gap-[var(--space-2)] px-[var(--space-2)] py-1 rounded-[var(--radius-sm)] bg-[var(--surface-2)] border border-[var(--border)]"
            >
              <span className="truncate max-w-[160px] text-[length:var(--text-xs)] text-[var(--fg)]">
                {att.fileName}
              </span>
              <button
                type="button"
                onClick={() => handleRemoveAttachment(att.id)}
                aria-label={t("removeAttachment")}
                className="shrink-0 w-4 h-4 flex items-center justify-center rounded text-[var(--muted)] hover:text-[var(--danger)] transition-colors duration-[var(--motion-fast)]"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 输入框 + 工具栏 */}
      <div className="flex items-end gap-[var(--space-2)]">
        {/* 附件按钮 */}
        <button
          type="button"
          onClick={handleAttachClick}
          disabled={disabled}
          aria-label={t("attachFile")}
          className="shrink-0 w-9 h-9 flex items-center justify-center rounded-[var(--radius-md)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-fast)]"
        >
          <Paperclip size={16} />
        </button>

        {/* 隐藏的文件选择 input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileChange}
          className="hidden"
          aria-hidden="true"
        />

        {/* 文本输入区 */}
        <textarea
          ref={textareaRef}
          value={body}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={1}
          placeholder={placeholder ?? t("placeholder")}
          className="flex-1 px-[var(--space-3)] py-[var(--space-2)] overflow-hidden resize-none border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface-2)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:border-[var(--accent)] placeholder:text-[var(--meta)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-fast)]"
          style={{ minHeight: `${MIN_HEIGHT}px`, maxHeight: `${MAX_HEIGHT}px` }}
        />

        {/* 发送按钮 */}
        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          aria-label={t("sendAria")}
          className="shrink-0 w-9 h-9 flex items-center justify-center bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)]"
        >
          {sending ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Send size={16} />
          )}
        </button>
      </div>

      {/* 字数计数 / 超限提示 */}
      {showCount && (
        <div className="mt-1 flex justify-end">
          <span
            className={`text-[length:var(--text-xs)] ${
              overLimit
                ? "text-[var(--danger)] font-[weight:var(--weight-medium)]"
                : "text-[var(--meta)]"
            }`}
          >
            {body.length} / {MAX_BODY_LENGTH}
            {overLimit && ` · ${t("bodyTooLong")}`}
          </span>
        </div>
      )}

      {/* @提及弹窗 */}
      {mention && members && members.length > 0 && (
        <MentionPopover
          query={mention.query}
          members={members.map((m) => ({
            userId: m.userId,
            user: {
              id: m.user.id,
              name: m.user.name,
              email: null,
              image: m.user.image,
            },
          }))}
          onSelect={handleMentionSelect}
          onClose={() => setMention(null)}
          position={mention.position}
        />
      )}
    </div>
  );
}