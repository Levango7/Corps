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
import { Send, Paperclip, X, Loader2, ListTodo, AlertCircle, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { MentionPopover } from "./MentionPopover";
import { ImReplySuggestions } from "../ai/ImReplySuggestions";

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
  ) => Promise<void> | void;
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
  /** 当前会话 ID（用于 AI 回复建议，传入后显示"AI 回复"按钮） */
  conversationId?: string;
  /** AI 功能是否可用（未配置时禁用 AI 回复按钮）；默认 true */
  aiEnabled?: boolean;
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

/** 任务选择弹窗中的任务项（仅取展示所需字段） */
interface TaskPickerItem {
  id: string;
  title: string;
  status: string;
}

/** 文件上传 API 返回的 FileAsset（仅取附件所需字段） */
interface UploadedFileAsset {
  id: string;
  storageKey: string;
  thumbnailKey: string | null;
  fileType: string;
}

export function MessageInput({
  onSend,
  replyTo,
  onCancelReply,
  members,
  disabled = false,
  placeholder,
  conversationId,
  aiEnabled = true,
}: MessageInputProps) {
  const t = useTranslations("chat");
  // 从路由 /[locale]/w/[wid]/im 获取当前工作区 ID
  const params = useParams<{ locale: string; wid: string }>();
  const wid = params?.wid;

  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [mention, setMention] = useState<MentionState | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // 附件上传状态：记录正在上传的 attachment id（上传期间在预览区显示 Loader2）
  const [uploadingIds, setUploadingIds] = useState<Set<string>>(new Set());
  // 上传错误提示（短暂展示后自动清除）
  const [uploadError, setUploadError] = useState<string | null>(null);

  // 任务选择弹窗状态
  const [taskPickerOpen, setTaskPickerOpen] = useState(false);
  const [taskPickerLoading, setTaskPickerLoading] = useState(false);
  const [taskPickerError, setTaskPickerError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskPickerItem[]>([]);

  // AI 回复建议面板状态：是否展开 ImReplySuggestions
  const [aiReplyOpen, setAiReplyOpen] = useState(false);

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
  const detectMention = useCallback((value: string, cursorPos: number) => {
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
  }, []);

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
  const handleSend = useCallback(async () => {
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

      await onSend(trimmed, opts);

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

  // —— 文件上传处理：上传到服务端获取持久化 URL ——
  // 流程：立即生成本地预览（blob URL）→ 添加到预览区（标记 uploading）→
  //       异步 POST /api/v1/workspaces/{wid}/files/upload → 用服务端 URL 替换本地 URL
  // wid 不可用时回退到本地 blob URL（其他用户无法访问，但保证本机可用）
  const processFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      for (const file of list) {
        if (file.size > MAX_FILE_SIZE) {
          // 超过大小限制，跳过（UI 上由字数提示区域显示警告）
          continue;
        }
        const isImage = file.type.startsWith("image/");
        const previewUrl = isImage ? URL.createObjectURL(file) : null;
        // 生成唯一附件 ID（加随机后缀避免同毫秒同名冲突）
        const attachmentId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const attachment: Attachment = {
          id: attachmentId,
          fileName: file.name,
          url: "#", // 上传完成后替换为服务端持久化 URL
          fileType: file.type || "application/octet-stream",
          fileSize: file.size,
          thumbnailUrl: previewUrl,
        };
        // 立即添加到预览区，标记为 uploading
        setAttachments((prev) => [...prev, attachment]);
        setUploadingIds((prev) => new Set(prev).add(attachmentId));

        try {
          // wid 不可用：回退到本地 blob URL（仅本机可访问）
          if (!wid) {
            const fallbackUrl = previewUrl ?? "#";
            setAttachments((prev) =>
              prev.map((a) => (a.id === attachmentId ? { ...a, url: fallbackUrl } : a)),
            );
            continue;
          }

          // 上传到服务端（multipart/form-data，field name = "file"）
          const formData = new FormData();
          formData.append("file", file);
          const res = await fetch(`/api/v1/workspaces/${wid}/files/upload`, {
            method: "POST",
            body: formData,
            credentials: "include",
          });
          if (!res.ok) {
            throw new Error(`upload failed: ${res.status}`);
          }
          const json = (await res.json()) as { code: number; data: UploadedFileAsset | null };
          const fileAsset = json.data;
          if (!fileAsset || !fileAsset.storageKey) {
            throw new Error("invalid upload response");
          }
          // 拼接持久化 URL（与 message_attachments.url 字段格式一致：/uploads/xxx）
          const persistentUrl = `/uploads/${fileAsset.storageKey}`;
          const persistentThumbnail = fileAsset.thumbnailKey
            ? `/uploads/${fileAsset.thumbnailKey}`
            : previewUrl;

          setAttachments((prev) =>
            prev.map((a) =>
              a.id === attachmentId
                ? { ...a, url: persistentUrl, thumbnailUrl: persistentThumbnail }
                : a,
            ),
          );
          // 释放本地 blob URL：仅当后端返回了 thumbnailKey 时才 revoke previewUrl
          // （若 thumbnailKey 不存在，thumbnailUrl 仍指向 previewUrl，不能释放）
          if (previewUrl && fileAsset.thumbnailKey) URL.revokeObjectURL(previewUrl);
        } catch {
          // 上传失败：移除该附件并释放 blob URL，显示错误提示
          setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
          if (previewUrl) URL.revokeObjectURL(previewUrl);
          setUploadError(t("uploadFailed"));
        } finally {
          setUploadingIds((prev) => {
            const next = new Set(prev);
            next.delete(attachmentId);
            return next;
          });
        }
      }
    },
    [wid, t],
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
  // 使用 ref 跟踪 attachments，仅在组件卸载时释放，避免每次 attachments 变化时过早释放
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  useEffect(() => {
    return () => {
      attachmentsRef.current.forEach((a) => {
        if (a.thumbnailUrl?.startsWith("blob:")) URL.revokeObjectURL(a.thumbnailUrl);
      });
    };
  }, []);

  // —— 上传错误提示自动清除（3 秒后消失） ——
  useEffect(() => {
    if (!uploadError) return;
    const timer = setTimeout(() => setUploadError(null), 3000);
    return () => clearTimeout(timer);
  }, [uploadError]);

  // —— 分享任务：打开弹窗并加载最近任务列表 ——
  const handleShareTaskClick = useCallback(async () => {
    setTaskPickerOpen(true);
    setTaskPickerError(null);
    if (!wid) {
      setTaskPickerError(t("taskPickerUnavailable"));
      setTasks([]);
      return;
    }
    setTaskPickerLoading(true);
    try {
      const data = await api<{ items: TaskPickerItem[] }>(
        `/api/v1/workspaces/${wid}/tasks?limit=20`,
      );
      setTasks(data.items ?? []);
    } catch {
      setTaskPickerError(t("taskPickerLoadFailed"));
      setTasks([]);
    } finally {
      setTaskPickerLoading(false);
    }
  }, [wid, t]);

  // —— 选中任务：在输入框插入 [task:taskId:taskTitle] 文本 ——
  const handleTaskSelect = useCallback((taskId: string, taskTitle: string) => {
    const insertText = `[task:${taskId}:${taskTitle}]`;
    setBody((prev) => (prev ? `${prev} ${insertText}` : insertText));
    setTaskPickerOpen(false);
    // 聚焦回输入框
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  // —— 关闭任务弹窗 ——
  const handleCloseTaskPicker = useCallback(() => {
    setTaskPickerOpen(false);
    setTaskPickerError(null);
  }, []);

  // —— 切换 AI 回复建议面板 ——
  // 仅当 wid + conversationId 齐全且 AI 已配置时可展开
  const canUseAiReply = !!wid && !!conversationId && aiEnabled;
  const handleToggleAiReply = useCallback(() => {
    if (!canUseAiReply) return;
    setAiReplyOpen((prev) => !prev);
  }, [canUseAiReply]);

  // —— 选中 AI 回复建议：填入输入框并聚焦、关闭面板 ——
  const handleAiReplySelect = useCallback((text: string) => {
    setBody(text);
    setAiReplyOpen(false);
    // 聚焦输入框并把光标移到末尾，方便用户直接编辑或发送
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(text.length, text.length);
    });
  }, []);

  // —— 发送条件 ——
  const overLimit = body.length > MAX_BODY_LENGTH;
  // 有附件正在上传时禁用发送，避免发出未完成上传的附件
  const hasUploading = uploadingIds.size > 0;
  const canSend = body.trim().length > 0 && !sending && !disabled && !overLimit && !hasUploading;
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

      {/* 上传错误提示 */}
      {uploadError && (
        <div className="mb-[var(--space-2)] flex items-center gap-[var(--space-2)] px-[var(--space-2)] py-1 rounded-[var(--radius-sm)] bg-[var(--danger-soft)] border border-[var(--danger)] text-[length:var(--text-xs)] text-[var(--danger)]">
          <AlertCircle size={14} className="shrink-0" />
          <span className="truncate">{uploadError}</span>
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
              {uploadingIds.has(att.id) ? (
                // 上传中：显示旋转图标
                <Loader2 size={14} className="shrink-0 animate-spin text-[var(--muted)]" />
              ) : (
                // 上传完成：显示移除按钮
                <button
                  type="button"
                  onClick={() => handleRemoveAttachment(att.id)}
                  aria-label={t("removeAttachment")}
                  className="shrink-0 w-4 h-4 flex items-center justify-center rounded text-[var(--muted)] hover:text-[var(--danger)] transition-colors duration-[var(--motion-fast)]"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* AI 回复建议面板：展开时显示在输入框上方，可关闭 */}
      {aiReplyOpen && wid && conversationId && (
        <div className="mb-[var(--space-2)] relative">
          {/* 关闭按钮：右上角悬浮，方便用户随时收起建议面板 */}
          <button
            type="button"
            onClick={() => setAiReplyOpen(false)}
            aria-label={t("cancel")}
            className="absolute top-[var(--space-2)] right-[var(--space-2)] z-[var(--z-sticky)] w-6 h-6 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-3)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
          >
            <X size={14} />
          </button>
          <ImReplySuggestions
            wid={wid}
            conversationId={conversationId}
            onSelect={handleAiReplySelect}
          />
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

        {/* 分享任务按钮 */}
        <button
          type="button"
          onClick={handleShareTaskClick}
          disabled={disabled}
          aria-label={t("shareTask")}
          className="shrink-0 w-9 h-9 flex items-center justify-center rounded-[var(--radius-md)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-fast)]"
        >
          <ListTodo size={16} />
        </button>

        {/* AI 回复建议按钮：仅当传入 conversationId 且 AI 可用时启用 */}
        {conversationId && (
          <button
            type="button"
            onClick={handleToggleAiReply}
            disabled={disabled || !canUseAiReply}
            aria-label={t("aiReply")}
            aria-pressed={aiReplyOpen}
            title={canUseAiReply ? t("aiReply") : t("aiReplyUnavailable")}
            className={`shrink-0 w-9 h-9 flex items-center justify-center rounded-[var(--radius-md)] transition-colors duration-[var(--motion-fast)] disabled:opacity-50 disabled:cursor-not-allowed ${
              aiReplyOpen
                ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                : "text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
            }`}
          >
            <Sparkles size={14} />
          </button>
        )}

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
          {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
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

      {/* 分享任务弹窗 */}
      {taskPickerOpen && (
        <div
          className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center"
          onClick={handleCloseTaskPicker}
        >
          {/* 遮罩 */}
          <div className="absolute inset-0 bg-[var(--overlay)]" aria-hidden="true" />
          {/* 弹窗主体 */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("shareTask")}
            onClick={(e) => e.stopPropagation()}
            className="relative w-[90vw] max-w-[420px] max-h-[60vh] flex flex-col rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-md)]"
          >
            {/* 弹窗头部 */}
            <div className="flex items-center justify-between px-[var(--space-3)] py-[var(--space-2)] border-b border-[var(--border)]">
              <span className="flex items-center gap-[var(--space-2)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
                <ListTodo size={16} className="text-[var(--accent)]" />
                {t("taskPickerTitle")}
              </span>
              <button
                type="button"
                onClick={handleCloseTaskPicker}
                aria-label={t("cancel")}
                className="shrink-0 w-6 h-6 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
              >
                <X size={14} />
              </button>
            </div>
            {/* 弹窗内容 */}
            <div className="flex-1 overflow-y-auto px-[var(--space-2)] py-[var(--space-2)]">
              {taskPickerLoading ? (
                <div className="flex items-center justify-center py-[var(--space-4)] text-[length:var(--text-sm)] text-[var(--muted)] gap-[var(--space-2)]">
                  <Loader2 size={16} className="animate-spin" />
                  {t("taskPickerLoading")}
                </div>
              ) : taskPickerError ? (
                <div className="flex items-center justify-center py-[var(--space-4)] text-[length:var(--text-sm)] text-[var(--danger)] gap-[var(--space-2)]">
                  <AlertCircle size={16} />
                  {taskPickerError}
                </div>
              ) : tasks.length === 0 ? (
                <div className="flex items-center justify-center py-[var(--space-4)] text-[length:var(--text-sm)] text-[var(--muted)]">
                  {t("taskPickerEmpty")}
                </div>
              ) : (
                <ul className="flex flex-col gap-1">
                  {tasks.map((task) => (
                    <li key={task.id}>
                      <button
                        type="button"
                        onClick={() => handleTaskSelect(task.id, task.title)}
                        className="w-full flex items-center gap-[var(--space-2)] px-[var(--space-2)] py-[var(--space-2)] rounded-[var(--radius-sm)] text-left hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
                      >
                        <ListTodo size={14} className="shrink-0 text-[var(--muted)]" />
                        <span className="min-w-0 flex-1 truncate text-[length:var(--text-sm)] text-[var(--fg)]">
                          {task.title}
                        </span>
                        <span className="shrink-0 text-[length:var(--text-xs)] text-[var(--meta)]">
                          {task.status}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
