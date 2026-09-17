"use client";

/**
 * 成员管理 · /w/[wid]/members
 *
 * 重构后职责：
 *  - 状态管理（members / meta / invite 表单 / 转让 / 临时授权）
 *  - 数据加载 + 邀请/移除/改角色/转让所有权/临时授权
 *  - 编排子组件（MemberList / MemberSkeleton / TransferOwnership / TemporaryGrantModal）
 */

import { use, useCallback, useEffect, useState } from "react";
import { Link } from "@/lib/i18n-navigation";
import { UserPlus, Users, CheckCircle2, Link2 } from "lucide-react";
import { api } from "@/lib/api";
import type { Member, Role, TemporaryGrant } from "@/lib/types";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/Toast";
import { MemberList, MemberSkeleton } from "@/components/members/MemberList";
import { TemporaryGrantModal } from "@/components/members/TemporaryGrantModal";
import { TransferOwnership } from "@/components/members/TransferOwnership";

interface WorkspaceMeta {
  name: string;
  seatLimit: number;
  memberCount: number;
  role: Role;
}

export default function MembersPage({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = use(params);

  const t = useTranslations("members");
  const tButton = useTranslations("button");
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
              className="w-full sm:w-auto sm:flex-1 min-h-[44px] sm:h-9 px-3 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 placeholder:text-[var(--meta)]"
            />
            <button
              onClick={invite}
              disabled={busy || seatsFull}
              className="w-full sm:w-auto flex items-center justify-center gap-2 min-h-[44px] sm:h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
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
        <TransferOwnership
          members={members}
          transferOpen={transferOpen}
          setTransferOpen={setTransferOpen}
          transferTarget={transferTarget}
          setTransferTarget={setTransferTarget}
          transferBusy={transferBusy}
          onTransfer={handleTransfer}
        />
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
