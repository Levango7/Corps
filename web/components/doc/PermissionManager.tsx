"use client";

/**
 * 文档权限管理面板（阶段 6 · 任务 222）
 *
 * 可嵌入到文档详情页。功能：
 *  - 显示当前文档可见性（private / workspace / shared）
 *  - 权限列表表格（用户/角色 | 权限级别 | 操作）
 *  - 添加权限表单（搜索工作区成员 + 选择权限级别）
 *
 * 数据流：
 *  - GET  /v1/workspaces/{wid}/documents/{did}/permissions  拉权限列表
 *  - POST /v1/workspaces/{wid}/documents/{did}/permissions  新增权限
 *  - PATCH /v1/workspaces/{wid}/documents/{did}/permissions/{pid}  更新权限
 *  - DELETE /v1/workspaces/{wid}/documents/{did}/permissions/{pid}  移除权限
 *  - GET  /v1/workspaces/{wid}/members  拉工作区成员（用于添加权限下拉）
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Loader2,
  Plus,
  Trash2,
  Shield,
  User,
  Users,
  AlertCircle,
} from "lucide-react";
import { api } from "@/lib/api";

/** 权限级别 */
type PermissionLevel = "view" | "edit" | "manage";

/** DocumentPermission 记录（与 API 返回对齐） */
interface DocPermission {
  id: string;
  documentId: string;
  workspaceId: string;
  granteeType: "user" | "role";
  granteeId: string;
  permission: PermissionLevel;
  grantedBy: string | null;
  createdAt: string;
  granter: { id: string; name: string | null; email: string } | null;
}

/** 工作区成员（用于添加权限下拉） */
interface Member {
  id: string;
  name: string | null;
  email: string;
  role: string;
}

const PERMISSION_OPTIONS: PermissionLevel[] = ["view", "edit", "manage"];

/** 权限级别 → i18n key */
function permKey(level: PermissionLevel): string {
  return level === "view"
    ? "permissionView"
    : level === "edit"
      ? "permissionEdit"
      : "permissionManage";
}

/** 授权对象显示名 */
function granteeLabel(
  perm: DocPermission,
  members: Member[],
  _t: (k: string) => string,
): string {
  if (perm.granteeType === "role") {
    return perm.granteeId;
  }
  const m = members.find((x) => x.id === perm.granteeId);
  return m?.name || m?.email || perm.granteeId;
}

export function PermissionManager({
  docId,
  workspaceId,
}: {
  docId: string;
  workspaceId: string;
}) {
  const t = useTranslations("doc");
  const [permissions, setPermissions] = useState<DocPermission[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // 添加权限表单
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedPerm, setSelectedPerm] = useState<PermissionLevel>("view");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [permData, memberData] = await Promise.all([
        api<{ items: DocPermission[] }>(
          `/api/v1/workspaces/${workspaceId}/documents/${docId}/permissions`,
        ).catch(() => ({ items: [] as DocPermission[] })),
        api<Member[]>(`/api/v1/workspaces/${workspaceId}/members`).catch(
          () => [] as Member[],
        ),
      ]);
      setPermissions(permData.items);
      setMembers(memberData);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [workspaceId, docId, t]);

  useEffect(() => {
    load();
  }, [load]);

  async function addPermission() {
    if (!selectedUserId || busy) return;
    setBusy(true);
    setError("");
    try {
      const created = await api<DocPermission>(
        `/api/v1/workspaces/${workspaceId}/documents/${docId}/permissions`,
        {
          method: "POST",
          body: JSON.stringify({
            granteeType: "user",
            granteeId: selectedUserId,
            permission: selectedPerm,
          }),
        },
      );
      setPermissions((prev) => [...prev, created]);
      setSelectedUserId("");
      setSelectedPerm("view");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("addFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function updatePermission(pid: string, level: PermissionLevel) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const updated = await api<DocPermission>(
        `/api/v1/workspaces/${workspaceId}/documents/${docId}/permissions/${pid}`,
        {
          method: "PATCH",
          body: JSON.stringify({ permission: level }),
        },
      );
      setPermissions((prev) =>
        prev.map((p) => (p.id === pid ? updated : p)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : t("updateFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function removePermission(pid: string) {
    if (busy) return;
    if (!window.confirm(t("removeConfirm"))) return;
    setBusy(true);
    setError("");
    try {
      await api(
        `/api/v1/workspaces/${workspaceId}/documents/${docId}/permissions/${pid}`,
        { method: "DELETE" },
      );
      setPermissions((prev) => prev.filter((p) => p.id !== pid));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("removeFailed"));
    } finally {
      setBusy(false);
    }
  }

  // 已被授权的成员 ID 集合（用于下拉过滤）
  const grantedUserIds = new Set(
    permissions.filter((p) => p.granteeType === "user").map((p) => p.granteeId),
  );
  const availableMembers = members.filter((m) => !grantedUserIds.has(m.id));

  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
      <header className="flex items-center gap-2 px-[var(--space-4)] py-3 border-b border-[var(--border-soft)]">
        <Shield size={15} className="text-[var(--muted)]" />
        <h3 className="text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
          {t("permissionManagerTitle")}
        </h3>
      </header>

      <div className="px-[var(--space-4)] py-[var(--space-3)]">
        {error && (
          <div className="flex items-center gap-2 mb-[var(--space-3)] px-[var(--space-3)] py-2 rounded-[var(--radius-sm)] bg-[var(--danger-soft)] text-[var(--danger)] text-[length:var(--text-xs)]">
            <AlertCircle size={14} className="shrink-0" />
            <span className="flex-1">{error}</span>
          </div>
        )}

        {/* 权限列表表格 */}
        {loading ? (
          <div className="py-[var(--space-6)] text-center text-[var(--muted)] text-[length:var(--text-sm)]">
            <Loader2 size={16} className="inline animate-spin mr-2" />
            {t("loading")}
          </div>
        ) : permissions.length === 0 ? (
          <div className="py-[var(--space-6)] text-center text-[var(--muted)] text-[length:var(--text-sm)]">
            {t("noMembers")}
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border-soft)] rounded-[var(--radius-sm)] border border-[var(--border-soft)]">
            {permissions.map((perm) => (
              <li
                key={perm.id}
                className="flex items-center gap-[var(--space-3)] px-[var(--space-3)] py-2.5"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {perm.granteeType === "role" ? (
                    <Users size={14} className="shrink-0 text-[var(--muted)]" />
                  ) : (
                    <User size={14} className="shrink-0 text-[var(--muted)]" />
                  )}
                  <span className="text-[length:var(--text-sm)] text-[var(--fg)] truncate">
                    {granteeLabel(perm, members, t)}
                  </span>
                </div>
                <select
                  value={perm.permission}
                  onChange={(e) =>
                    updatePermission(perm.id, e.target.value as PermissionLevel)
                  }
                  disabled={busy}
                  className="h-7 px-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-xs)] text-[var(--fg-2)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:opacity-50"
                >
                  {PERMISSION_OPTIONS.map((level) => (
                    <option key={level} value={level}>
                      {t(permKey(level))}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => removePermission(perm.id)}
                  disabled={busy}
                  className="w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:text-[var(--danger)] hover:bg-[var(--danger-soft)] transition-colors duration-[var(--motion-fast)] disabled:opacity-50"
                  aria-label={t("removePermission")}
                  title={t("removePermission")}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* 添加权限表单 */}
        <div className="mt-[var(--space-3)] flex items-center gap-2">
          <select
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
            disabled={busy || availableMembers.length === 0}
            className="flex-1 h-8 px-2.5 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:opacity-50"
          >
            <option value="">{t("searchUser")}</option>
            {availableMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name || m.email}
              </option>
            ))}
          </select>
          <select
            value={selectedPerm}
            onChange={(e) =>
              setSelectedPerm(e.target.value as PermissionLevel)
            }
            disabled={busy}
            className="h-8 px-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg-2)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:opacity-50"
          >
            {PERMISSION_OPTIONS.map((level) => (
              <option key={level} value={level}>
                {t(permKey(level))}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={addPermission}
            disabled={!selectedUserId || busy}
            className="inline-flex items-center gap-1 h-8 px-3 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)]"
          >
            {busy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Plus size={14} />
            )}
            {t("addPermission")}
          </button>
        </div>
      </div>
    </section>
  );
}