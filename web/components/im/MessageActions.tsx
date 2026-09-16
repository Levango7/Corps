"use client";

/**
 * 消息操作菜单
 *
 * hover 或右键消息时显示的操作浮层：
 *  - 编辑（仅作者 + 5min 内 + 未撤回）→ 弹出编辑对话框
 *  - 撤回（仅作者 + 5min 内 + 未撤回）→ 确认后调用 onRecall
 *  - 复制（所有消息）→ navigator.clipboard.writeText(body)
 *  - 回复（所有消息）→ 调用 onReply
 *
 * 所有样式走 design token（var(--*)），无裸 hex。
 * lucide-react 图标尺寸用 14/16（项目约定）。
 */

import { memo, useState, useCallback, useEffect, useRef } from "react";
import { Edit, Trash, Copy, Reply, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Message } from "./types";

/** 编辑/撤回时间窗口（毫秒）：5 分钟，与后端一致 */
const EDIT_WINDOW_MS = 5 * 60 * 1000;

interface MessageActionsProps {
  /** 消息数据 */
  message: Message;
  /** 是否为自己的消息 */
  isOwn: boolean;
  /** 编辑消息回调 */
  onEdit: (newBody: string) => void;
  /** 撤回消息回调 */
  onRecall: () => void;
  /** 回复消息回调 */
  onReply: () => void;
}

function MessageActionsImpl({
  message,
  isOwn,
  onEdit,
  onRecall,
  onReply,
}: MessageActionsProps) {
  const t = useTranslations("im.actions");
  const [confirmingRecall, setConfirmingRecall] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const isRevoked = message.revokedAt !== null;
  const isExpired =
    Date.now() - new Date(message.createdAt).getTime() > EDIT_WINDOW_MS;
  /** 作者可在 5 分钟内编辑/撤回 */
  const canEditOrRecall = isOwn && !isRevoked && !isExpired;

  /** 复制消息内容到剪贴板 */
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(message.body);
      setCopied(true);
      // 1.5s 后恢复图标
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板 API 不可用（如非 HTTPS 环境），静默失败
    }
  }, [message.body]);

  /** 点击撤回 → 进入二次确认 */
  const handleRecallClick = useCallback(() => {
    setConfirmingRecall(true);
  }, []);

  /** 确认撤回 */
  const handleConfirmRecall = useCallback(() => {
    setConfirmingRecall(false);
    onRecall();
  }, [onRecall]);

  /** 取消撤回确认 */
  const handleCancelRecall = useCallback(() => {
    setConfirmingRecall(false);
  }, []);

  /** ESC 关闭确认态 */
  useEffect(() => {
    if (!confirmingRecall) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setConfirmingRecall(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [confirmingRecall]);

  // 撤回确认态：显示确认/取消
  if (confirmingRecall) {
    return (
      <div
        ref={menuRef}
        className="flex items-center gap-[var(--space-2)] rounded-[var(--radius-md)] bg-[var(--surface)] border border-[var(--border)] shadow-[var(--elev-sm)] px-[var(--space-2)] py-1"
      >
        <span className="text-[length:var(--text-xs)] text-[var(--fg)]">
          {t("confirmRecall")}
        </span>
        <button
          type="button"
          onClick={handleCancelRecall}
          className="px-[var(--space-2)] py-0.5 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] text-[var(--muted)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
        >
          {t("cancel")}
        </button>
        <button
          type="button"
          onClick={handleConfirmRecall}
          className="px-[var(--space-2)] py-0.5 rounded-[var(--radius-sm)] bg-[var(--danger)] text-[var(--danger-fg)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] hover:bg-[var(--danger-hover)] transition-colors duration-[var(--motion-fast)]"
        >
          {t("recall")}
        </button>
      </div>
    );
  }

  return (
    <div
      ref={menuRef}
      className="flex items-center gap-0.5 rounded-[var(--radius-sm)] bg-[var(--surface)] border border-[var(--border)] shadow-[var(--elev-sm)] p-0.5"
    >
      {/* 回复 */}
      <button
        type="button"
        onClick={onReply}
        aria-label={t("reply")}
        title={t("reply")}
        className="w-6 h-6 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
      >
        <Reply size={14} />
      </button>

      {/* 复制 */}
      <button
        type="button"
        onClick={handleCopy}
        aria-label={t("copy")}
        title={t("copy")}
        className="w-6 h-6 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>

      {/* 编辑（仅作者 + 5min 内 + 未撤回） */}
      {canEditOrRecall && (
        <button
          type="button"
          onClick={() => onEdit(message.body)}
          aria-label={t("edit")}
          title={t("edit")}
          className="w-6 h-6 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
        >
          <Edit size={14} />
        </button>
      )}

      {/* 撤回（仅作者 + 5min 内 + 未撤回） */}
      {canEditOrRecall && (
        <button
          type="button"
          onClick={handleRecallClick}
          aria-label={t("recall")}
          title={t("recall")}
          className="w-6 h-6 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] transition-colors duration-[var(--motion-fast)]"
        >
          <Trash size={14} />
        </button>
      )}
    </div>
  );
}

export const MessageActions = memo(MessageActionsImpl);