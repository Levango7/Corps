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
import Link from "next/link";
import {
  UserPlus,
  Trash2,
  Users,
  CheckCircle2,
  Link2,
} from "lucide-react";
import { api } from "@/lib/api";
import type { Member, Role } from "@/lib/types";
import { ROLE_META } from "@/lib/task-meta";

interface WorkspaceMeta {
  name: string;
  seatLimit: number;
  memberCount: number;
  role: Role;
}

function Avatar({ m }: { m: Member }) {
  return (
    <div className="w-8 h-8 rounded-full bg-[var(--accent)] text-[var(--accent-fg)] flex items-center justify-center text-[length:var(--text-sm)] font-[var(--weight-medium)] shrink-0">
      {(m.name || m.email)[0]?.toUpperCase()}
    </div>
  );
}

export default function MembersPage({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = use(params);
  const [members, setMembers] = useState<Member[]>([]);
  const [meta, setMeta] = useState<WorkspaceMeta | null>(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");
  /** 未注册邮箱邀请时后端返回的可分享链接（pending 分支） */
  const [inviteLink, setInviteLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [list, ws] = await Promise.all([
        api<Member[]>(`/api/v1/workspaces/${wid}/members`),
        api<WorkspaceMeta>(`/api/v1/workspaces/${wid}`),
      ]);
      setMembers(list);
      setMeta(ws);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [wid]);

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
      setError("请输入有效的邮箱地址");
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
        setInviteSuccess(`已为 ${res.email} 创建邀请（7 天有效），可复制链接发给对方`);
        setInviteLink(res.inviteUrl);
      } else {
        // 已注册用户：直接加入工作区
        setEmail("");
        setInviteSuccess("已发送邀请邮件");
      }
      setTimeout(() => {
        setInviteSuccess("");
        setInviteLink("");
      }, 8000);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "邀请失败");
    } finally {
      setBusy(false);
    }
  }

  /** 复制邀请链接到剪贴板，失败时降级为选中提示 */
  async function copyInviteLink() {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setInviteSuccess("链接已复制到剪贴板");
    } catch {
      setInviteSuccess("复制失败，请手动选择并复制上方链接");
    }
  }

  async function remove(uid: string, label: string) {
    if (!window.confirm(`确定移除「${label}」？此操作不可撤销。`)) return;
    setError("");
    try {
      await api(`/api/v1/workspaces/${wid}/members/${uid}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "移除失败");
    }
  }

  async function changeRole(uid: string, role: Role) {
    if (!window.confirm("确定更改该成员角色？")) return;
    setError("");
    setMembers((prev) => prev.map((m) => (m.id === uid ? { ...m, role } : m)));
    try {
      await api(`/api/v1/workspaces/${wid}/members/${uid}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "修改失败");
      await load();
    }
  }

  const canManage = meta ? ["owner", "admin"].includes(meta.role) : false;
  const seatsUsed = meta?.memberCount ?? members.length;
  const seatsTotal = meta?.seatLimit ?? 0;
  const seatsFull = seatsTotal > 0 && seatsUsed >= seatsTotal;
  const onlySelf = members.length <= 1 && members.some((m) => m.isSelf);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-6 gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-[length:var(--text-2xl)] font-[var(--weight-semibold)] text-[var(--fg)]">
            <Users size={20} className="text-[var(--muted)]" />
            成员
          </h1>
          <p className="mt-1 text-[length:var(--text-sm)] text-[var(--muted)]">
            管理谁能进入这个工作区，以及他们能做什么。
          </p>
        </div>
        {seatsTotal > 0 && (
          <div className="w-full sm:w-auto sm:text-right sm:shrink-0 order-first sm:order-none mb-4 sm:mb-0">
            <div className="text-[length:var(--text-sm)] text-[var(--fg-2)]">
              席位 {seatsUsed} / {seatsTotal}
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
        <div
          className="mb-4 px-4 py-3 rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-sm)] border"
          style={{ borderColor: "color-mix(in srgb, var(--danger) 20%, transparent)" }}
        >
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
              placeholder="输入邮箱地址（未注册也可邀请）"
              className="w-full sm:w-auto sm:flex-1 h-9 px-3 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)]"
            />
            <button
              onClick={invite}
              disabled={busy || seatsFull}
              className="w-full sm:w-auto flex items-center justify-center gap-2 h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] font-[var(--weight-medium)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)]"
            >
              <UserPlus size={16} />
              邀请
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
                      className="shrink-0 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[var(--radius-sm)] border border-[var(--border)] text-[length:var(--text-xs)] text-[var(--fg-2)] hover:bg-[var(--surface-3)] transition-colors duration-[var(--motion-fast)]"
                    >
                      <Link2 size={12} />
                      复制链接
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
          席位已用满。前往{" "}
          <Link href={`/w/${wid}/billing`} className="underline underline-offset-2">
            计费
          </Link>{" "}
          增加席位后可继续邀请。
        </div>
      )}

      {loading ? (
        <MemberSkeleton />
      ) : onlySelf ? (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] px-4 py-12 text-center">
          <div className="flex justify-center mb-4">
            <UserPlus size={48} className="text-[var(--muted)] opacity-40" />
          </div>
          <p className="text-[length:var(--text-base)] font-[var(--weight-medium)] text-[var(--fg)]">
            还没有其他成员
          </p>
          <p className="mt-1 text-[length:var(--text-sm)] text-[var(--muted)]">
            邀请队友加入工作区，开始协作
          </p>
        </div>
      ) : (
        <MemberList
          members={members}
          canManage={canManage}
          onChangeRole={changeRole}
          onRemove={remove}
        />
      )}

      <p className="mt-4 text-[length:var(--text-xs)] text-[var(--meta)]">
        未注册的同事会收到一条 7 天有效的专属邀请链接，注册后自动加入。拥有者不可被移除或降级；转让拥有者权限需在设置中操作。
      </p>
    </div>
  );
}

// ─── 成员列表（响应式：≥ md 行布局，< md 卡片布局） ─────────

interface MemberListProps {
  members: Member[];
  canManage: boolean;
  onChangeRole: (uid: string, role: Role) => Promise<void>;
  onRemove: (uid: string, label: string) => Promise<void>;
}

function MemberList({ members, canManage, onChangeRole, onRemove }: MemberListProps) {
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
}

/** 单个成员行/卡片：共用渲染，layout 控制排列。 */
function MemberRow({ m, canManage, onChangeRole, onRemove, layout }: MemberRowProps) {
  const meta = ROLE_META[m.role];
  const Icon = meta.icon;
  const editable = canManage && m.role !== "owner" && !m.isSelf;
  const label = m.name || m.email;

  if (layout === "row") {
    return (
      <div className="flex items-center gap-3 px-4 py-3">
        <Avatar m={m} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[length:var(--text-base)] font-[var(--weight-medium)] text-[var(--fg)] truncate">
              {m.name || m.email.split("@")[0]}
            </span>
            {m.isSelf && (
              <span className="px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--surface-2)] text-[length:var(--text-xs)] text-[var(--muted)]">
                你
              </span>
            )}
          </div>
          <div className="text-[length:var(--text-xs)] text-[var(--muted)] truncate">{m.email}</div>
        </div>
        <div className="flex items-center gap-1">
          {editable ? (
            <select
              value={m.role}
              onChange={(e) => onChangeRole(m.id, e.target.value as Role)}
              className="h-8 px-2 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            >
              <option value="member">成员</option>
              <option value="admin">管理员</option>
            </select>
          ) : (
            <span className="flex items-center gap-1.5 px-2 h-8 text-[length:var(--text-sm)] text-[var(--fg-2)]">
              <Icon size={16} className="text-[var(--muted)]" />
              {meta.label}
            </span>
          )}
          {editable && (
            <button
              onClick={() => onRemove(m.id, label)}
              className="p-2 rounded-[var(--radius-md)] hover:bg-[var(--danger-soft)] text-[var(--meta)] hover:text-[var(--danger)] transition-colors duration-[var(--motion-fast)]"
              aria-label={`移除 ${label}`}
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
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
            <span className="text-[length:var(--text-base)] font-[var(--weight-medium)] text-[var(--fg)] truncate">
              {m.name || m.email.split("@")[0]}
            </span>
            {m.isSelf && (
              <span className="px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--surface-2)] text-[length:var(--text-xs)] text-[var(--muted)]">
                你
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
                {meta.label}
              </span>
            )}
          </div>
        </div>
      </div>
      {editable && (
        <div className="mt-3 flex flex-col items-stretch gap-2">
          <select
            value={m.role}
            onChange={(e) => onChangeRole(m.id, e.target.value as Role)}
            className="w-full h-8 px-2 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
          >
            <option value="member">成员</option>
            <option value="admin">管理员</option>
          </select>
          <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
            拥有者不可在此更改
          </span>
          <button
            onClick={() => onRemove(m.id, label)}
            className="w-full flex items-center justify-center gap-2 h-8 px-3 rounded-[var(--radius-md)] hover:bg-[var(--danger-soft)] text-[var(--meta)] hover:text-[var(--danger)] transition-colors duration-[var(--motion-fast)]"
            aria-label={`移除 ${label}`}
          >
            <Trash2 size={16} />
            <span>移除</span>
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
              <div className="h-4 w-32 rounded bg-[var(--surface-2)] animate-pulse" />
              <div className="h-3 w-48 rounded bg-[var(--surface-2)] animate-pulse" />
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
                <div className="h-4 w-32 rounded bg-[var(--surface-2)] animate-pulse" />
                <div className="h-3 w-48 rounded bg-[var(--surface-2)] animate-pulse" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
