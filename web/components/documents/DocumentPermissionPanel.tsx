"use client";

/**
 * 文档权限管理面板组件。
 *
 * 功能：
 * - 权限列表展示（授权对象、权限级别、来源标记、授权人、过期时间）
 * - 添加权限（选择授权对象类型/ID + 权限级别）
 * - 删除权限
 *
 * API：
 * - GET    /api/v1/workspaces/${workspaceId}/documents/${documentId}/permissions
 * - POST   /api/v1/workspaces/${workspaceId}/documents/${documentId}/permissions
 * - DELETE /api/v1/workspaces/${workspaceId}/documents/${documentId}/permissions/${permissionId}
 *
 * 来源标记：explicit（显式授权）/ inherited（继承）/ author（作者）/ module（模块）
 */

import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import {
  Loader2,
  Trash2,
  Plus,
  ShieldCheck,
  ShieldAlert,
  Shield,
  Crown,
  Layers,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";

/** 权限级别 */
type PermissionLevel = "view" | "comment" | "edit" | "manage";

/** 来源类型 */
type PermissionSource = "explicit" | "inherited" | "author" | "module";

/** 授权对象类型 */
type GranteeType = "user" | "role";

/** 文档权限条目 */
interface DocumentPermission {
  id: string;
  granteeType: GranteeType;
  granteeId: string;
  granteeName: string;
  permissionLevel: PermissionLevel;
  source: PermissionSource;
  grantedBy?: string;
  grantedByName?: string;
  expiresAt?: string | null;
  createdAt: string;
}

/** 权限列表响应 */
interface PermissionListResponse {
  items: DocumentPermission[];
  total: number;
}

/** 工作区成员 */
interface Member {
  id: string;
  name: string | null;
  email: string;
}

/** 工作区角色 */
interface Role {
  id: string;
  name: string;
}

interface DocumentPermissionPanelProps {
  workspaceId: string;
  documentId: string;
}

// 样式常量
const fieldLabel =
  "flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--meta)] mb-1.5";
const fieldControl =
  "w-full h-9 px-2.5 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]";

/** 来源标记配置：图标 + 颜色 token */
const sourceConfig: Record<PermissionSource, { icon: typeof Shield; color: string; bg: string }> = {
  explicit: {
    icon: ShieldCheck,
    color: "var(--accent)",
    bg: "var(--accent-soft)",
  },
  inherited: {
    icon: Layers,
    color: "var(--muted)",
    bg: "var(--surface-2)",
  },
  author: {
    icon: Crown,
    color: "var(--warn)",
    bg: "var(--warn-soft)",
  },
  module: {
    icon: Shield,
    color: "var(--success)",
    bg: "var(--success-soft)",
  },
};

/** 权限级别颜色配置 */
const levelColor: Record<PermissionLevel, string> = {
  view: "var(--muted)",
  comment: "var(--accent)",
  edit: "var(--warn)",
  manage: "var(--danger)",
};

/** 格式化过期时间 */
function formatExpiry(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function DocumentPermissionPanel({ workspaceId, documentId }: DocumentPermissionPanelProps) {
  const t = useTranslations("permissions");

  const [permissions, setPermissions] = useState<DocumentPermission[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 添加权限表单状态
  const [showForm, setShowForm] = useState(false);
  const [granteeType, setGranteeType] = useState<GranteeType>("user");
  const [granteeId, setGranteeId] = useState("");
  const [permissionLevel, setPermissionLevel] = useState<PermissionLevel>("view");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  async function loadPermissions() {
    setLoading(true);
    setError("");
    try {
      const data = await api<PermissionListResponse>(
        `/api/v1/workspaces/${workspaceId}/documents/${documentId}/permissions`,
      );
      setPermissions(data.items ?? []);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : t("noPermissions"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPermissions();
    // 拉取成员列表用于授权对象选择
    api<Member[] | { items: Member[] }>(`/api/v1/workspaces/${workspaceId}/members`)
      .then((data) => {
        const list = Array.isArray(data) ? data : (data.items ?? []);
        setMembers(list);
      })
      .catch(() => {
        // 成员列表加载失败不阻塞权限管理
      });
    // 拉取角色列表用于授权对象选择
    api<Role[] | { items: Role[] }>(`/api/v1/workspaces/${workspaceId}/roles`)
      .then((data) => {
        const list = Array.isArray(data) ? data : (data.items ?? []);
        setRoles(list);
      })
      .catch(() => {
        // 角色列表加载失败不阻塞权限管理
      });
  }, [workspaceId, documentId, t]);

  async function removePermission(permission: DocumentPermission) {
    if (!window.confirm(t("confirmRemove"))) return;
    try {
      await api(
        `/api/v1/workspaces/${workspaceId}/documents/${documentId}/permissions/${permission.id}`,
        { method: "DELETE" },
      );
      setPermissions((prev) => prev.filter((p) => p.id !== permission.id));
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : t("confirmRemove"));
    }
  }

  async function submitPermission(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!granteeId) {
      setFormError(t("granteeId"));
      return;
    }
    setSubmitting(true);
    setFormError("");
    try {
      await api(`/api/v1/workspaces/${workspaceId}/documents/${documentId}/permissions`, {
        method: "POST",
        body: JSON.stringify({
          granteeType,
          granteeId,
          permissionLevel,
        }),
      });
      // 成功后刷新列表并关闭表单
      setShowForm(false);
      setGranteeId("");
      setPermissionLevel("view");
      loadPermissions();
    } catch (e) {
      setFormError(e instanceof ApiError || e instanceof Error ? e.message : t("save"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-[var(--space-4)]">
      {/* 标题栏 + 添加按钮 */}
      <div className="flex items-center justify-between">
        <h2 className="text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tracking-[var(--tracking-tight)]">
          {t("title")}
        </h2>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-fast)]"
        >
          <Plus size={14} />
          {t("addPermission")}
        </button>
      </div>

      {error && <p className="text-[length:var(--text-sm)] text-[var(--danger)]">{error}</p>}

      {/* 添加权限表单 */}
      {showForm && (
        <form
          onSubmit={submitPermission}
          className="p-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] space-y-4"
        >
          {/* 授权对象类型 */}
          <div>
            <label className={fieldLabel} htmlFor="grantee-type">
              {t("granteeType")}
            </label>
            <select
              id="grantee-type"
              value={granteeType}
              onChange={(e) => {
                setGranteeType(e.target.value as GranteeType);
                setGranteeId("");
              }}
              className={fieldControl}
            >
              <option value="user">{t("user")}</option>
              <option value="role">{t("role")}</option>
            </select>
          </div>

          {/* 授权对象选择 */}
          <div>
            <label className={fieldLabel} htmlFor="grantee-id">
              {t("granteeId")}
            </label>
            <select
              id="grantee-id"
              value={granteeId}
              onChange={(e) => setGranteeId(e.target.value)}
              className={fieldControl}
              aria-required="true"
            >
              <option value="">{granteeType === "user" ? t("user") : t("role")}</option>
              {granteeType === "user"
                ? members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name || m.email}
                    </option>
                  ))
                : roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
            </select>
          </div>

          {/* 权限级别 */}
          <div>
            <label className={fieldLabel} htmlFor="permission-level">
              {t("permissionLevel")}
            </label>
            <select
              id="permission-level"
              value={permissionLevel}
              onChange={(e) => setPermissionLevel(e.target.value as PermissionLevel)}
              className={fieldControl}
            >
              <option value="view">{t("view")}</option>
              <option value="comment">{t("comment")}</option>
              <option value="edit">{t("edit")}</option>
              <option value="manage">{t("manage")}</option>
            </select>
          </div>

          {formError && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger)] text-[length:var(--text-sm)]">
              <ShieldAlert size={14} className="shrink-0 mt-0.5" />
              <span className="flex-1">{formError}</span>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setFormError("");
                setGranteeId("");
                setPermissionLevel("view");
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

      {/* 权限列表 */}
      {loading ? (
        <div className="py-[var(--space-8)] text-center text-[var(--muted)]">
          <Loader2 size={20} className="inline animate-spin mr-2" />
          {t("title")}
        </div>
      ) : permissions.length === 0 ? (
        <div className="py-[var(--space-8)] text-center text-[var(--muted)]">
          <Shield size={36} className="mx-auto mb-3 opacity-50" />
          <p>{t("noPermissions")}</p>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--border-soft)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
          {permissions.map((perm) => {
            const sc = sourceConfig[perm.source];
            const SourceIcon = sc.icon;
            return (
              <li
                key={perm.id}
                className="px-[var(--space-4)] py-3 hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
              >
                <div className="flex items-center gap-2">
                  {/* 来源标记图标 */}
                  <SourceIcon size={16} className="shrink-0" style={{ color: sc.color }} />
                  {/* 授权对象名称 */}
                  <span className="flex-1 min-w-0 text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)] truncate">
                    {perm.granteeName}
                  </span>
                  {/* 来源标记 badge */}
                  <span
                    className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)]"
                    style={{ color: sc.color, backgroundColor: sc.bg }}
                  >
                    {perm.source === "explicit" && t("sourceExplicit")}
                    {perm.source === "inherited" && t("sourceInherited")}
                    {perm.source === "author" && t("sourceAuthor")}
                    {perm.source === "module" && t("sourceModule")}
                  </span>
                  {/* 权限级别 badge */}
                  <span
                    className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)]"
                    style={{ color: levelColor[perm.permissionLevel] }}
                  >
                    {perm.permissionLevel === "view" && t("view")}
                    {perm.permissionLevel === "comment" && t("comment")}
                    {perm.permissionLevel === "edit" && t("edit")}
                    {perm.permissionLevel === "manage" && t("manage")}
                  </span>
                  {/* 删除按钮（仅 explicit 来源可删除） */}
                  {perm.source === "explicit" && (
                    <button
                      onClick={() => removePermission(perm)}
                      className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[var(--danger)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                      aria-label={t("removePermission")}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                {/* 授权人 + 过期时间 */}
                <div className="mt-1.5 ml-6 flex items-center gap-3 text-[length:var(--text-xs)] text-[var(--meta)]">
                  {perm.grantedByName && (
                    <span>
                      {t("grantedBy")}: {perm.grantedByName}
                    </span>
                  )}
                  <span>
                    {t("expiresAt")}:{" "}
                    {perm.expiresAt ? formatExpiry(perm.expiresAt) : t("noExpiry")}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default DocumentPermissionPanel;
