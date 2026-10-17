"use client";

/**
 * 权限矩阵 · /w/[wid]/settings/permissions
 *
 * 4 行（owner/admin/member/viewer）× 8 列（modules）的权限矩阵，
 * 每格 4 个勾选框（R/C/U/D）。
 *
 * 规则：
 *  - Owner 行灰色锁定不可改（拥有全部权限）
 *  - 仅 member/viewer 行可写（服务端 PATCH 只接受这两个角色的覆盖，owner/admin
 *    会被 zod 400 拒绝），owner 与 admin 行均为只读展示
 *  - 保存调用 PATCH /api/v1/workspaces/{wid}/permissions（逐格、单格请求体）
 *  - 加载调用 GET /api/v1/workspaces/{wid}/permissions（响应经 toPermissionMatrix 适配）
 *
 * UI 走 design token + Tailwind，与 settings/page.tsx 风格一致。
 */

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { Lock, Save, Loader2, AlertTriangle, Check, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useToast } from "@/components/Toast";
import { Skeleton } from "@/components/Skeleton";
import type { Role } from "@/lib/types";
import {
  ACTIONS,
  MODULES,
  ROLES,
  cloneMatrix,
  defaultMatrix,
  isOverridable,
  matrixEqual,
  toPermissionMatrix,
  toPermissionPatches,
  type ActionKey,
  type ModuleKey,
  type PermissionMatrix,
} from "@/lib/permissions-matrix";

/**
 * 权限页 Skeleton · 与正式页面布局尺寸对齐
 *
 * 结构：
 *  1. 页头：标题 + 副标题
 *  2. section 容器：说明行 + 表格（4 行 × 9 列）
 *
 * 表格每行：角色名占位（sticky 左列）+ 8 个模块格占位（每格 4 个小方块模拟 R/C/U/D）
 * 与正式表格的 4 行 × 8 列结构一致，避免加载完成时布局跳动。
 */
function PermissionsPageSkeleton() {
  const sectionClass =
    "bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] p-4 sm:p-5";

  return (
    <div className="max-w-[var(--container-max)] mx-auto" aria-busy="true" aria-live="polite">
      {/* 页头 */}
      <div className="mb-6">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="mt-1 h-4 w-64" />
      </div>

      <section className={sectionClass}>
        {/* 说明行 */}
        <div className="mb-4 space-y-1">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>

        {/* 表格骨架：4 行 × 9 列 */}
        <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
          <div className="w-full border-collapse">
            {/* 表头 */}
            <div className="flex border-b border-[var(--border)]">
              <Skeleton className="shrink-0 w-20 h-6" />
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="flex-1 min-w-[120px] h-6" />
              ))}
            </div>
            {/* 4 行角色 */}
            {Array.from({ length: 4 }).map((_, rowIdx) => (
              <div
                key={rowIdx}
                className="flex items-center border-b border-[var(--border-soft)] last:border-b-0 py-2"
              >
                {/* 角色名占位 */}
                <Skeleton className="shrink-0 w-20 h-4" />
                {/* 8 个模块格，每格 4 个小方块模拟 R/C/U/D */}
                {Array.from({ length: 8 }).map((_, modIdx) => (
                  <div
                    key={modIdx}
                    className="flex-1 min-w-[120px] flex items-center justify-center gap-1.5"
                  >
                    {Array.from({ length: 4 }).map((_, actIdx) => (
                      <Skeleton key={actIdx} className="w-3.5 h-3.5 rounded-[var(--radius-sm)]" />
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* 操作按钮区 */}
        <div className="flex items-center gap-3 mt-5 pt-4 border-t border-[var(--border-soft)]">
          <Skeleton className="h-9 w-24 rounded-[var(--radius-md)]" />
          <Skeleton className="h-9 w-20 rounded-[var(--radius-md)]" />
        </div>
      </section>
    </div>
  );
}

// 矩阵类型、默认值、比较与两侧契约适配均位于 @/lib/permissions-matrix，
// 便于单测直接覆盖（页面内私有函数无法测试，见 tests/unit/permissions-matrix-adapter.test.ts）。

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
        // 响应体形状是 { roles: { [role]: { [module]: Action[] } }, ... }，
        // 必须经 toPermissionMatrix 解包 + 转布尔，不能当矩阵直接用。
        api<unknown>(`/api/v1/workspaces/${wid}/permissions`).catch(() => null),
        api<{ role: Role }>(`/api/v1/workspaces/${wid}`),
      ]);
      // 未配置过 / 响应缺项时由适配函数逐项回落默认矩阵，始终返回完整矩阵
      const next = toPermissionMatrix(perm);
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
    // 服务端只允许 member/viewer 的覆盖；owner/admin 行只读
    if (!isOverridable(role)) return;

    setMatrix((prev) => {
      const next = cloneMatrix(prev);
      next[role][mod][act] = !next[role][mod][act];
      return next;
    });
  }

  /** 保存权限矩阵 */
  async function save() {
    if (saving || !dirty) return;
    // 服务端 PATCH 的形状是单格 { role, module, actions }，不是整张矩阵；
    // 因此把矩阵差异拆成逐格补丁（仅 member/viewer）。
    const patches = toPermissionPatches(matrix, originalMatrix);
    if (patches.length === 0) return; // owner/admin 行的差异服务端不可持久化
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      await Promise.all(
        patches.map((patch) =>
          api(`/api/v1/workspaces/${wid}/permissions`, {
            method: "PATCH",
            body: JSON.stringify(patch),
          }),
        ),
      );
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
    return <PermissionsPageSkeleton />;
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
                // 仅 member/viewer 行可写：服务端 PATCH 只接受这两个角色的覆盖，
                // owner/admin 行仅展示（服务端会 400，本地不允许改，避免"看着能改却存不上"）
                const rowEditable = canEdit && isOverridable(role);
                const rowLocked = !rowEditable;

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
            <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
              {/* 无变更占位 */}
            </span>
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
