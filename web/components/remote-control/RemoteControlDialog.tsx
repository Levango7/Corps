"use client";

/**
 * 远程控制请求对话框 · components/remote-control/RemoteControlDialog.tsx
 *
 * 功能：
 *  - 当收到远程控制请求时弹出模态对话框
 *  - 显示请求者信息（姓名/邮箱/头像）
 *  - 接受/拒绝按钮
 *  - 自动倒计时（30 秒无操作自动拒绝，避免请求悬挂）
 *
 * design token 样式，lucide-react 图标（size 14/16），
 * useTranslations("remoteControl") 国际化。
 * v-modal-a11y 指令确保可访问性（焦点陷阱 + ESC 关闭）。
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import {
  Monitor,
  Check,
  X,
  Loader2,
  Clock,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";

// ─── 类型 ──────────────────────────────────────────────────────

/** 远程控制会话 DTO */
interface RemoteControlSessionDTO {
  id: string;
  workspaceId: string;
  initiatorId: string;
  targetId: string;
  status: string;
  endReason: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 请求者用户信息 */
interface UserInfo {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
}

export interface RemoteControlDialogProps {
  /** 远程控制请求会话 */
  session: RemoteControlSessionDTO;
  /** 当前工作区 ID */
  workspaceId: string;
  /** 请求者用户信息（由父组件加载后传入） */
  requester?: UserInfo;
  /** 接受回调 */
  onAccept: (session: RemoteControlSessionDTO) => void;
  /** 拒绝回调 */
  onReject: (session: RemoteControlSessionDTO) => void;
  /** 关闭对话框回调（自动拒绝或 ESC） */
  onClose: () => void;
}

// ─── 常量 ──────────────────────────────────────────────────────

/** 自动拒绝倒计时（秒） */
const AUTO_REJECT_SECONDS = 30;

// ─── 组件 ──────────────────────────────────────────────────────

export function RemoteControlDialog({
  session,
  workspaceId,
  requester,
  onAccept,
  onReject,
  onClose,
}: RemoteControlDialogProps) {
  const t = useTranslations("remoteControl");

  const [actioning, setActioning] = useState(false);
  const [error, setError] = useState("");
  const [countdown, setCountdown] = useState(AUTO_REJECT_SECONDS);
  const dialogRef = useRef<HTMLDivElement>(null);

  // 自动拒绝倒计时
  useEffect(() => {
    if (countdown <= 0) {
      // 倒计时结束，自动拒绝
      void handleReject();
      return;
    }
    const timer = setTimeout(() => {
      setCountdown((c) => c - 1);
    }, 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  // 焦点陷阱 + ESC 关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      // 简单焦点陷阱：Tab 在对话框内循环
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    // 初始聚焦对话框
    dialogRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  // 接受请求
  const handleAccept = useCallback(async () => {
    setActioning(true);
    setError("");
    try {
      const updated = await api<RemoteControlSessionDTO>(
        `/api/v1/remote-control/${session.id}?workspaceId=${workspaceId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ action: "accept" }),
        },
      );
      onAccept(updated);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("failed");
      setError(msg);
      setActioning(false);
    }
  }, [session.id, workspaceId, onAccept, t]);

  // 拒绝请求
  const handleReject = useCallback(async () => {
    setActioning(true);
    setError("");
    try {
      const updated = await api<RemoteControlSessionDTO>(
        `/api/v1/remote-control/${session.id}?workspaceId=${workspaceId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ action: "reject" }),
        },
      );
      onReject(updated);
    } catch (err) {
      // 拒绝失败也关闭对话框（避免卡死）
      console.error("[RemoteControlDialog] reject failed:", err);
      onClose();
    }
  }, [session.id, workspaceId, onReject, onClose]);

  // 请求者显示名
  const requesterName = requester?.name ?? requester?.email ?? session.initiatorId.slice(0, 8);

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-[var(--bg)] bg-opacity-60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="remote-control-dialog-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md mx-[var(--space-4)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-lg)] focus:outline-none"
      >
        {/* 头部 */}
        <div className="flex items-center gap-[var(--space-3)] px-[var(--space-5)] py-[var(--space-4)] border-b border-[var(--border-soft)]">
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-[var(--accent-bg)]">
            <Monitor size={20} className="text-[var(--accent)]" />
          </div>
          <div className="flex-1 min-w-0">
            <h2
              id="remote-control-dialog-title"
              className="text-[length:var(--text-base)] font-[weight:var(--weight-semibold)] text-[var(--fg-1)]"
            >
              {t("incoming")}
            </h2>
            <p className="text-[length:var(--text-xs)] text-[var(--muted)]">
              {t("waitingForAccept")}
            </p>
          </div>
          {/* 倒计时 */}
          <div className="flex items-center gap-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--meta)]">
            <Clock size={14} />
            <span>{countdown}s</span>
          </div>
        </div>

        {/* 内容 */}
        <div className="px-[var(--space-5)] py-[var(--space-4)]">
          {/* 请求者信息 */}
          <div className="flex items-center gap-[var(--space-3)] mb-[var(--space-4)]">
            {requester?.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={requester.image}
                alt={requesterName}
                className="w-10 h-10 rounded-full object-cover"
              />
            ) : (
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-[var(--surface-2)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
                {requesterName.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-1)] truncate">
                {requesterName}
              </p>
              {requester?.email && (
                <p className="text-[length:var(--text-xs)] text-[var(--muted)] truncate">
                  {requester.email}
                </p>
              )}
            </div>
          </div>

          {/* 提示文本 */}
          <p className="text-[length:var(--text-sm)] text-[var(--fg-2)] mb-[var(--space-2)]">
            {requesterName} {t("request")} {t("screenShare")}
          </p>
          <p className="text-[length:var(--text-xs)] text-[var(--muted)]">
            {t("beingControlled")}
          </p>

          {/* 错误提示 */}
          {error && (
            <div className="mt-[var(--space-3)] px-[var(--space-3)] py-[var(--space-2)] rounded-[var(--radius-sm)] bg-[var(--danger-bg)] text-[var(--danger)] text-[length:var(--text-sm)]">
              {error}
            </div>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-[var(--space-2)] px-[var(--space-5)] py-[var(--space-4)] border-t border-[var(--border-soft)]">
          <button
            type="button"
            onClick={handleReject}
            disabled={actioning}
            className="flex-1 flex items-center justify-center gap-[var(--space-1)] h-10 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-fast)]"
          >
            {actioning ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <X size={14} />
            )}
            {t("reject")}
          </button>
          <button
            type="button"
            onClick={handleAccept}
            disabled={actioning}
            className="flex-1 flex items-center justify-center gap-[var(--space-1)] h-10 rounded-[var(--radius-md)] bg-[var(--success)] text-[var(--success-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--success-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-fast)]"
          >
            {actioning ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Check size={14} />
            )}
            {t("accept")}
          </button>
        </div>
      </div>
    </div>
  );
}