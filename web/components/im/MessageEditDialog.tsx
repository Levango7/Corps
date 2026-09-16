"use client";

/**
 * 消息编辑对话框
 *
 * 显示原始消息内容（只读）+ 编辑输入框（多行 textarea）+ 保存/取消按钮。
 * 保存时调用 PATCH /api/v1/im/messages/{id}。
 *
 * 交互：
 *  - ⌘/Ctrl + Enter 保存
 *  - Escape 取消
 *  - Tab 焦点陷阱
 *  - 背景点击关闭
 *
 * 所有样式走 design token（var(--*)），无裸 hex。
 * lucide-react 图标尺寸用 14/16（项目约定）。
 */

import {
  useState,
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { api, ApiError } from "@/lib/api";
import type { Message } from "./types";

/** 消息体最大长度（与后端一致） */
const MAX_BODY_LENGTH = 10000;

interface MessageEditDialogProps {
  /** 是否打开 */
  open: boolean;
  /** 消息数据 */
  message: Message;
  /** 工作区 ID（调用 API 需要） */
  workspaceId: string;
  /** 关闭对话框 */
  onClose: () => void;
  /** 编辑成功回调（传入新 body） */
  onEdited: (newBody: string) => void;
}

export function MessageEditDialog({
  open,
  message,
  workspaceId,
  onClose,
  onEdited,
}: MessageEditDialogProps) {
  const t = useTranslations("im.actions");
  const [editBody, setEditBody] = useState(message.body);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 打开时重置状态
  useEffect(() => {
    if (open) {
      setEditBody(message.body);
      setSaving(false);
      setError(null);
    }
  }, [open, message.body]);

  // 焦点管理：打开时聚焦 textarea
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // 延迟一帧聚焦，确保 DOM 已渲染
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.select();
    });
    return () => {
      previouslyFocused?.focus?.();
    };
  }, [open]);

  // Escape 关闭 + Tab focus trap
  useEffect(() => {
    if (!open) return;
    const container = dialogRef.current;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab" && container) {
        const focusables = Array.from(
          container.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])',
          ),
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, saving, onClose]);

  /** 保存编辑 */
  const handleSave = useCallback(async () => {
    const trimmed = editBody.trim();
    if (!trimmed || trimmed === message.body) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api(`/api/v1/im/messages/${message.id}`, {
        method: "PATCH",
        body: JSON.stringify({ workspaceId, body: trimmed }),
      });
      onEdited(trimmed);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(t("error"));
      }
    } finally {
      setSaving(false);
    }
  }, [editBody, message.id, message.body, workspaceId, onEdited, onClose, t]);

  /** textarea 键盘事件 */
  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (!saving) handleSave();
      }
    },
    [handleSave, saving],
  );

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("edit")}
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-[var(--overlay)] p-[var(--space-4)]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-[var(--radius-lg)] bg-[var(--surface)] border border-[var(--border)] shadow-[var(--elev-lg)] p-[var(--space-5)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题 */}
        <h3 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)] mb-[var(--space-3)]">
          {t("edit")}
        </h3>

        {/* 原始消息（只读） */}
        <div className="mb-[var(--space-3)]">
          <label className="block text-[length:var(--text-xs)] text-[var(--muted)] mb-1">
            {t("original")}
          </label>
          <div className="px-[var(--space-3)] py-[var(--space-2)] rounded-[var(--radius-md)] bg-[var(--surface-2)] text-[length:var(--text-sm)] text-[var(--fg-2)] whitespace-pre-wrap break-words max-h-24 overflow-y-auto">
            {message.body}
          </div>
        </div>

        {/* 编辑输入框 */}
        <div className="mb-[var(--space-3)]">
          <label className="block text-[length:var(--text-xs)] text-[var(--muted)] mb-1">
            {t("edit")}
          </label>
          <textarea
            ref={textareaRef}
            value={editBody}
            onChange={(e) => setEditBody(e.target.value.slice(0, MAX_BODY_LENGTH))}
            onKeyDown={handleKeyDown}
            rows={Math.min(8, Math.max(3, editBody.split("\n").length))}
            disabled={saving}
            className="w-full px-[var(--space-3)] py-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none resize-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:opacity-50"
          />
          <div className="mt-1 flex items-center justify-between text-[length:var(--text-xs)] text-[var(--muted)]">
            <span>{t("editHint")}</span>
            <span>
              {editBody.length}/{MAX_BODY_LENGTH}
            </span>
          </div>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="mb-[var(--space-3)] px-[var(--space-3)] py-[var(--space-2)] rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[length:var(--text-sm)] text-[var(--danger)]">
            {error}
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex items-center justify-end gap-[var(--space-2)]">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="h-8 px-[var(--space-3)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] active:bg-[var(--surface-3)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 disabled:opacity-50"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !editBody.trim() || editBody.trim() === message.body}
            className="inline-flex items-center gap-1.5 h-8 px-[var(--space-3)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] bg-[var(--accent)] text-[var(--accent-fg)] hover:bg-[var(--accent-hover)] active:opacity-80 disabled:opacity-50 transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {t("save")}
          </button>
        </div>
      </div>
    </div>
  );
}