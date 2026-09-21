"use client";

/**
 * 文件夹/空间权限管理面板组件。
 *
 * 功能：
 * - 权限列表显示（授权对象、权限级别、可继承标记、授权人）
 * - 添加权限（选择授权对象类型、授权对象 ID、权限级别、可继承）
 * - 删除权限
 *
 * API：
 * - GET    /api/v1/workspaces/${workspaceId}/folders/${folderId}/permissions
 * - GET    /api/v1/workspaces/${workspaceId}/spaces/${spaceId}/permissions
 * - POST   /api/v1/workspaces/${workspaceId}/folders/${folderId}/permissions
 * - POST   /api/v1/workspaces/${workspaceId}/spaces/${spaceId}/permissions
 * - DELETE /api/v1/workspaces/${workspaceId}/folders/${folderId}/permissions/${permissionId}
 * - DELETE /api/v1/workspaces/${workspaceId}/spaces/${spaceId}/permissions/${permissionId}
 */

import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import {
  Loader2,
  Trash2,
  Plus,
  Shield,
  X,
  ChevronDown,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";

/** 权限级别 */
type PermissionLevel = "view" | "comment" | "edit" | "manage";

/** 授权对象类型 */
type GranteeType = "user" | "role";

/** 权限来源 */
type PermissionSource = "explicit" | "inherited" | "author" | "module";

/** 权限记录 */
interface PermissionItem {
  id: string;
  granteeType: GranteeType;
  granteeId: string;
  granteeName?: string;
  permissionLevel: PermissionLevel;
  inheritable: boolean;
  source: PermissionSource;
  inheritedFrom?: string;
  grantedBy?: string;
  grantedByName?: string;
  createdAt: string;
}

/** 权限列表响应 */
interface PermissionListResponse {
  items: PermissionItem[];
  total: number;
}

interface FolderPermissionPanelProps {
  workspaceId: string;
  targetType: "folder" | "space";
  targetId: string;
  onClose?: () => void;
}

const fieldLabel =
  "flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--meta)] mb-1.5";
const fieldControl =
  "w-full h-9 px-2.5 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]";

/** 权限级别选项 */
const PERMISSION_LEVELS: PermissionLevel[] = ["view", "comment", "edit", "manage"];

/** 授权对象类型选项 */
const GRANTEE_TYPES: GranteeType[] = ["user", "role"];

/** 根据 targetType 构建权限 API 基础路径 */
function buildBasePath(workspaceId: string, targetType: "folder" | "space", targetId: string): string {
  if (targetType === "folder") {
    return `/api/v1/workspaces/${workspaceId}/folders/${targetId}/permissions`;
  }
  return `/api/v1/workspaces/${workspaceId}/spaces/${targetId}/permissions`;
}

/** 权限级别徽章颜色映射 */
function getLevelBadgeClass(level: PermissionLevel): string {
  switch (level) {
    case "view":
      return "text-[var(--info)] bg-[var(--info-soft, var(--surface-2))]";
    case "comment":
      return "text-[var(--accent)] bg-[var(--accent-soft, var(--surface-2))]";
    case "edit":
      return "text-[var(--warning)] bg-[var(--warning-soft, var(--surface-2))]";
    case "manage":
      return "text-[var(--danger)] bg-[var(--danger-soft, var(--surface-2))]";
    default:
      return "text-[var(--muted)] bg-[var(--surface-2)]";
  }
}

export function FolderPermissionPanel({
  workspaceId,
  targetType,
  targetId,
  onClose,
}: FolderPermissionPanelProps) {
  const t = useTranslations("permissions");

  const [permissions, setPermissions] = useState<PermissionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 添加权限表单状态
  const [showForm, setShowForm] = useState(false);
  const [granteeType, setGranteeType] = useState<GranteeType>("user");
  const [granteeId, setGranteeId] = useState("");
  const [permissionLevel, setPermissionLevel] = useState<PermissionLevel>("view");
  const [inheritable, setInheritable] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const basePath = buildBasePath(workspaceId, targetType, targetId);

  async function loadPermissions() {
    setLoading(true);
    setError("");
    try {
      const data = await api<PermissionListResponse | PermissionItem[]>(basePath);
      const list = Array.isArray(data) ? data : (data.items ?? []);
      setPermissions(list);
    } catch (e) {
      setError(
        e instanceof ApiError || e instanceof Error
          ? e.message
          : t("loadFailed"),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPermissions();
  }, [basePath, t]);

  async function removePermission(permission: PermissionItem) {
    if (!window.confirm(t("confirmRemove"))) return;
    try {
      await api(`${basePath}/${permission.id}`, { method: "DELETE" });
      setPermissions((prev) => prev.filter((p) => p.id !== permission.id));
    } catch (e) {
      setError(
        e instanceof ApiError || e instanceof Error
          ? e.message
          : t("removePermission"),
      );
    }
  }

  async function submitPermission(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!granteeId.trim()) {
      setFormError(t("granteeId"));
      return;
    }
    setSubmitting(true);
    setFormError("");
    try {
      await api(basePath, {
        method: "POST",
        body: JSON.stringify({
          granteeType,
          granteeId: granteeId.trim(),
          permissionLevel,
          inheritable,
        }),
      });
      // 成功后刷新权限列表并关闭表单
      setShowForm(false);
      setGranteeId("");
      setPermissionLevel("view");
      setInheritable(false);
      loadPermissions();
    } catch (e) {
      setFormError(
        e instanceof ApiError || e instanceof Error
          ? e.message
          : t("save"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  const titleKey = targetType === "folder" ? "folderPermissions" : "spacePermissions";

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-[var(--space-4)] py-[var(--space-3)] border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <Shield size={16} className="text-[var(--accent)]" />
          <h2 className="text-[length:var(--text-base)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
            {t(titleKey)}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowForm((v) => !v)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-fast)]"
          >
            <Plus size={14} />
            {t("addPermission")}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="inline-flex items-center justify-center h-8 w-8 rounded-[var(--radius-md)] text-[var(--meta)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
              aria-label={t("close")}
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="px-[var(--space-4)] py-2 text-[length:var(--text-sm)] text-[var(--danger)] border-b border-[var(--border)]">
          {error}
        </div>
      )}

      {/* 添加权限表单 */}
      {showForm && (
        <form
          onSubmit={submitPermission}
          className="px-[var(--space-4)] py-[var(--space-3)] border-b border-[var(--border)] bg-[var(--surface-2)] space-y-3"
        >
          {/* 授权对象类型 */}
          <div>
            <label className={fieldLabel} htmlFor="grantee-type">
              {t("granteeType")}
            </label>
            <div className="relative">
              <select
                id="grantee-type"
                value={granteeType}
                onChange={(e) => setGranteeType(e.target.value as GranteeType)}
                className={`${fieldControl} appearance-none pr-8`}
              >
                {GRANTEE_TYPES.map((gt) => (
                  <option key={gt} value={gt}>
                    {t(gt)}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={14}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--meta)]"
              />
            </div>
          </div>

          {/* 授权对象 ID */}
          <div>
            <label className={fieldLabel} htmlFor="grantee-id">
              {t("granteeId")}
            </label>
            <input
              id="grantee-id"
              type="text"
              value={granteeId}
              onChange={(e) => setGranteeId(e.target.value)}
              placeholder={granteeType === "user" ? t("user") : t("role")}
              className={fieldControl}
              aria-required="true"
            />
          </div>

          {/* 权限级别 */}
          <div>
            <label className={fieldLabel} htmlFor="permission-level">
              {t("permissionLevel")}
            </label>
            <div className="relative">
              <select
                id="permission-level"
                value={permissionLevel}
                onChange={(e) => setPermissionLevel(e.target.value as PermissionLevel)}
                className={`${fieldControl} appearance-none pr-8`}
              >
                {PERMISSION_LEVELS.map((pl) => (
                  <option key={pl} value={pl}>
                    {t(pl)}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={14}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--meta)]"
              />
            </div>
          </div>

          {/* 可继承 */}
          <div className="flex items-center gap-2">
            <input
              id="inheritable"
              type="checkbox"
              checked={inheritable}
              onChange={(e) => setInheritable(e.target.checked)}
              className="h-4 w-4 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] accent-[var(--accent)]"
            />
            <label
              htmlFor="inheritable"
              className="text-[length:var(--text-sm)] text-[var(--fg)] cursor-pointer"
            >
              {t("inheritable")}
            </label>
          </div>

          {/* 表单错误 */}
          {formError && (
            <div className="px-3 py-2 rounded-[var(--radius-md)] bg-[var(--danger-soft, var(--surface-2))] text-[var(--danger-fg, var(--danger))] text-[length:var(--text-sm)]">
              {formError}
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setFormError("");
              }}
              className="h-8 px-4 rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            >
              {t("cancel")}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-1.5 h-8 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {t("save")}
            </button>
          </div>
        </form>
      )}

      {/* 权限列表 */}
      {loading ? (
        <div className="py-[var(--space-8)] text-center text-[var(--muted)]">
          <Loader2 size={20} className="inline animate-spin mr-2" />
          {t("loadFailed")}
        </div>
      ) : permissions.length === 0 ? (
        <div className="py-[var(--space-8)] text-center text-[var(--muted)]">
          <Shield size={36} className="mx-auto mb-3 opacity-50" />
          <p className="text-[length:var(--text-sm)]">{t("noPermissions")}</p>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--border-soft)]">
          {permissions.map((permission) => (
            <li
              key={permission.id}
              className="px-[var(--space-4)] py-[var(--space-3)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
            >
              <div className="flex items-center gap-2">
                {/* 授权对象名称 */}
                <span className="flex-1 min-w-0 text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)] truncate">
                  {permission.granteeName || permission.granteeId}
                </span>

                {/* 授权对象类型标记 */}
                <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--meta)] bg-[var(--surface-2)]">
                  {t(permission.granteeType)}
                </span>

                {/* 权限级别徽章 */}
                <span
                  className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] ${getLevelBadgeClass(permission.permissionLevel)}`}
                >
                  {t(permission.permissionLevel)}
                </span>

                {/* 可继承标记 */}
                {permission.inheritable && (
                  <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--accent)] bg-[var(--accent-soft, var(--surface-2))]">
                    {t("inheritable")}
                  </span>
                )}

                {/* 继承来源标记 */}
                {permission.source === "inherited" && permission.inheritedFrom && (
                  <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--info)] bg-[var(--info-soft, var(--surface-2))]">
                    {t("inheritedFrom")}: {permission.inheritedFrom}
                  </span>
                )}

                {/* 删除按钮（仅显式授权可删除） */}
                {permission.source === "explicit" && (
                  <button
                    onClick={() => removePermission(permission)}
                    className="shrink-0 inline-flex items-center justify-center h-7 w-7 rounded-[var(--radius-sm)] text-[var(--danger)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
                    aria-label={t("removePermission")}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>

              {/* 授权人信息 */}
              {permission.grantedByName && (
                <div className="mt-1.5 text-[length:var(--text-xs)] text-[var(--meta)]">
                  {t("grantedBy")}: {permission.grantedByName}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default FolderPermissionPanel;