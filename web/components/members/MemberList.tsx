"use client";

// 成员列表（响应式：≥ md 行布局，< md 卡片布局）+ 骨架。
// 拆分自 members/page.tsx 第 485-838 行。

import { useEffect, useRef, useState } from "react";
import { Clock, X, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Member, Role, TemporaryGrant } from "@/lib/types";
import { ROLE_META } from "@/lib/task-meta";
import { Avatar, formatExpiry } from "./helpers";

// ─── 成员列表（响应式：≥ md 行布局，< md 卡片布局） ─────────

interface MemberListProps {
  members: Member[];
  canManage: boolean;
  onChangeRole: (uid: string, role: Role) => Promise<void>;
  onRemove: (uid: string, label: string) => Promise<void>;
  tempGrants: TemporaryGrant[];
  onGrantTempRole: (m: Member) => void;
  onRevokeTempRole: (userId: string) => Promise<void>;
}

export function MemberList({
  members,
  canManage,
  onChangeRole,
  onRemove,
  tempGrants,
  onGrantTempRole,
  onRevokeTempRole,
}: MemberListProps) {
  return (
    <>
      {/* ≥ md：行布局 */}
      <div className="hidden md:block bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] divide-y divide-[var(--border-soft)]">
        {members.map((m) => (
          <MemberRow
            key={m.id}
            m={m}
            canManage={canManage}
            onChangeRole={onChangeRole}
            onRemove={onRemove}
            layout="row"
            tempGrant={tempGrants.find((g) => g.userId === m.id) ?? null}
            onGrantTempRole={onGrantTempRole}
            onRevokeTempRole={onRevokeTempRole}
          />
        ))}
      </div>

      {/* < md：卡片布局 */}
      <div className="md:hidden flex flex-col gap-2">
        {members.map((m) => (
          <div
            key={m.id}
            className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-md)] p-3"
          >
            <MemberRow
              m={m}
              canManage={canManage}
              onChangeRole={onChangeRole}
              onRemove={onRemove}
              layout="card"
              tempGrant={tempGrants.find((g) => g.userId === m.id) ?? null}
              onGrantTempRole={onGrantTempRole}
              onRevokeTempRole={onRevokeTempRole}
            />
          </div>
        ))}
      </div>
    </>
  );
}

interface MemberRowProps {
  m: Member;
  canManage: boolean;
  onChangeRole: (uid: string, role: Role) => Promise<void>;
  onRemove: (uid: string, label: string) => Promise<void>;
  layout: "row" | "card";
  tempGrant: TemporaryGrant | null;
  onGrantTempRole: (m: Member) => void;
  onRevokeTempRole: (userId: string) => Promise<void>;
}

/** 单个成员行/卡片：共用渲染，layout 控制排列。 */
function MemberRow({
  m,
  canManage,
  onChangeRole,
  onRemove,
  layout,
  tempGrant,
  onGrantTempRole,
  onRevokeTempRole,
}: MemberRowProps) {
  const meta = ROLE_META[m.role];
  const t = useTranslations("members");
  const tRole = useTranslations("role");
  const tPermissions = useTranslations("permissions");

  const Icon = meta.icon;
  const editable = canManage && m.role !== "owner" && !m.isSelf;
  const label = m.name || m.email;
  // M-5 修复：内联两步确认替代 window.confirm（阻塞式原生弹窗）。
  // 第一次点击进入 confirming 态（按钮变红+文案切换），第二次点击执行删除。
  // 失焦或 3 秒超时自动重置，避免用户误触后卡在确认态。
  const [confirming, setConfirming] = useState(false);
  // 确认态超时定时器引用：组件卸载或重新进入确认态时清理，避免泄漏。
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    };
  }, []);
  // Viewer 角色提示：选中 viewer 时在角色选择下方显示只读说明
  const showViewerHint = m.role === "viewer";
  // 临时授权是否有效（未过期）
  const tempGrantActive = tempGrant && new Date(tempGrant.expiresAt).getTime() > Date.now();

  if (layout === "row") {
    return (
      <div className="flex items-center gap-3 px-4 py-3">
        <Avatar m={m} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[length:var(--text-base)] font-[weight:var(--weight-medium)] text-[var(--fg)] truncate">
              {m.name || m.email.split("@")[0]}
            </span>
            {m.isSelf && (
              <span className="px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--surface-2)] text-[length:var(--text-xs)] text-[var(--muted)]">
                {t("you")}
              </span>
            )}
            {/* 临时授权徽章：显示临时角色 + 到期时间 */}
            {tempGrantActive && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[color-mix(in_srgb,var(--warn)_15%,transparent)] text-[length:var(--text-xs)] text-[var(--warn-fg)]"
                title={t("tempGrantActive", {
                  role:
                    tempGrant!.tempRole === "admin" ? t("tempGrantAdmin") : t("tempGrantMember"),
                  time: formatExpiry(tempGrant!.expiresAt, t),
                })}
              >
                <Clock size={10} />
                {tempGrant!.tempRole === "admin" ? t("tempGrantAdmin") : t("tempGrantMember")}
              </span>
            )}
          </div>
          <div className="text-[length:var(--text-xs)] text-[var(--muted)] truncate">
            {m.email}
            {tempGrantActive && (
              <span className="ml-2 text-[var(--meta)]">
                · {formatExpiry(tempGrant!.expiresAt, t)}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {editable ? (
            <select
              value={m.role}
              onChange={(e) => onChangeRole(m.id, e.target.value as Role)}
              className="h-8 px-2 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
            >
              <option value="member">{t("roleMember")}</option>
              <option value="admin">{t("roleAdmin")}</option>
              <option value="viewer">{t("roleViewer")}</option>
            </select>
          ) : (
            <span className="flex items-center gap-1.5 px-2 h-8 text-[length:var(--text-sm)] text-[var(--fg-2)]">
              <Icon size={16} className="text-[var(--muted)]" />
              {tRole(meta.labelKey)}
            </span>
          )}
          {/* 临时授权按钮：仅 owner/admin 可见，且不能对 owner/自己操作 */}
          {editable && (
            <button
              onClick={() => onGrantTempRole(m)}
              className="p-2 rounded-[var(--radius-md)] text-[var(--meta)] hover:bg-[var(--surface-2)] hover:text-[var(--warn-fg)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
              aria-label={t("tempGrant")}
              title={tempGrantActive ? t("tempGrantManage") : t("tempGrant")}
            >
              <Clock size={16} />
            </button>
          )}
          {/* 撤销临时授权按钮：仅有有效临时授权时显示 */}
          {editable && tempGrantActive && (
            <button
              onClick={() => onRevokeTempRole(m.id)}
              className="p-2 rounded-[var(--radius-md)] text-[var(--meta)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
              aria-label={t("revokeTempPermission")}
              title={t("revokeTempPermission")}
            >
              <X size={16} />
            </button>
          )}
          {editable && (
            <button
              onClick={() => {
                if (confirming) {
                  setConfirming(false);
                  onRemove(m.id, label);
                } else {
                  setConfirming(true);
                  if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
                  confirmTimeoutRef.current = setTimeout(() => setConfirming(false), 3000);
                }
              }}
              onBlur={() => setConfirming(false)}
              className={`p-2 rounded-[var(--radius-md)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 ${
                confirming
                  ? "bg-[var(--danger-soft)] text-[var(--danger)]"
                  : "hover:bg-[var(--danger-soft)] text-[var(--meta)] hover:text-[var(--danger)]"
              }`}
              aria-label={
                confirming ? t("removeConfirm", { name: label }) : t("remove") + " " + label
              }
              title={confirming ? t("removeConfirm", { name: label }) : undefined}
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
        {showViewerHint && (
          <div className="ml-auto text-[length:var(--text-xs)] text-[var(--meta)] italic">
            {tPermissions("viewerHint")}
          </div>
        )}
      </div>
    );
  }

  // card 布局
  return (
    <div>
      <div className="flex items-center gap-3">
        <Avatar m={m} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[length:var(--text-base)] font-[weight:var(--weight-medium)] text-[var(--fg)] truncate">
              {m.name || m.email.split("@")[0]}
            </span>
            {m.isSelf && (
              <span className="px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--surface-2)] text-[length:var(--text-xs)] text-[var(--muted)]">
                {t("you")}
              </span>
            )}
            {/* 临时授权徽章（card 布局） */}
            {tempGrantActive && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[color-mix(in_srgb,var(--warn)_15%,transparent)] text-[length:var(--text-xs)] text-[var(--warn-fg)]"
                title={t("tempGrantActive", {
                  role:
                    tempGrant!.tempRole === "admin" ? t("tempGrantAdmin") : t("tempGrantMember"),
                  time: formatExpiry(tempGrant!.expiresAt, t),
                })}
              >
                <Clock size={10} />
                {tempGrant!.tempRole === "admin" ? t("tempGrantAdmin") : t("tempGrantMember")}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[length:var(--text-xs)] text-[var(--muted)] truncate">
              {m.email}
            </span>
            {!editable && (
              <span className="flex items-center gap-1 shrink-0 text-[length:var(--text-xs)] text-[var(--fg-2)]">
                <Icon size={12} className="text-[var(--muted)]" />
                {tRole(meta.labelKey)}
              </span>
            )}
          </div>
          {tempGrantActive && (
            <div className="text-[length:var(--text-xs)] text-[var(--meta)] mt-0.5">
              {formatExpiry(tempGrant!.expiresAt, t)}
            </div>
          )}
        </div>
      </div>
      {editable && (
        <div className="mt-3 flex flex-col items-stretch gap-2">
          <select
            value={m.role}
            onChange={(e) => onChangeRole(m.id, e.target.value as Role)}
            className="w-full min-h-[44px] px-2 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
          >
            <option value="member">{t("roleMember")}</option>
            <option value="admin">{t("roleAdmin")}</option>
            <option value="viewer">{t("roleViewer")}</option>
          </select>
          {showViewerHint ? (
            <span className="text-[length:var(--text-xs)] text-[var(--meta)] italic">
              {tPermissions("viewerHint")}
            </span>
          ) : (
            <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
              {t("ownerNotEditable")}
            </span>
          )}
          {/* 临时授权按钮（card 布局） */}
          <div className="flex gap-2">
            <button
              onClick={() => onGrantTempRole(m)}
              className="flex-1 flex items-center justify-center gap-2 min-h-[44px] px-3 rounded-[var(--radius-md)] border border-[var(--border)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
            >
              <Clock size={14} />
              <span>{tempGrantActive ? t("tempGrantManage") : t("tempGrant")}</span>
            </button>
            {tempGrantActive && (
              <button
                onClick={() => onRevokeTempRole(m.id)}
                className="flex items-center justify-center gap-2 min-h-[44px] px-3 rounded-[var(--radius-md)] border border-[var(--border)] text-[length:var(--text-sm)] text-[var(--meta)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
              >
                <X size={14} />
                <span>{t("revokeTempPermission")}</span>
              </button>
            )}
          </div>
          <button
            onClick={() => {
              if (confirming) {
                setConfirming(false);
                onRemove(m.id, label);
              } else {
                setConfirming(true);
                if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
                confirmTimeoutRef.current = setTimeout(() => setConfirming(false), 3000);
              }
            }}
            onBlur={() => setConfirming(false)}
            className={`w-full flex items-center justify-center gap-2 min-h-[44px] px-3 rounded-[var(--radius-md)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 ${
              confirming
                ? "bg-[var(--danger-soft)] text-[var(--danger)]"
                : "hover:bg-[var(--danger-soft)] text-[var(--meta)] hover:text-[var(--danger)]"
            }`}
            aria-label={
              confirming ? t("removeConfirm", { name: label }) : t("remove") + " " + label
            }
            title={confirming ? t("removeConfirm", { name: label }) : undefined}
          >
            <Trash2 size={16} />
            <span>{confirming ? t("removeConfirmAction") : t("remove")}</span>
          </button>
        </div>
      )}
    </div>
  );
}

// ─── 骨架（响应式） ─────────────────────────────────────

export function MemberSkeleton() {
  return (
    <>
      <div className="hidden md:block bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] divide-y divide-[var(--border-soft)]">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <div className="w-8 h-8 rounded-full bg-[var(--surface-2)] animate-pulse shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-32 rounded-[var(--radius-sm)] bg-[var(--surface-2)] animate-pulse" />
              <div className="h-3 w-48 rounded-[var(--radius-sm)] bg-[var(--surface-2)] animate-pulse" />
            </div>
          </div>
        ))}
      </div>
      <div className="md:hidden flex flex-col gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-md)] p-3"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-[var(--surface-2)] animate-pulse shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-32 rounded-[var(--radius-sm)] bg-[var(--surface-2)] animate-pulse" />
                <div className="h-3 w-48 rounded-[var(--radius-sm)] bg-[var(--surface-2)] animate-pulse" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
