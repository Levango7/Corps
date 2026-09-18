"use client";

/**
 * 群聊设置面板（侧滑模态）
 *
 * - 群聊信息：群名（可编辑）、群描述
 * - 成员列表：头像 + 名称 + 角色，owner/admin 可移除成员、更改角色
 * - 添加成员：owner/admin 可添加新成员
 * - 退出群聊：普通成员可退出
 * - 删除群聊：仅 owner 可删除
 * - 静音切换
 *
 * API：
 *  - PATCH  /api/v1/workspaces/{wid}/conversations/{cid}              更新会话
 *  - GET    /api/v1/workspaces/{wid}/conversations/{cid}/members      成员列表
 *  - POST   /api/v1/workspaces/{wid}/conversations/{cid}/members      添加成员
 *  - DELETE /api/v1/workspaces/{wid}/conversations/{cid}/members/{uid} 移除成员
 *  - PATCH  /api/v1/workspaces/{wid}/conversations/{cid}/members/{uid} 更新角色
 *  - DELETE /api/v1/workspaces/{wid}/conversations/{cid}              删除/退出
 *
 * 所有样式走 design token（var(--*)），无裸 hex。
 * lucide-react 图标尺寸用 14/16（项目约定）。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  X,
  Users,
  UserPlus,
  UserMinus,
  Crown,
  Shield,
  LogOut,
  Trash2,
  Search,
  Loader2,
  Bell,
  BellOff,
  Check,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import type { Conversation, ConversationMember, UserSummary } from "./types";

/** 可选成员（工作区成员，用于添加成员时列出候选） */
interface WorkspaceMember {
  userId: string;
  role: string;
  user: UserSummary;
}

interface ConversationSettingsProps {
  /** 当前会话 */
  conversation: Conversation;
  /** 当前用户 ID */
  currentUserId: string;
  /** 关闭面板回调 */
  onClose: () => void;
  /** 更新后刷新会话列表 */
  onUpdate: () => void;
  /** 退出/删除后跳转 */
  onLeave: () => void;
}

export function ConversationSettings({
  conversation,
  currentUserId,
  onClose,
  onUpdate,
  onLeave,
}: ConversationSettingsProps) {
  const t = useTranslations("chat");
  const wid = conversation.workspaceId;
  const cid = conversation.id;

  const [members, setMembers] = useState<ConversationMember[]>(conversation.members);
  const [title, setTitle] = useState(conversation.title ?? "");
  const [description, setDescription] = useState(conversation.description ?? "");
  const [muted, setMuted] = useState<boolean>(
    conversation.members.find((m) => m.userId === currentUserId)?.muted ?? false,
  );
  const [savingInfo, setSavingInfo] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // 添加成员相关状态
  const [addOpen, setAddOpen] = useState(false);
  const [addCandidates, setAddCandidates] = useState<WorkspaceMember[]>([]);
  const [addLoading, setAddLoading] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [addSelected, setAddSelected] = useState<Set<string>>(new Set());

  // 当前用户在该会话中的角色
  const myRole = useMemo(
    () => members.find((m) => m.userId === currentUserId)?.role ?? "member",
    [members, currentUserId],
  );
  const canManage = myRole === "owner" || myRole === "admin";
  const isOwner = myRole === "owner";
  const isGroup = conversation.type === "group";

  // ESC 关闭
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (addOpen) setAddOpen(false);
        else onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addOpen, onClose]);

  /** 拉取最新成员列表 */
  const refreshMembers = useCallback(async () => {
    setLoadingMembers(true);
    try {
      const list = await api<ConversationMember[]>(
        `/api/v1/workspaces/${wid}/conversations/${cid}/members`,
      );
      setMembers(list ?? []);
    } catch {
      // 静默忽略，使用现有成员
    } finally {
      setLoadingMembers(false);
    }
  }, [wid, cid]);

  /** 保存群信息（群名/描述） */
  const handleSaveInfo = useCallback(async () => {
    setSavingInfo(true);
    setError(null);
    try {
      await api(`/api/v1/workspaces/${wid}/conversations/${cid}`, {
        method: "PATCH",
        body: JSON.stringify({ title: title.trim(), description: description.trim() }),
      });
      setSuccessMsg(t("settingsSaved"));
      onUpdate();
      setTimeout(() => setSuccessMsg(null), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settingsSaveFailed"));
    } finally {
      setSavingInfo(false);
    }
  }, [wid, cid, title, description, onUpdate, t]);

  /** 切换静音 */
  const handleToggleMute = useCallback(async () => {
    const next = !muted;
    setMuted(next);
    try {
      await api(`/api/v1/workspaces/${wid}/conversations/${cid}/members/${currentUserId}`, {
        method: "PATCH",
        body: JSON.stringify({ muted: next }),
      });
    } catch {
      // 回滚
      setMuted(!next);
      setError(t("settingsMuteFailed"));
    }
  }, [wid, cid, currentUserId, muted, t]);

  /** 更改成员角色 */
  const handleChangeRole = useCallback(
    async (userId: string, role: "owner" | "admin" | "member") => {
      setError(null);
      try {
        await api(`/api/v1/workspaces/${wid}/conversations/${cid}/members/${userId}`, {
          method: "PATCH",
          body: JSON.stringify({ role }),
        });
        await refreshMembers();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("settingsRoleFailed"));
      }
    },
    [wid, cid, refreshMembers, t],
  );

  /** 移除成员 */
  const handleRemoveMember = useCallback(
    async (userId: string) => {
      setError(null);
      try {
        await api(
          `/api/v1/workspaces/${wid}/conversations/${cid}/members/${userId}`,
          { method: "DELETE" },
        );
        setMembers((prev) => prev.filter((m) => m.userId !== userId));
      } catch (err) {
        setError(err instanceof Error ? err.message : t("settingsRemoveFailed"));
      }
    },
    [wid, cid, t],
  );

  /** 打开添加成员面板 */
  const openAddPanel = useCallback(async () => {
    setAddOpen(true);
    setAddSelected(new Set());
    setAddQuery("");
    setAddLoading(true);
    try {
      const list = await api<WorkspaceMember[]>(`/api/v1/workspaces/${wid}/members`);
      // 排除已在会话中的成员
      const existingIds = new Set(members.map((m) => m.userId));
      setAddCandidates((list ?? []).filter((m) => !existingIds.has(m.userId)));
    } catch {
      setError(t("createLoadMembersFailed"));
    } finally {
      setAddLoading(false);
    }
  }, [wid, members, t]);

  /** 提交添加成员 */
  const handleAddMembers = useCallback(async () => {
    if (addSelected.size === 0) return;
    setError(null);
    try {
      await api(`/api/v1/workspaces/${wid}/conversations/${cid}/members`, {
        method: "POST",
        body: JSON.stringify({ userIds: Array.from(addSelected) }),
      });
      setAddOpen(false);
      await refreshMembers();
      onUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settingsAddFailed"));
    }
  }, [wid, cid, addSelected, refreshMembers, onUpdate, t]);

  /** 退出/删除会话 */
  const handleLeave = useCallback(async () => {
    setError(null);
    try {
      await api(`/api/v1/workspaces/${wid}/conversations/${cid}`, {
        method: "DELETE",
      });
      onLeave();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settingsLeaveFailed"));
    }
  }, [wid, cid, onLeave, t]);

  /** 添加成员候选过滤 */
  const filteredCandidates = useMemo(() => {
    const q = addQuery.trim().toLowerCase();
    if (!q) return addCandidates;
    return addCandidates.filter((m) => {
      const name = m.user.name?.toLowerCase() ?? "";
      const email = m.user.email?.toLowerCase() ?? "";
      return name.includes(q) || email.includes(q);
    });
  }, [addCandidates, addQuery]);

  /** 渲染角色徽章 */
  const renderRoleBadge = (role: "owner" | "admin" | "member") => {
    if (role === "owner") {
      return (
        <span className="inline-flex items-center gap-1 text-[length:var(--text-xs)] text-[var(--warn)]">
          <Crown size={12} />
          {t("roleOwner")}
        </span>
      );
    }
    if (role === "admin") {
      return (
        <span className="inline-flex items-center gap-1 text-[length:var(--text-xs)] text-[var(--accent)]">
          <Shield size={12} />
          {t("roleAdmin")}
        </span>
      );
    }
    return (
      <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
        {t("roleMember")}
      </span>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={t("settings")}
    >
      {/* 遮罩 */}
      <div
        className="absolute inset-0 bg-[var(--overlay)]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* 侧滑面板 */}
      <div className="relative w-full max-w-md h-full flex flex-col bg-[var(--surface)] border-l border-[var(--border)] shadow-[var(--elev-lg)]">
        {/* 头部 */}
        <div className="flex items-center justify-between px-[var(--space-4)] py-[var(--space-3)] border-b border-[var(--border)]">
          <h2 className="text-[length:var(--text-base)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
            {t("settings")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("cancel")}
            className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-md)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* 群聊信息（仅群聊可编辑） */}
          {isGroup && (
            <section className="px-[var(--space-4)] py-[var(--space-4)] border-b border-[var(--border)]">
              <h3 className="text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg-2)] mb-[var(--space-3)]">
                {t("groupInfo")}
              </h3>
              <div className="space-y-[var(--space-3)]">
                <div>
                  <label className="block text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] mb-[var(--space-1)]">
                    {t("groupName")}
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    disabled={!canManage}
                    maxLength={100}
                    className="w-full h-9 px-[var(--space-3)] border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:border-[var(--accent)] placeholder:text-[var(--meta)] disabled:opacity-60 transition-colors duration-[var(--motion-fast)]"
                  />
                </div>
                <div>
                  <label className="block text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] mb-[var(--space-1)]">
                    {t("groupDescription")}
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    disabled={!canManage}
                    rows={3}
                    maxLength={500}
                    className="w-full px-[var(--space-3)] py-[var(--space-2)] border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:border-[var(--accent)] placeholder:text-[var(--meta)] resize-none disabled:opacity-60 transition-colors duration-[var(--motion-fast)]"
                  />
                </div>
                {canManage && (
                  <button
                    type="button"
                    onClick={handleSaveInfo}
                    disabled={savingInfo}
                    className="h-9 px-[var(--space-4)] rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] flex items-center gap-[var(--space-2)]"
                  >
                    {savingInfo && <Loader2 size={14} className="animate-spin" />}
                    {t("save")}
                  </button>
                )}
              </div>
            </section>
          )}

          {/* 静音切换 */}
          <section className="px-[var(--space-4)] py-[var(--space-3)] border-b border-[var(--border)]">
            <button
              type="button"
              onClick={handleToggleMute}
              className="w-full flex items-center justify-between gap-[var(--space-3)] py-[var(--space-1)]"
            >
              <span className="flex items-center gap-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--fg)]">
                {muted ? <BellOff size={16} className="text-[var(--muted)]" /> : <Bell size={16} className="text-[var(--fg-2)]" />}
                {muted ? t("unmuteNotifications") : t("muteNotifications")}
              </span>
              <span
                className={`relative w-9 h-5 rounded-full transition-colors duration-[var(--motion-base)] ${
                  muted ? "bg-[var(--accent)]" : "bg-[var(--surface-3)]"
                }`}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-[var(--surface)] shadow-[var(--elev-sm)] transition-transform duration-[var(--motion-base)] ${
                    muted ? "translate-x-4" : "translate-x-0.5"
                  }`}
                />
              </span>
            </button>
          </section>

          {/* 成员列表 */}
          <section className="px-[var(--space-4)] py-[var(--space-4)] border-b border-[var(--border)]">
            <div className="flex items-center justify-between mb-[var(--space-3)]">
              <h3 className="flex items-center gap-[var(--space-2)] text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg-2)]">
                <Users size={14} />
                {t("memberCount", { count: members.length })}
              </h3>
              {isGroup && canManage && (
                <button
                  type="button"
                  onClick={openAddPanel}
                  className="flex items-center gap-[var(--space-1)] px-[var(--space-2)] py-[var(--space-1)] rounded-[var(--radius-sm)] text-[length:var(--text-xs)] text-[var(--accent)] hover:bg-[var(--accent-soft)] transition-colors duration-[var(--motion-fast)]"
                >
                  <UserPlus size={14} />
                  {t("addMember")}
                </button>
              )}
            </div>

            {loadingMembers ? (
              <div className="flex items-center justify-center py-[var(--space-4)] text-[var(--muted)]">
                <Loader2 size={14} className="animate-spin" />
              </div>
            ) : (
              <ul className="space-y-[var(--space-1)]">
                {members.map((m) => {
                  const name = m.user.name ?? m.user.email ?? t("unknownUser");
                  const isSelf = m.userId === currentUserId;
                  return (
                    <li
                      key={m.userId}
                      className="flex items-center gap-[var(--space-3)] px-[var(--space-2)] py-[var(--space-2)] rounded-[var(--radius-md)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
                    >
                      {/* 头像 */}
                      <span className="shrink-0 w-8 h-8 rounded-full bg-[var(--surface-3)] flex items-center justify-center text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] overflow-hidden">
                        {m.user.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={m.user.image}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          name.charAt(0).toUpperCase()
                        )}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-[var(--space-2)]">
                          <span className="truncate text-[length:var(--text-sm)] text-[var(--fg)]">
                            {name}
                            {isSelf && (
                              <span className="ml-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--meta)]">
                                ({t("settingsMe")})
                              </span>
                            )}
                          </span>
                        </span>
                        <span className="mt-0.5 block">
                          {renderRoleBadge(m.role)}
                        </span>
                      </span>
                      {/* 管理操作 */}
                      {canManage && !isSelf && isGroup && (
                        <div className="flex items-center gap-[var(--space-1)]">
                          {/* 角色切换 */}
                          {m.role !== "admin" && (
                            <button
                              type="button"
                              onClick={() => handleChangeRole(m.userId, "admin")}
                              aria-label={t("makeAdmin")}
                              title={t("makeAdmin")}
                              className="w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-3)] hover:text-[var(--accent)] transition-colors duration-[var(--motion-fast)]"
                            >
                              <Shield size={14} />
                            </button>
                          )}
                          {m.role === "admin" && (
                            <button
                              type="button"
                              onClick={() => handleChangeRole(m.userId, "member")}
                              aria-label={t("makeMember")}
                              title={t("makeMember")}
                              className="w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-3)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
                            >
                              <UserMinus size={14} />
                            </button>
                          )}
                          {/* 移除成员 */}
                          <button
                            type="button"
                            onClick={() => handleRemoveMember(m.userId)}
                            aria-label={t("removeMember")}
                            title={t("removeMember")}
                            className="w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] transition-colors duration-[var(--motion-fast)]"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* 危险操作 */}
          <section className="px-[var(--space-4)] py-[var(--space-4)]">
            {isGroup && (
              <button
                type="button"
                onClick={handleLeave}
                className={`w-full flex items-center justify-center gap-[var(--space-2)] h-9 rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] transition-colors duration-[var(--motion-base)] ${
                  isOwner
                    ? "bg-[var(--danger)] text-[var(--accent-fg)] hover:bg-[var(--danger)]/90"
                    : "border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-2)]"
                }`}
              >
                {isOwner ? <Trash2 size={14} /> : <LogOut size={14} />}
                {isOwner ? t("deleteConversation") : t("leaveConversation")}
              </button>
            )}
          </section>
        </div>

        {/* 错误/成功提示 */}
        {(error || successMsg) && (
          <div className="px-[var(--space-4)] py-[var(--space-2)] border-t border-[var(--border)]">
            <p
              className={`text-[length:var(--text-xs)] ${
                error ? "text-[var(--danger)]" : "text-[var(--success)]"
              }`}
            >
              {error ?? successMsg}
            </p>
          </div>
        )}
      </div>

      {/* 添加成员子弹窗 */}
      {addOpen && (
        <div
          className="fixed inset-0 z-[calc(var(--z-modal)+1)] flex items-center justify-center p-[var(--space-4)]"
          role="dialog"
          aria-modal="true"
          aria-label={t("addMember")}
        >
          <div
            className="absolute inset-0 bg-[var(--overlay)]"
            onClick={() => setAddOpen(false)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-sm flex flex-col bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-lg)] max-h-[70vh]">
            <div className="flex items-center justify-between px-[var(--space-4)] py-[var(--space-3)] border-b border-[var(--border)]">
              <h3 className="text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
                {t("addMember")}
              </h3>
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                aria-label={t("cancel")}
                className="w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
              >
                <X size={14} />
              </button>
            </div>
            <div className="px-[var(--space-4)] pt-[var(--space-3)]">
              <div className="relative">
                <Search
                  size={14}
                  className="absolute left-[var(--space-3)] top-1/2 -translate-y-1/2 text-[var(--muted)] pointer-events-none"
                />
                <input
                  type="text"
                  value={addQuery}
                  onChange={(e) => setAddQuery(e.target.value)}
                  placeholder={t("selectMembers")}
                  className="w-full h-9 pl-9 pr-[var(--space-3)] border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)]"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-[var(--space-4)] py-[var(--space-3)]">
              {addLoading ? (
                <div className="flex items-center justify-center py-[var(--space-6)] text-[var(--muted)]">
                  <Loader2 size={14} className="animate-spin" />
                </div>
              ) : filteredCandidates.length === 0 ? (
                <div className="flex items-center justify-center py-[var(--space-6)] text-[length:var(--text-sm)] text-[var(--muted)]">
                  {t("createNoMembers")}
                </div>
              ) : (
                <ul className="space-y-[var(--space-1)]">
                  {filteredCandidates.map((m) => {
                    const isSel = addSelected.has(m.userId);
                    const name = m.user.name ?? m.user.email ?? t("unknownUser");
                    return (
                      <li key={m.userId}>
                        <button
                          type="button"
                          onClick={() =>
                            setAddSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(m.userId)) next.delete(m.userId);
                              else next.add(m.userId);
                              return next;
                            })
                          }
                          className={`w-full flex items-center gap-[var(--space-3)] px-[var(--space-3)] py-[var(--space-2)] rounded-[var(--radius-md)] text-left transition-colors duration-[var(--motion-fast)] ${
                            isSel ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--surface-2)]"
                          }`}
                        >
                          <span className="shrink-0 w-8 h-8 rounded-full bg-[var(--surface-3)] flex items-center justify-center text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
                            {m.user.image ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={m.user.image}
                                alt=""
                                className="w-full h-full object-cover rounded-full"
                              />
                            ) : (
                              name.charAt(0).toUpperCase()
                            )}
                          </span>
                          <span className="flex-1 truncate text-[length:var(--text-sm)] text-[var(--fg)]">
                            {name}
                          </span>
                          {isSel && <Check size={16} className="text-[var(--accent)]" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="flex items-center justify-end gap-[var(--space-2)] px-[var(--space-4)] py-[var(--space-3)] border-t border-[var(--border)]">
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="h-9 px-[var(--space-4)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={handleAddMembers}
                disabled={addSelected.size === 0}
                className="h-9 px-[var(--space-4)] rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)]"
              >
                {t("addMember")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}