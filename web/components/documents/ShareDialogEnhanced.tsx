"use client";

/**
 * 分享对话框增强组件。
 *
 * 功能：
 * - 分享链接列表（权限级别、下载/打印/复制开关、过期时间、访问次数）
 * - 创建分享链接表单（权限级别、允许下载/打印/复制、密码保护、过期时间、最大访问次数）
 * - 撤销分享链接
 * - 复制链接到剪贴板
 *
 * API：
 * - GET    /api/v1/workspaces/${workspaceId}/documents/${documentId}/share-links
 * - POST   /api/v1/workspaces/${workspaceId}/documents/${documentId}/share-links
 * - DELETE /api/v1/workspaces/${workspaceId}/documents/${documentId}/share-links/${shareLinkId}
 *
 * 分享 URL 格式：${window.location.origin}/share/${shareToken}
 */

import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import {
  Loader2,
  Plus,
  Trash2,
  Copy,
  Check,
  Link2,
  Eye,
  MessageSquare,
  Pencil,
  Download,
  Printer,
  Copy as CopyIcon,
  Lock,
  Clock,
  X,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";

/** 分享链接数据结构 */
interface ShareLink {
  id: string;
  token: string;
  permission: "view" | "comment" | "edit";
  allowDownload: boolean;
  allowPrint: boolean;
  allowCopy: boolean;
  passwordProtected: boolean;
  expiresAt: string | null;
  maxViews: number | null;
  viewCount: number;
  createdAt: string;
}

/** 分享链接列表响应 */
interface ShareLinkListResponse {
  items: ShareLink[];
  total: number;
}

/** 创建分享链接请求体 */
interface CreateShareLinkPayload {
  permission: "view" | "comment" | "edit";
  allowDownload: boolean;
  allowPrint: boolean;
  allowCopy: boolean;
  password?: string;
  expiresAt?: string;
  maxViews?: number;
}

interface ShareDialogEnhancedProps {
  workspaceId: string;
  documentId: string;
  onClose?: () => void;
}

/** 权限级别选项 */
const PERMISSION_LEVELS = ["view", "comment", "edit"] as const;

/** 样式常量 */
const fieldLabel =
  "flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--meta)] mb-1.5";
const fieldControl =
  "w-full h-9 px-2.5 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]";

/** 格式化日期时间用于显示 */
function formatDateTime(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 判断链接是否已过期 */
function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() < Date.now();
}

/** 权限级别图标映射 */
function PermissionIcon({ level }: { level: "view" | "comment" | "edit" }) {
  if (level === "view") return <Eye size={14} className="text-[var(--muted)]" />;
  if (level === "comment") return <MessageSquare size={14} className="text-[var(--muted)]" />;
  return <Pencil size={14} className="text-[var(--muted)]" />;
}

/** 权限开关状态徽章 */
function PermissionBadge({
  enabled,
  icon: Icon,
  label,
}: {
  enabled: boolean;
  icon: typeof Download;
  label: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] ${
        enabled
          ? "text-[var(--success)] bg-[var(--success-soft, var(--surface-2))]"
          : "text-[var(--muted)] bg-[var(--surface-2)]"
      }`}
    >
      <Icon size={12} />
      {label}
    </span>
  );
}

export function ShareDialogEnhanced({
  workspaceId,
  documentId,
  onClose,
}: ShareDialogEnhancedProps) {
  const t = useTranslations("permissions");

  const [shareLinks, setShareLinks] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 创建分享链接表单状态
  const [showForm, setShowForm] = useState(false);
  const [permission, setPermission] = useState<"view" | "comment" | "edit">("view");
  const [allowDownload, setAllowDownload] = useState(false);
  const [allowPrint, setAllowPrint] = useState(false);
  const [allowCopy, setAllowCopy] = useState(false);
  const [password, setPassword] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [maxViews, setMaxViews] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  // 复制链接反馈状态
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // 成功提示状态
  const [successMsg, setSuccessMsg] = useState("");

  async function loadShareLinks() {
    setLoading(true);
    setError("");
    try {
      const data = await api<ShareLinkListResponse>(
        `/api/v1/workspaces/${workspaceId}/documents/${documentId}/share-links`,
      );
      setShareLinks(data.items ?? []);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadShareLinks();
  }, [workspaceId, documentId]);

  /** 自动清除成功提示 */
  useEffect(() => {
    if (!successMsg) return;
    const timer = setTimeout(() => setSuccessMsg(""), 3000);
    return () => clearTimeout(timer);
  }, [successMsg]);

  /** 复制分享链接到剪贴板 */
  async function copyShareLink(link: ShareLink) {
    const shareUrl = `${window.location.origin}/share/${link.token}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedId(link.id);
      setSuccessMsg(t("linkCopied"));
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setError(t("copyFailed"));
    }
  }

  /** 撤销分享链接 */
  async function revokeShareLink(link: ShareLink) {
    if (!window.confirm(t("confirmRevoke"))) return;
    try {
      await api(
        `/api/v1/workspaces/${workspaceId}/documents/${documentId}/share-links/${link.id}`,
        { method: "DELETE" },
      );
      setShareLinks((prev) => prev.filter((l) => l.id !== link.id));
      setSuccessMsg(t("shareLinkRevoked"));
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : t("shareFailed"));
    }
  }

  /** 提交创建分享链接表单 */
  async function submitShareLink(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setFormError("");
    try {
      const payload: CreateShareLinkPayload = {
        permission,
        allowDownload,
        allowPrint,
        allowCopy,
      };
      if (password.trim()) {
        payload.password = password.trim();
      }
      if (expiresAt) {
        payload.expiresAt = new Date(expiresAt).toISOString();
      }
      if (maxViews) {
        const views = parseInt(maxViews, 10);
        if (views > 0) {
          payload.maxViews = views;
        }
      }

      await api(`/api/v1/workspaces/${workspaceId}/documents/${documentId}/share-links`, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      // 成功后刷新列表并关闭表单
      setShowForm(false);
      resetForm();
      setSuccessMsg(t("shareLinkCreated"));
      loadShareLinks();
    } catch (e) {
      setFormError(e instanceof ApiError || e instanceof Error ? e.message : t("shareFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  /** 重置表单字段 */
  function resetForm() {
    setPermission("view");
    setAllowDownload(false);
    setAllowPrint(false);
    setAllowCopy(false);
    setPassword("");
    setExpiresAt("");
    setMaxViews("");
    setFormError("");
  }

  return (
    <div className="w-full max-w-[560px] mx-auto">
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-[var(--space-4)]">
        <div className="flex items-center gap-2">
          <Link2 size={16} className="text-[var(--muted)]" />
          <h2 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
            {t("shareLinks")}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowForm((v) => !v)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-fast)]"
          >
            <Plus size={14} />
            {t("createShareLink")}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              aria-label={t("close")}
              className="inline-flex items-center justify-center h-8 w-8 rounded-[var(--radius-md)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mb-3 flex items-start gap-2 px-3 py-2 rounded-[var(--radius-md)] bg-[var(--danger-soft, var(--surface-2))] text-[var(--danger-fg, var(--danger))] text-[length:var(--text-sm)]">
          <span className="flex-1">{error}</span>
          <button
            onClick={() => setError("")}
            aria-label={t("close")}
            className="shrink-0 text-[var(--muted)] hover:text-[var(--fg)]"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* 成功提示 */}
      {successMsg && (
        <div className="mb-3 flex items-start gap-2 px-3 py-2 rounded-[var(--radius-md)] bg-[var(--success-soft, var(--surface-2))] text-[var(--success)] text-[length:var(--text-sm)]">
          <Check size={14} className="shrink-0 mt-0.5" />
          <span className="flex-1">{successMsg}</span>
        </div>
      )}

      {/* 创建分享链接表单 */}
      {showForm && (
        <form
          onSubmit={submitShareLink}
          className="mb-[var(--space-4)] p-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] space-y-4"
        >
          {/* 权限级别 */}
          <div>
            <label className={fieldLabel} htmlFor="share-permission">
              {t("shareLinkPermission")}
            </label>
            <div className="flex items-center gap-2">
              {PERMISSION_LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setPermission(level)}
                  className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] transition-colors duration-[var(--motion-fast)] ${
                    permission === level
                      ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                      : "bg-[var(--surface-2)] text-[var(--fg-2)] hover:bg-[var(--surface-3, var(--surface-2))]"
                  }`}
                >
                  <PermissionIcon level={level} />
                  {t(level)}
                </button>
              ))}
            </div>
          </div>

          {/* 允许下载 / 打印 / 复制 */}
          <div className="grid grid-cols-3 gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={allowDownload}
                onChange={(e) => setAllowDownload(e.target.checked)}
                className="h-4 w-4 rounded-[var(--radius-sm)] border-[var(--border)] accent-[var(--accent)]"
              />
              <span className="inline-flex items-center gap-1 text-[length:var(--text-sm)] text-[var(--fg-2)]">
                <Download size={14} className="text-[var(--muted)]" />
                {t("allowDownload")}
              </span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={allowPrint}
                onChange={(e) => setAllowPrint(e.target.checked)}
                className="h-4 w-4 rounded-[var(--radius-sm)] border-[var(--border)] accent-[var(--accent)]"
              />
              <span className="inline-flex items-center gap-1 text-[length:var(--text-sm)] text-[var(--fg-2)]">
                <Printer size={14} className="text-[var(--muted)]" />
                {t("allowPrint")}
              </span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={allowCopy}
                onChange={(e) => setAllowCopy(e.target.checked)}
                className="h-4 w-4 rounded-[var(--radius-sm)] border-[var(--border)] accent-[var(--accent)]"
              />
              <span className="inline-flex items-center gap-1 text-[length:var(--text-sm)] text-[var(--fg-2)]">
                <CopyIcon size={14} className="text-[var(--muted)]" />
                {t("allowCopy")}
              </span>
            </label>
          </div>

          {/* 密码保护（可选） */}
          <div>
            <label className={fieldLabel} htmlFor="share-password">
              <Lock size={14} className="text-[var(--muted)]" />
              {t("passwordProtect")}
            </label>
            <input
              id="share-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="—"
              className={fieldControl}
            />
          </div>

          {/* 过期时间（可选） */}
          <div>
            <label className={fieldLabel} htmlFor="share-expires">
              <Clock size={14} className="text-[var(--muted)]" />
              {t("linkExpires")}
            </label>
            <input
              id="share-expires"
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className={fieldControl}
            />
          </div>

          {/* 最大访问次数（可选） */}
          <div>
            <label className={fieldLabel} htmlFor="share-max-views">
              {t("maxViews")}
            </label>
            <input
              id="share-max-views"
              type="number"
              min="1"
              value={maxViews}
              onChange={(e) => setMaxViews(e.target.value)}
              placeholder="—"
              className={fieldControl}
            />
          </div>

          {/* 表单错误提示 */}
          {formError && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-[var(--radius-md)] bg-[var(--danger-soft, var(--surface-2))] text-[var(--danger-fg, var(--danger))] text-[length:var(--text-sm)]">
              <span className="flex-1">{formError}</span>
            </div>
          )}

          {/* 表单操作按钮 */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                resetForm();
              }}
              className="h-9 px-4 rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            >
              {t("cancel")}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-1.5 h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {t("save")}
            </button>
          </div>
        </form>
      )}

      {/* 分享链接列表 */}
      {loading ? (
        <div className="py-[var(--space-10)] text-center text-[var(--muted)]">
          <Loader2 size={20} className="inline animate-spin mr-2" />
          {t("loadFailed")}
        </div>
      ) : shareLinks.length === 0 ? (
        <div className="py-[var(--space-10)] text-center text-[var(--muted)]">
          <Link2 size={36} className="mx-auto mb-3 opacity-50" />
          <p>{t("noShareLinks")}</p>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--border-soft)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
          {shareLinks.map((link) => {
            const expired = isExpired(link.expiresAt);
            return (
              <li
                key={link.id}
                className="px-[var(--space-4)] py-3 hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
              >
                {/* 第一行：权限级别 + 操作按钮 */}
                <div className="flex items-center gap-2">
                  <PermissionIcon level={link.permission} />
                  <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
                    {t(link.permission)}
                  </span>

                  {/* 密码保护标识 */}
                  {link.passwordProtected && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] text-[var(--meta)] bg-[var(--surface-2)]">
                      <Lock size={12} />
                    </span>
                  )}

                  {/* 过期标识 */}
                  {expired && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] text-[var(--danger)] bg-[var(--danger-soft, var(--surface-2))]">
                      <Clock size={12} />
                    </span>
                  )}

                  <div className="flex-1" />

                  {/* 复制链接按钮 */}
                  <button
                    onClick={() => copyShareLink(link)}
                    className="inline-flex items-center gap-1 h-7 px-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-xs)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
                    aria-label={t("copyLink")}
                  >
                    {copiedId === link.id ? (
                      <Check size={14} className="text-[var(--success)]" />
                    ) : (
                      <Copy size={14} />
                    )}
                    {t("copyLink")}
                  </button>

                  {/* 撤销按钮 */}
                  <button
                    onClick={() => revokeShareLink(link)}
                    className="inline-flex items-center gap-1 h-7 px-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-xs)] text-[var(--danger)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
                    aria-label={t("actionRevoke")}
                  >
                    <Trash2 size={14} />
                    {t("actionRevoke")}
                  </button>
                </div>

                {/* 第二行：权限开关徽章 */}
                <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                  <PermissionBadge
                    enabled={link.allowDownload}
                    icon={Download}
                    label={t("allowDownload")}
                  />
                  <PermissionBadge
                    enabled={link.allowPrint}
                    icon={Printer}
                    label={t("allowPrint")}
                  />
                  <PermissionBadge
                    enabled={link.allowCopy}
                    icon={CopyIcon}
                    label={t("allowCopy")}
                  />
                </div>

                {/* 第三行：过期时间 + 访问次数 */}
                <div className="mt-1.5 flex items-center gap-3 text-[length:var(--text-xs)] text-[var(--meta)]">
                  {link.expiresAt ? (
                    <span>
                      {t("linkExpires")}: {formatDateTime(link.expiresAt)}
                    </span>
                  ) : (
                    <span>{t("noExpiry")}</span>
                  )}
                  {link.maxViews !== null && (
                    <span>
                      {t("maxViews")}: {link.viewCount}/{link.maxViews}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default ShareDialogEnhanced;
