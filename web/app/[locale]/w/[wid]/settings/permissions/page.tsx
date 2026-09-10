"use client";

/**
 * 权限矩阵 · /w/[wid]/settings/permissions
 *
 * 4 行（owner/admin/member/viewer）× 8 列（modules）的权限矩阵，
 * 每格 4 个勾选框（R/C/U/D）。
 *
 * 规则：
 *  - Owner 行灰色锁定不可改（拥有全部权限）
 *  - Admin 行可改 Member 和 Viewer 列的权限覆盖
 *  - 保存调用 PATCH /api/v1/workspaces/{wid}/permissions
 *  - 加载调用 GET /api/v1/workspaces/{wid}/permissions
 *
 * UI 走 design token + Tailwind，与 settings/page.tsx 风格一致。
 */

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { Lock, Save, Loader2, AlertTriangle, Check, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useToast } from "@/components/Toast";
import type { Role } from "@/lib/types";

// ─── 类型定义 ───────────────────────────────────────────────

/** 模块 key：与后端权限矩阵列一致 */
type ModuleKey =
  | "tasks"
  | "decisions"
  | "documents"
  | "messages"
  | "members"
  | "billing"
  | "analytics"
  | "settings";

/** 操作 key：R/C/U/D */
type ActionKey = "read" | "create" | "update" | "delete";

/** 单格权限：4 个布尔值 */
type PermissionCell = Record<ActionKey, boolean>;

/** 权限矩阵：matrix[role][module] = PermissionCell */
type PermissionMatrix = Record<Role, Record<ModuleKey, PermissionCell>>;

// ─── 常量 ───────────────────────────────────────────────────

const MODULES: ModuleKey[] = [
  "tasks",
  "decisions",
  "documents",
  "messages",
  "members",
  "billing",
  "analytics",
  "settings",
];

const ACTIONS: ActionKey[] = ["read", "create", "update", "delete"];

const ROLES: Role[] = ["owner", "admin", "member", "viewer"];

/** Owner 默认拥有全部权限 */
const FULL_CELL: PermissionCell = { read: true, create: true, update: true, delete: true };

/** Viewer 默认仅读 */
const READ_ONLY_CELL: PermissionCell = { read: true, create: false, update: false, delete: false };

/** 生成默认权限矩阵（首次加载/重置时使用） */
function defaultMatrix(): PermissionMatrix {
  const makeRoleRow = (cell: PermissionCell): Record<ModuleKey, PermissionCell> =>
    MODULES.reduce(
      (acc, m) => {
        acc[m] = { ...cell };
        return acc;
      },
      {} as Record<ModuleKey, PermissionCell>,
    );

  return {
    owner: makeRoleRow(FULL_CELL),
    admin: makeRoleRow(FULL_CELL),
    member: {
      ...makeRoleRow({ read: true, create: true, update: true, delete: false }),
      // member 对 members/billing/analytics/settings 仅读
      members: { ...READ_ONLY_CELL },
      billing: { ...READ_ONLY_CELL },
      analytics: { ...READ_ONLY_CELL },
      settings: { ...READ_ONLY_CELL },
    },
    viewer: makeRoleRow(READ_ONLY_CELL),
  };
}

/** 深拷贝矩阵（避免引用共享导致状态错乱） */
function cloneMatrix(m: PermissionMatrix): PermissionMatrix {
  const out = {} as PermissionMatrix;
  for (const r of ROLES) {
    out[r] = {} as Record<ModuleKey, PermissionCell>;
    for (const mod of MODULES) {
      out[r][mod] = { ...m[r][mod] };
    }
  }
  return out;
}

/** 矩阵相等比较（用于判断 dirty） */
function matrixEqual(a: PermissionMatrix, b: PermissionMatrix): boolean {
  for (const r of ROLES) {
    for (const mod of MODULES) {
      for (const act of ACTIONS) {
        if (a[r][mod][act] !== b[r][mod][act]) return false;
      }
    }
  }
  return true;
}

// ─── 页面组件 ───────────────────────────────────────────────

export default function PermissionsPage({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = use(params);
  const t = useTranslations("permissions");
  const tRole = useTranslations("role");
  const { toast } = useToast();

  const [matrix, setMatrix] = useState<PermissionMatrix>(() => defaultMatrix());
  const [originalMatrix, setOriginalMatrix] = useState<PermissionMatrix>(() => defaultMatrix());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  // 当前用户角色（用于判断是否可编辑）
  const [currentRole, setCurrentRole] = useState<Role | null>(null);

  const load = useCallback(async () => {
    try {
      const [perm, ws] = await Promise.all([
        api<PermissionMatrix | null>(`/api/v1/workspaces/${wid}/permissions`).catch(() => null),
        api<{ role: Role }>(`/api/v1/workspaces/${wid}`),
      ]);
      // 后端可能返回 null（未配置过），用默认矩阵兜底
      const next = perm ?? defaultMatrix();
      setMatrix(next);
      setOriginalMatrix(cloneMatrix(next));
      setCurrentRole(ws.role);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadFailed"));
    }
  }, [wid, t]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  // 是否可编辑：仅 owner/admin 可改权限矩阵
  const canEdit = currentRole ? currentRole === "owner" || currentRole === "admin" : false;

  // dirty 判断
  const dirty = useMemo(() => !matrixEqual(matrix, originalMatrix), [matrix, originalMatrix]);

  /** 切换单个权限格 */
  function toggle(role: Role, mod: ModuleKey, act: ActionKey) {
    if (!canEdit) return;
    // Owner 行锁定
    if (role === "owner") return;
    // Admin 仅可改 member 和 viewer 列（不能改自己 admin 列，也不能改 owner 列）
    if (currentRole === "admin" && role !== "member" && role !== "viewer") return;

    setMatrix((prev) => {
      const next = cloneMatrix(prev);
      next[role][mod][act] = !next[role][mod][act];
      return next;
    });
  }

  /** 保存权限矩阵 */
  async function save() {
    if (saving || !dirty) return;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      await api(`/api/v1/workspaces/${wid}/permissions`, {
        method: "PATCH",
        body: JSON.stringify(matrix),
      });
      setOriginalMatrix(cloneMatrix(matrix));
      setSaved(true);
      toast("success", t("saveSuccess"));
      setTimeout(() => setSaved(false), 2400);
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("saveFailed");
      setError(msg);
      toast("error", msg);
    } finally {
      setSaving(false);
    }
  }

  /** 重置为默认权限 */
  function resetToDefault() {
    const def = defaultMatrix();
    setMatrix(def);
    setOriginalMatrix(cloneMatrix(def));
    toast("info", t("resetSuccess"));
  }

  // ─── 渲染 ─────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="max-w-[var(--container-max)] mx-auto flex items-center justify-center py-[var(--space-16)]">
        <Loader2 size={24} className="animate-spin text-[var(--muted)]" />
      </div>
    );
  }

  const sectionClass =
    "bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] p-4 sm:p-5";

  return (
    <div className="max-w-[var(--container-max)] mx-auto">
      {/* 标题 */}
      <div className="mb-6">
        <h1 className="text-[length:var(--text-2xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
          {t("title")}
        </h1>
        <p className="mt-1 text-[length:var(--text-sm)] text-[var(--muted)]">{t("subtitle")}</p>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mb-4 flex items-start gap-2 px-4 py-3 rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-sm)]">
          <AlertTriangle size={16} className="shrink-0 mt-0.5 text-[var(--danger)]" />
          <span>{error}</span>
        </div>
      )}

      {/* 无权限提示 */}
      {!canEdit && !loading && (
        <div className="mb-4 flex items-start gap-2 px-4 py-3 rounded-[var(--radius-md)] bg-[var(--surface-2)] text-[var(--fg-2)] text-[length:var(--text-sm)] border border-[var(--border)]">
          <Lock size={16} className="shrink-0 mt-0.5 text-[var(--muted)]" />
          <span>{t("ownerLocked")}</span>
        </div>
      )}

      {/* 权限矩阵表格 */}
      <section className={sectionClass}>
        {/* 说明 */}
        <div className="mb-4 space-y-1">
          <p className="flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--meta)]">
            <Lock size={12} className="text-[var(--muted)]" />
            {t("ownerLocked")}
          </p>
          <p className="text-[length:var(--text-xs)] text-[var(--meta)]">{t("adminCanOverride")}</p>
        </div>

        {/* 表格：水平滚动容器，避免在窄屏溢出 */}
        <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
          <table className="w-full border-collapse text-[length:var(--text-sm)]">
            <thead>
              <tr>
                {/* 角色列头 */}
                <th
                  scope="col"
                  className="sticky left-0 z-[2] bg-[var(--surface)] text-left p-2 border-b border-[var(--border)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--meta)] uppercase tracking-[var(--tracking-tight)]"
                >
                  {tRole("member")}
                </th>
                {/* 每个模块一列，列头显示模块名 */}
                {MODULES.map((mod) => (
                  <th
                    key={mod}
                    scope="col"
                    className="p-2 border-b border-[var(--border)] text-center text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] whitespace-nowrap min-w-[120px]"
                  >
                    {t(`module.${mod}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROLES.map((role) => {
                const isOwner = role === "owner";
                // Admin 仅可改 member/viewer 行
                const rowEditable =
                  canEdit &&
                  !isOwner &&
                  (currentRole === "owner" || (currentRole === "admin" && (role === "member" || role === "viewer")));
                const rowLocked = isOwner || !rowEditable;

                return (
                  <tr key={role} className="border-b border-[var(--border-soft)] last:border-b-0">
                    {/* 角色名 + 锁定图标 */}
                    <th
                      scope="row"
                      className={`sticky left-0 z-[2] bg-[var(--surface)] text-left p-2 text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] whitespace-nowrap ${
                        isOwner ? "text-[var(--meta)]" : "text-[var(--fg)]"
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        {isOwner && <Lock size={12} className="text-[var(--muted)]" />}
                        {tRole(role)}
                      </span>
                    </th>
                    {/* 每个模块的权限格 */}
                    {MODULES.map((mod) => (
                      <td key={mod} className="p-2 text-center">
                        <div className="inline-flex items-center gap-1.5 justify-center">
                          {ACTIONS.map((act) => {
                            const checked = matrix[role][mod][act];
                            const disabled = rowLocked;
                            return (
                              <label
                                key={act}
                                className={`inline-flex items-center gap-0.5 ${
                                  disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                                }`}
                                title={t(`action.${act}Label`)}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={disabled}
                                  onChange={() => toggle(role, mod, act)}
                                  className="h-3.5 w-3.5 rounded-[var(--radius-sm)] border border-[var(--border)] accent-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-1"
                                />
                                <span className="text-[length:var(--text-xs)] text-[var(--meta)] font-[family-name:var(--font-mono)]">
                                  {t(`action.${act}`)}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 操作按钮区 */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mt-5 pt-4 border-t border-[var(--border-soft)]">
          <button
            onClick={save}
            disabled={!canEdit || !dirty || saving}
            className="w-full sm:w-auto h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {saving ? t("saving") : t("save")}
          </button>

          {canEdit && (
            <button
              onClick={resetToDefault}
              disabled={saving}
              className="w-full sm:w-auto h-9 px-4 border border-[var(--border)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
            >
              <RotateCcw size={15} />
              {t("reset")}
            </button>
          )}

          {!dirty && !saving && !saved && (
            <span className="text-[length:var(--text-xs)] text-[var(--meta)]">{/* 无变更占位 */}</span>
          )}

          {saved && (
            <span className="flex items-center gap-1.5 text-[length:var(--text-sm)] text-[var(--success-fg)]">
              <Check size={15} className="text-[var(--success)]" />
              {t("saveSuccess")}
            </span>
          )}
        </div>
      </section>
    </div>
  );
}