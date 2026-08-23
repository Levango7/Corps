"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { UserPlus, Trash2, Users, Shield, ShieldCheck, User as UserIcon, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api";

type Role = "owner" | "admin" | "member";

interface Member {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: Role;
  isSelf: boolean;
  joinedAt: string;
}

interface WorkspaceMeta {
  name: string;
  seatLimit: number;
  memberCount: number;
  role: Role;
}

const ROLE_META: Record<Role, { label: string; icon: typeof UserIcon }> = {
  owner: { label: "拥有者", icon: ShieldCheck },
  admin: { label: "管理员", icon: Shield },
  member: { label: "成员", icon: UserIcon },
};

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
    if (busy) return;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setError("请输入有效的邮箱地址");
      return;
    }
    setBusy(true);
    try {
      await api(`/api/v1/workspaces/${wid}/members/invite`, {
        method: "POST",
        body: JSON.stringify({ email: email.trim() }),
      });
      setEmail("");
      setInviteSuccess("已发送邀请邮件");
      setTimeout(() => setInviteSuccess(""), 3000);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "邀请失败");
    } finally {
      setBusy(false);
    }
  }

  async function remove(uid: string, label: string) {
    if (!window.confirm("确定移除该成员？此操作不可撤销。")) return;
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
  // 只有自己一人（无其他成员）时进入空状态；加载失败 members 为空不触发
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
              placeholder="输入已注册的邮箱地址"
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
              <span>{inviteSuccess}</span>
            </div>
          )}
        </>
      )}

      {seatsFull && canManage && (
        <div className="mb-6 px-4 py-3 rounded-[var(--radius-md)] bg-[var(--warn-soft)] text-[var(--warn-fg)] text-[length:var(--text-sm)]">
          席位已用满。前往 <Link href={`/w/${wid}/billing`} className="underline underline-offset-2">计费</Link> 增加席位后可继续邀请。
        </div>
      )}

      {loading ? (
        <>
          {/* 桌面端骨架（行布局） */}
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
          {/* 移动端骨架（卡片布局） */}
          <div className="md:hidden flex flex-col gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-md)] p-3">
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
        <>
          {/* 桌面端行布局（≥ md） */}
          <div className="hidden md:block bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] divide-y divide-[var(--border-soft)]">
            {members.map((m) => {
              const meta2 = ROLE_META[m.role];
              const Icon = meta2.icon;
              const editable = canManage && m.role !== "owner" && !m.isSelf;
              return (
                <div key={m.id} className="flex items-center gap-3 px-4 py-3">
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
                      <div className="flex items-center gap-1">
                        <select
                          value={m.role}
                          onChange={(e) => changeRole(m.id, e.target.value as Role)}
                          className="h-8 px-2 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                        >
                          <option value="member">成员</option>
                          <option value="admin">管理员</option>
                        </select>
                        {/* 拥有者角色只能通过转让工作区变更，不在此选择器内 */}
                        {m.role !== "owner" && (
                          <span className="hidden sm:inline text-[length:var(--text-xs)] text-[var(--meta)]">
                            不能授予/收回拥有者
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="flex items-center gap-1.5 px-2 h-8 text-[length:var(--text-sm)] text-[var(--fg-2)]">
                        <Icon size={16} className="text-[var(--muted)]" />
                        {meta2.label}
                      </span>
                    )}
                    {editable && (
                      <button
                        onClick={() => remove(m.id, m.name || m.email)}
                        className="p-2 rounded-[var(--radius-md)] hover:bg-[var(--danger-soft)] text-[var(--meta)] hover:text-[var(--danger)] transition-colors duration-[var(--motion-fast)]"
                        aria-label={`移除 ${m.name || m.email}`}
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 移动端卡片列表（< md） */}
          <div className="md:hidden flex flex-col gap-2">
            {members.map((m) => {
              const meta2 = ROLE_META[m.role];
              const Icon = meta2.icon;
              const editable = canManage && m.role !== "owner" && !m.isSelf;
              return (
                <div key={m.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-md)] p-3">
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
                        <span className="text-[length:var(--text-xs)] text-[var(--muted)] truncate">{m.email}</span>
                        {!editable && (
                          <span className="flex items-center gap-1 shrink-0 text-[length:var(--text-xs)] text-[var(--fg-2)]">
                            <Icon size={12} className="text-[var(--muted)]" />
                            {meta2.label}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  {editable && (
                    <div className="mt-3 flex flex-col items-stretch gap-2">
                      <select
                        value={m.role}
                        onChange={(e) => changeRole(m.id, e.target.value as Role)}
                        className="w-full h-8 px-2 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                      >
                        <option value="member">成员</option>
                        <option value="admin">管理员</option>
                      </select>
                      <span className="text-[length:var(--text-xs)] text-[var(--meta)]">拥有者不可在此更改</span>
                      <button
                        onClick={() => remove(m.id, m.name || m.email)}
                        className="w-full flex items-center justify-center gap-2 h-8 px-3 rounded-[var(--radius-md)] hover:bg-[var(--danger-soft)] text-[var(--meta)] hover:text-[var(--danger)] transition-colors duration-[var(--motion-fast)]"
                        aria-label={`移除 ${m.name || m.email}`}
                      >
                        <Trash2 size={16} />
                        <span>移除</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      <p className="mt-4 text-[length:var(--text-xs)] text-[var(--meta)]">
        邀请前对方需先在 corps 注册账号。拥有者不可被移除或降级；转让拥有者权限需在设置中操作。
      </p>
    </div>
  );
}
