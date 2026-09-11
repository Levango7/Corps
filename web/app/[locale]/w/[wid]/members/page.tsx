"use client";

/**
 * 成员管理 · /w/[wid]/members
 *
 * 重构后职责：
 *  - 状态管理（members / meta / invite 表单）
 *  - 数据加载 + 邀请/移除/改角色
 *  - 编排子组件（MemberList / MemberSkeleton / EmptyState）
 *
 * 重构前桌面行布局 + 移动卡片布局两套几乎完全相同的渲染逻辑，
 * 合并为单套响应式 MemberList + MemberRow，消除重复。
 */

import { use, useCallback, useEffect, useState } from "react";
import { Link } from "@/lib/i18n-navigation";
import { UserPlus, Trash2, Users, CheckCircle2, Link2, Clock, X } from "lucide-react";
import { api } from "@/lib/api";
import type { Member, Role, TemporaryGrant } from "@/lib/types";
import { ROLE_META } from "@/lib/task-meta";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/Toast";

interface WorkspaceMeta {
  name: string;
  seatLimit: number;
  memberCount: number;
  role: Role;
}

/** 临时授权持续时间选项（小时） — label 由组件内用 i18n 映射 */
const DURATION_HOURS: number[] = [1, 4, 8, 24, 48, 168];

/** 持续时间小时数 → i18n key 映射 */
function durationKey(hours: number): string {
  switch (hours) {
    case 1:
      return "duration1h";
    case 4:
      return "duration4h";
    case 8:
      return "duration8h";
    case 24:
      return "duration24h";
    case 48:
      return "duration48h";
    case 168:
      return "duration7d";
    default:
      return "duration24h";
  }
}

/** 格式化到期时间（相对时间 + 绝对时间） — 接受 i18n 翻译函数 */
function formatExpiry(expiresAt: string, t: (key: string, vars?: Record<string, string | number>) => string): string {
  const now = Date.now();
  const expiry = new Date(expiresAt).getTime();
  const diffMs = expiry - now;
  if (diffMs <= 0) return t("tempGrantExpired");
  const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays > 0) return t("tempGrantExpiryDays", { count: diffDays });
  if (diffHours > 0) return t("tempGrantExpiryHours", { count: diffHours });
  const diffMinutes = Math.floor(diffMs / (60 * 1000));
  return t("tempGrantExpiryMinutes", { count: diffMinutes });
}

function Avatar({ m }: { m: Member }) {
  return (
    <div className="w-8 h-8 rounded-full bg-[var(--accent)] text-[var(--accent-fg)] flex items-center justify-center text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] shrink-0">
      {(m.name || m.email)[0]?.toUpperCase()}
    </div>
  );
}

export default function MembersPage({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = use(params);

  const t = useTranslations("members");
  const tButton = useTranslations("button");
  const tRole = useTranslations("role");
  const { toast } = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [meta, setMeta] = useState<WorkspaceMeta | null>(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");
  /** 未注册邮箱邀请时后端返回的可分享链接（pending 分支） */
  const [inviteLink, setInviteLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  /** 工作区临时授权列表（F2 任务 186） */
  const [tempGrants, setTempGrants] = useState<TemporaryGrant[]>([]);
  /** 临时授权模态框目标用户（null=关闭） */
  const [grantModalTarget, setGrantModalTarget] = useState<Member | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, ws] = await Promise.all([
        api<{ items: Member[]; total: number; hasMore: boolean }>(`/api/v1/workspaces/${wid}/members`),
        api<WorkspaceMeta>(`/api/v1/workspaces/${wid}`),
      ]);
      setMembers(list.items);
      setMeta(ws);
      // 加载临时授权列表（仅 owner/admin 可访问；非管理角色静默跳过）
      if (["owner", "admin"].includes(ws.role)) {
        try {
          // 路径 userId 占位用当前用户（实际后端返回工作区全部授权）
          const grantsRes = await api<{ items: TemporaryGrant[]; total: number }>(
            `/api/v1/workspaces/${wid}/members/${list.items[0]?.id ?? "00000000-0000-0000-0000-000000000000"}/temporary-grants`,
          );
          setTempGrants(grantsRes.items);
        } catch {
          // 临时授权加载失败不阻断主流程
          setTempGrants([]);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [wid, t]);

  useEffect(() => {
    load();
  }, [load]);

  async function invite() {
    setError("");
    setInviteSuccess("");
    setInviteLink("");
    if (busy) return;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setError(t("invalidEmail"));
      return;
    }
    setBusy(true);
    try {
      const res = await api<{
        pending: boolean;
        email: string;
        inviteUrl?: string;
      } | null>(`/api/v1/workspaces/${wid}/members/invite`, {
        method: "POST",
        body: JSON.stringify({ email: email.trim() }),
      });
      if (res?.pending && res.inviteUrl) {
        // 未注册用户：展示可分享的邀请链接（后端已尝试发邮件，此处兜底手动分享）
        setInviteSuccess(t("inviteCreated", { email: res.email }));
        setInviteLink(res.inviteUrl);
      } else {
        // 已注册用户：直接加入工作区
        setEmail("");
        setInviteSuccess(t("inviteSent"));
      }
      setTimeout(() => {
        setInviteSuccess("");
        setInviteLink("");
      }, 8000);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("inviteFailed"));
    } finally {
      setBusy(false);
    }
  }

  /** 复制邀请链接到剪贴板，失败时降级为选中提示 */
  async function copyInviteLink() {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setInviteSuccess(t("copied"));
    } catch {
      setInviteSuccess(t("copyFailed"));
    }
  }

  async function remove(uid: string, _label: string) {
    setError("");
    try {
      await api(`/api/v1/workspaces/${wid}/members/${uid}`, { method: "DELETE" });
      await load();
      toast("success", t("removeSuccess"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("removeFailed");
      setError(msg);
      toast("error", msg);
    }
  }

  async function changeRole(uid: string, role: Role) {
    setError("");
    setMembers((prev) => prev.map((m) => (m.id === uid ? { ...m, role } : m)));
    try {
      await api(`/api/v1/workspaces/${wid}/members/${uid}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      await load();
      toast("success", t("roleChangeSuccess"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("roleChangeFailed");
      setError(msg);
      toast("error", msg);
      await load();
    }
  }

  // 转让所有权：owner-only
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTarget, setTransferTarget] = useState("");
  const [transferBusy, setTransferBusy] = useState(false);

  async function handleTransfer() {
    if (transferBusy || !transferTarget) return;
    setError("");
    setTransferBusy(true);
    try {
      await api(`/api/v1/workspaces/${wid}/transfer-ownership`, {
        method: "PATCH",
        body: JSON.stringify({ newOwnerUserId: transferTarget }),
      });
      setTransferOpen(false);
      setTransferTarget("");
      setInviteSuccess(t("transferSuccess"));
      setTimeout(() => setInviteSuccess(""), 5000);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("transferFailed"));
    } finally {
      setTransferBusy(false);
    }
  }

  const canManage = meta ? ["owner", "admin"].includes(meta.role) : false;
  const seatsUsed = meta?.memberCount ?? members.length;
  const seatsTotal = meta?.seatLimit ?? 0;
  const seatsFull = seatsTotal > 0 && seatsUsed >= seatsTotal;
  const onlySelf = members.length <= 1 && members.some((m) => m.isSelf);

  /** 授予临时授权 */
  async function grantTemporaryRole(
    target: Member,
    tempRole: "admin" | "member",
    durationHours: number,
    reason: string,
  ) {
    setError("");
    setBusy(true);
    try {
      await api(
        `/api/v1/workspaces/${wid}/members/${target.id}/temporary-grants`,
        {
          method: "POST",
          body: JSON.stringify({ tempRole, durationHours, reason: reason || undefined }),
        },
      );
      setGrantModalTarget(null);
      toast("success", t("tempGrantSuccess"));
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("tempGrantFailed");
      setError(msg);
      toast("error", msg);
    } finally {
      setBusy(false);
    }
  }

  /** 撤销临时授权 */
  async function revokeTemporaryRole(userId: string) {
    setError("");
    try {
      await api(
        `/api/v1/workspaces/${wid}/members/${userId}/temporary-grants`,
        { method: "DELETE" },
      );
      toast("success", t("tempRevokeSuccess"));
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("tempRevokeFailed");
      setError(msg);
      toast("error", msg);
    }
  }

  return (
    <div className="mx-auto max-w-[var(--container-max)]">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-6 gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-[length:var(--text-2xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
            <Users size={20} className="text-[var(--muted)]" />
            {t("title")}
          </h1>
          <p className="mt-1 text-[length:var(--text-sm)] text-[var(--muted)]">{t("subtitle")}</p>
        </div>
        {seatsTotal > 0 && (
          <div className="w-full sm:w-auto sm:text-right sm:shrink-0 order-first sm:order-none mb-4 sm:mb-0">
            <div className="text-[length:var(--text-sm)] text-[var(--fg-2)]">
              {t("seatsCount", { used: seatsUsed, total: seatsTotal })}
            </div>
            <div className="mt-1.5 w-full sm:w-28 h-1 rounded-full bg-[var(--surface-3)] overflow-hidden">
              <div
                className="h-full rounded-full transition-[width] duration-[var(--motion-slow)]"
                style={{
                  width: `${Math.min(100, (seatsUsed / seatsTotal) * 100)}%`,
                  background: seatsFull ? "var(--warn)" : "var(--accent)",
                }}
              />
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-sm)] border border-[color-mix(in_srgb,var(--danger)_20%,transparent)]">
          {error}
        </div>
      )}

      {canManage && (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-6">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && invite()}
              placeholder={t("invitePlaceholder")}
              className="w-full sm:w-auto sm:flex-1 h-9 px-3 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 placeholder:text-[var(--meta)]"
            />
            <button
              onClick={invite}
              disabled={busy || seatsFull}
              className="w-full sm:w-auto flex items-center justify-center gap-2 h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
            >
              <UserPlus size={16} />
              {tButton("invite")}
            </button>
          </div>
          {inviteSuccess && (
            <div className="mb-4 flex items-start gap-2 px-4 py-3 rounded-[var(--radius-md)] bg-[var(--success-soft)] text-[var(--success-fg)] text-[length:var(--text-sm)]">
              <CheckCircle2 size={16} className="shrink-0 mt-0.5 text-[var(--success)]" />
              <div className="min-w-0">
                <span>{inviteSuccess}</span>
                {inviteLink && (
                  <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-2">
                    <code className="flex-1 min-w-0 truncate px-2 py-1 rounded-[var(--radius-sm)] bg-[var(--surface-3)] text-[length:var(--text-xs)] text-[var(--fg-2)]">
                      {inviteLink}
                    </code>
                    <button
                      onClick={copyInviteLink}
                      className="shrink-0 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[var(--radius-sm)] border border-[var(--border)] text-[length:var(--text-xs)] text-[var(--fg-2)] hover:bg-[var(--surface-3)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
                    >
                      <Link2 size={12} />
                      {t("copyLink")}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {seatsFull && canManage && (
        <div className="mb-6 px-4 py-3 rounded-[var(--radius-md)] bg-[var(--warn-soft)] text-[var(--warn-fg)] text-[length:var(--text-sm)]">
          {t("seatsFullPrefix")}{" "}
          <Link href={`/w/${wid}/billing`} className="underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2">
            {t("seatsFullBillingLink")}
          </Link>{" "}
          {t("seatsFullSuffix")}
        </div>
      )}

      {/* 转让所有权：owner only */}
      {meta?.role === "owner" && (
        <section className="mb-6 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] p-4">
          <h2 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)] mb-1">
            {t("transfer")}
          </h2>
          <p className="text-[length:var(--text-xs)] text-[var(--meta)] mb-3">
            {t("transferHint")}
          </p>
          {!transferOpen ? (
            <button
              onClick={() => setTransferOpen(true)}
              disabled={members.filter((m) => !m.isSelf && m.role !== "owner").length === 0}
              className="h-9 px-4 border border-[var(--border)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
            >
              {t("transfer")}
            </button>
          ) : (
            <div className="space-y-2">
              <select
                value={transferTarget}
                onChange={(e) => setTransferTarget(e.target.value)}
                className="w-full h-9 px-2 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
              >
                <option value="">{t("transferSelect")}</option>
                {members
                  .filter((m) => !m.isSelf && m.role !== "owner")
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name || m.email}（{tRole(m.role)}）
                    </option>
                  ))}
              </select>
              <p className="text-[length:var(--text-xs)] text-[var(--meta)]">
                {t("transferConfirmHint")}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleTransfer}
                  disabled={transferBusy || !transferTarget}
                  className="h-9 px-3 bg-[var(--danger)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
                >
                  {t("transferConfirm")}
                </button>
                <button
                  onClick={() => {
                    setTransferOpen(false);
                    setTransferTarget("");
                  }}
                  disabled={transferBusy}
                  className="h-9 px-3 text-[length:var(--text-sm)] text-[var(--fg-2)] rounded-[var(--radius-md)] hover:bg-[var(--surface-2)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
                >
                  {t("transferCancel")}
                </button>
              </div>
            </div>
          )}
          {members.filter((m) => !m.isSelf && m.role !== "owner").length === 0 && (
            <p className="mt-2 text-[length:var(--text-xs)] text-[var(--meta)]">
              {t("transferEmptyList")}
            </p>
          )}
        </section>
      )}

      {loading ? (
        <MemberSkeleton />
      ) : onlySelf ? (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] px-4 py-12 text-center">
          <div className="flex justify-center mb-4">
            <UserPlus size={48} className="text-[var(--muted)] opacity-40" />
          </div>
          <p className="text-[length:var(--text-base)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
            {t("emptyTitle")}
          </p>
          <p className="mt-1 text-[length:var(--text-sm)] text-[var(--muted)]">{t("emptyDesc")}</p>
        </div>
      ) : (
        <MemberList
          members={members}
          canManage={canManage}
          onChangeRole={changeRole}
          onRemove={remove}
          tempGrants={tempGrants}
          onGrantTempRole={(m) => setGrantModalTarget(m)}
          onRevokeTempRole={revokeTemporaryRole}
        />
      )}

      {/* 临时授权模态框 */}
      {grantModalTarget && (
        <TemporaryGrantModal
          target={grantModalTarget}
          existingGrant={tempGrants.find((g) => g.userId === grantModalTarget.id) ?? null}
          busy={busy}
          onClose={() => setGrantModalTarget(null)}
          onConfirm={grantTemporaryRole}
          onRevoke={() => revokeTemporaryRole(grantModalTarget.id)}
        />
      )}

      <p className="mt-4 text-[length:var(--text-xs)] text-[var(--meta)]">{t("inviteNote")}</p>
    </div>
  );
}

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

function MemberList({
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
  // Viewer 角色提示：选中 viewer 时在角色选择下方显示只读说明
  const showViewerHint = m.role === "viewer";
  // 临时授权是否有效（未过期）
  const tempGrantActive =
    tempGrant && new Date(tempGrant.expiresAt).getTime() > Date.now();

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
                title={t("tempGrantActive", { role: tempGrant!.tempRole === "admin" ? t("tempGrantAdmin") : t("tempGrantMember"), time: formatExpiry(tempGrant!.expiresAt, t) })}
              >
                <Clock size={10} />
                {tempGrant!.tempRole === "admin" ? t("tempGrantAdmin") : t("tempGrantMember")}
              </span>
            )}
          </div>
          <div className="text-[length:var(--text-xs)] text-[var(--muted)] truncate">
            {m.email}
            {tempGrantActive && (
              <span className="ml-2 text-[var(--meta)]">· {formatExpiry(tempGrant!.expiresAt, t)}</span>
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
                  setTimeout(() => setConfirming(false), 3000);
                }
              }}
              onBlur={() => setConfirming(false)}
              className={`p-2 rounded-[var(--radius-md)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 ${
                confirming
                  ? "bg-[var(--danger-soft)] text-[var(--danger)]"
                  : "hover:bg-[var(--danger-soft)] text-[var(--meta)] hover:text-[var(--danger)]"
              }`}
              aria-label={confirming ? t("removeConfirm", { name: label }) : t("remove") + " " + label}
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
                title={t("tempGrantActive", { role: tempGrant!.tempRole === "admin" ? t("tempGrantAdmin") : t("tempGrantMember"), time: formatExpiry(tempGrant!.expiresAt, t) })}
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
            className="w-full h-8 px-2 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
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
              className="flex-1 flex items-center justify-center gap-2 h-8 px-3 rounded-[var(--radius-md)] border border-[var(--border)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
            >
              <Clock size={14} />
              <span>{tempGrantActive ? t("tempGrantManage") : t("tempGrant")}</span>
            </button>
            {tempGrantActive && (
              <button
                onClick={() => onRevokeTempRole(m.id)}
                className="flex items-center justify-center gap-2 h-8 px-3 rounded-[var(--radius-md)] border border-[var(--border)] text-[length:var(--text-sm)] text-[var(--meta)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
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
                setTimeout(() => setConfirming(false), 3000);
              }
            }}
            onBlur={() => setConfirming(false)}
            className={`w-full flex items-center justify-center gap-2 h-8 px-3 rounded-[var(--radius-md)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 ${
              confirming
                ? "bg-[var(--danger-soft)] text-[var(--danger)]"
                : "hover:bg-[var(--danger-soft)] text-[var(--meta)] hover:text-[var(--danger)]"
            }`}
            aria-label={confirming ? t("removeConfirm", { name: label }) : t("remove") + " " + label}
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

function MemberSkeleton() {
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
// ─── 临时授权模态框（F2 任务 186）─────────────────────────

interface TemporaryGrantModalProps {
  target: Member;
  existingGrant: TemporaryGrant | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (
    target: Member,
    tempRole: "admin" | "member",
    durationHours: number,
    reason: string,
  ) => Promise<void>;
  onRevoke: () => Promise<void>;
}

function TemporaryGrantModal({
  target,
  existingGrant,
  busy,
  onClose,
  onConfirm,
  onRevoke,
}: TemporaryGrantModalProps) {
  const t = useTranslations("members");
  const tButton = useTranslations("button");

  // Escape 关闭 + body 滚动锁（可访问性）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const [tempRole, setTempRole] = useState<"admin" | "member">(
    existingGrant?.tempRole === "member" ? "member" : "admin",
  );
  const [durationHours, setDurationHours] = useState(24);
  const [reason, setReason] = useState(existingGrant?.reason ?? "");
  const existingActive =
    existingGrant && new Date(existingGrant.expiresAt).getTime() > Date.now();

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-[var(--overlay)] p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-lg)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="flex items-center gap-2 text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
            <Clock size={18} className="text-[var(--warn-fg)]" />
            {t("tempGrant")}
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded-[var(--radius-sm)] text-[var(--meta)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
            aria-label={tButton("close")}
          >
            <X size={18} />
          </button>
        </div>

        <p className="text-[length:var(--text-sm)] text-[var(--muted)] mb-4">
          {t("tempGrantDesc")} <span className="font-[weight:var(--weight-medium)] text-[var(--fg)]">{target.name || target.email}</span>
        </p>

        {/* 当前授权状态 */}
        {existingActive && (
          <div className="mb-4 px-3 py-2 rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--warn)_10%,transparent)] border border-[color-mix(in_srgb,var(--warn)_20%,transparent)]">
            <div className="text-[length:var(--text-sm)] text-[var(--warn-fg)] font-[weight:var(--weight-medium)]">
              {t("tempGrantCurrent", { role: existingGrant!.tempRole === "admin" ? t("tempGrantAdmin") : t("tempGrantMember") })}
            </div>
            <div className="text-[length:var(--text-xs)] text-[var(--meta)] mt-0.5">
              {formatExpiry(existingGrant!.expiresAt, t)}
              {existingGrant!.reason && ` · ${existingGrant!.reason}`}
            </div>
            <button
              onClick={onRevoke}
              disabled={busy}
              className="mt-2 h-7 px-2.5 inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] text-[length:var(--text-xs)] text-[var(--danger)] hover:bg-[var(--danger-soft)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
            >
              <X size={12} />
              {t("tempGrantRevokeNow")}
            </button>
          </div>
        )}

        {/* 授权表单 */}
        <div className="space-y-3">
          <div>
            <label className="block text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] mb-1.5">
              {t("tempRole")}
            </label>
            <select
              value={tempRole}
              onChange={(e) => setTempRole(e.target.value as "admin" | "member")}
              className="w-full h-9 px-3 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
            >
              <option value="admin">{t("tempGrantAdmin")}</option>
              <option value="member">{t("tempGrantMember")}</option>
            </select>
          </div>

          <div>
            <label className="block text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] mb-1.5">
              {t("duration")}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {DURATION_HOURS.map((hours) => (
                <button
                  key={hours}
                  type="button"
                  onClick={() => setDurationHours(hours)}
                  className={`h-9 rounded-[var(--radius-md)] text-[length:var(--text-sm)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 ${
                    durationHours === hours
                      ? "bg-[var(--accent)] text-[var(--accent-fg)] font-[weight:var(--weight-medium)]"
                      : "border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-2)]"
                  }`}
                >
                  {t(durationKey(hours))}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] mb-1.5">
              {t("grantReason")}
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              placeholder={t("grantReasonPlaceholder")}
              className="w-full h-9 px-3 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 placeholder:text-[var(--meta)]"
            />
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="h-9 px-4 text-[length:var(--text-sm)] text-[var(--fg-2)] rounded-[var(--radius-md)] hover:bg-[var(--surface-2)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
          >
            {tButton("cancel")}
          </button>
          <button
            onClick={() => onConfirm(target, tempRole, durationHours, reason)}
            disabled={busy}
            className="h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
          >
            {busy ? t("tempGrantSubmitting") : existingActive ? t("tempGrantUpdate") : t("grantTempPermission")}
          </button>
        </div>
      </div>
    </div>
  );
}
