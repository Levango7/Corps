"use client";

/**
 * 文档分享弹窗（阶段 6 · 任务 222）
 *
 * 功能：
 *  - 可见性切换：private / workspace / shared（三个单选按钮）
 *  - 人员权限列表（嵌入 PermissionManager）
 *  - 复制分享链接按钮
 *
 * 数据流：
 *  - PATCH /v1/workspaces/{wid}/documents/{did}  更新 visibility
 *  - 权限 CRUD 由 PermissionManager 内部处理
 *
 * Modal 模式：fixed inset-0 + backdrop，Esc 关闭，点击遮罩关闭。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Share2,
  X,
  Link as LinkIcon,
  Copy,
  Check,
  Loader2,
  Lock,
  Users,
  Globe,
  AlertCircle,
} from "lucide-react";
import { api } from "@/lib/api";
import { PermissionManager } from "./PermissionManager";

type Visibility = "private" | "workspace" | "shared";

const VISIBILITY_OPTIONS: {
  value: Visibility;
  icon: typeof Lock;
  labelKey: string;
}[] = [
  { value: "private", icon: Lock, labelKey: "private" },
  { value: "workspace", icon: Users, labelKey: "workspace" },
  { value: "shared", icon: Globe, labelKey: "shared" },
];

export function ShareDialog({
  docId,
  workspaceId,
  docTitle,
  currentVisibility,
  onClose,
}: {
  docId: string;
  workspaceId: string;
  docTitle: string;
  currentVisibility: string;
  onClose: () => void;
}) {
  const t = useTranslations("doc");
  const tButton = useTranslations("button");
  const dialogRef = useRef<HTMLDivElement>(null);

  const [visibility, setVisibility] = useState<Visibility>(
    (currentVisibility as Visibility) || "private",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 焦点陷阱：打开时聚焦弹窗
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const focusable = el.querySelectorAll<HTMLElement>(
      'button, a, input, textarea, select, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length > 0) focusable[0].focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    el.addEventListener("keydown", handleKeyDown);
    return () => el.removeEventListener("keydown", handleKeyDown);
  }, []);

  const updateVisibility = useCallback(
    async (next: Visibility) => {
      if (next === visibility || saving) return;
      setSaving(true);
      setError("");
      try {
        await api(
          `/api/v1/workspaces/${workspaceId}/documents/${docId}`,
          {
            method: "PATCH",
            body: JSON.stringify({ visibility: next }),
          },
        );
        setVisibility(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : t("visibilityUpdateFailed"));
        // 回滚 UI 选择
        setVisibility(visibility);
      } finally {
        setSaving(false);
      }
    },
    [visibility, saving, workspaceId, docId, t],
  );

  async function copyLink() {
    setError("");
    try {
      const link = `${window.location.origin}/w/${workspaceId}/documents/${docId}`;
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API 不可用时静默失败
    }
  }

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-dialog-title"
      className="fixed inset-0 z-[var(--z-modal)] flex items-start justify-center p-4 sm:p-8 overflow-y-auto bg-[var(--overlay)]"
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        onClose();
      }}
    >
      <div className="w-full max-w-lg my-auto bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-lg)]">
        {/* 头部 */}
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-soft)]">
          <div className="flex items-center gap-2 min-w-0">
            <Share2 size={16} className="shrink-0 text-[var(--muted)]" />
            <h2
              id="share-dialog-title"
              className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)] truncate"
            >
              {t("shareDialogTitle")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            aria-label={tButton("close")}
          >
            <X size={16} />
          </button>
        </header>

        <div className="px-5 py-4 space-y-[var(--space-4)]">
          {/* 文档标题 */}
          <p className="text-[length:var(--text-sm)] text-[var(--muted)] truncate">
            {docTitle}
          </p>

          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--danger-soft)] text-[var(--danger)] text-[length:var(--text-xs)]">
              <AlertCircle size={14} className="shrink-0" />
              <span className="flex-1">{error}</span>
            </div>
          )}

          {/* 可见性切换 */}
          <div>
            <label className="flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--meta)] mb-2">
              {t("visibility")}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {VISIBILITY_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const active = visibility === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => updateVisibility(opt.value)}
                    disabled={saving}
                    className={`inline-flex flex-col items-center gap-1.5 py-3 rounded-[var(--radius-md)] border text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] transition-colors duration-[var(--motion-fast)] disabled:opacity-50 ${
                      active
                        ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-soft-fg)]"
                        : "border-[var(--border)] bg-[var(--surface)] text-[var(--fg-2)] hover:bg-[var(--surface-2)]"
                    }`}
                    aria-pressed={active}
                  >
                    {saving && active ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Icon size={16} />
                    )}
                    {t(opt.labelKey)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 权限管理（嵌入 PermissionManager） */}
          <PermissionManager docId={docId} workspaceId={workspaceId} />

          {/* 复制分享链接 */}
          <div className="flex items-center gap-2 pt-1">
            <div className="flex-1 flex items-center gap-2 h-9 px-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] text-[length:var(--text-sm)] text-[var(--muted)] truncate">
              <LinkIcon size={14} className="shrink-0" />
              <span className="truncate">
                {typeof window !== "undefined"
                  ? `${window.location.origin}/w/${workspaceId}/documents/${docId}`
                  : ""}
              </span>
            </div>
            <button
              type="button"
              onClick={copyLink}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-fast)]"
            >
              {copied ? (
                <>
                  <Check size={14} />
                  {t("linkCopied")}
                </>
              ) : (
                <>
                  <Copy size={14} />
                  {t("copyLink")}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}