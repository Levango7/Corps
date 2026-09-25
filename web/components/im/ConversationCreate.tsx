"use client";

/**
 * 创建会话弹窗
 *
 * - 切换单聊/群聊模式
 * - 成员搜索框（实时过滤工作区成员）
 * - 已选成员列表（可移除）
 * - 单聊：选 1 个成员（加自己共 2 人）
 * - 群聊：选 2+ 个成员，输入群名
 * - 确认/取消按钮
 *
 * API：
 *  - GET  /api/v1/workspaces/{wid}/members        加载工作区成员
 *  - POST /api/v1/workspaces/{wid}/conversations   创建会话
 *
 * 所有样式走 design token（var(--*)），无裸 hex。
 * lucide-react 图标尺寸用 14/16（项目约定）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, X, Users, User, Loader2, Check, AlertCircle, ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import type { UserSummary, Conversation } from "./types";

/** 工作区成员项（与 /workspaces/{wid}/members 响应对齐） */
interface WorkspaceMember {
  userId: string;
  role: string;
  user: UserSummary;
}

interface ConversationCreateProps {
  /** 当前工作区 ID */
  workspaceId: string;
  /** 当前用户 ID（用于从成员列表中排除自己） */
  currentUserId: string;
  /** 已有会话列表（用于单聊去重检查） */
  conversations: Conversation[];
  /** 创建成功回调 */
  onCreated: (conversationId: string) => void;
  /** 关闭弹窗回调 */
  onClose: () => void;
}

export function ConversationCreate({
  workspaceId,
  currentUserId,
  conversations,
  onCreated,
  onClose,
}: ConversationCreateProps) {
  const t = useTranslations("chat");
  const [mode, setMode] = useState<"direct" | "group">("direct");
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [groupTitle, setGroupTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // 加载工作区成员列表
  useEffect(() => {
    let active = true;
    setLoading(true);
    api<WorkspaceMember[]>(`/api/v1/workspaces/${workspaceId}/members`)
      .then((list) => {
        if (!active) return;
        // 排除自己
        setMembers((list ?? []).filter((m) => m.userId !== currentUserId));
      })
      .catch(() => {
        if (!active) return;
        setError(t("createLoadMembersFailed"));
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [workspaceId, currentUserId, t]);

  // 打开时聚焦搜索框
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  // ESC 关闭
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 实时过滤成员
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => {
      const name = m.user.name?.toLowerCase() ?? "";
      const email = m.user.email?.toLowerCase() ?? "";
      return name.includes(q) || email.includes(q);
    });
  }, [members, query]);

  /** 切换模式：切换单聊/群聊时清空已选 */
  const handleModeChange = useCallback((next: "direct" | "group") => {
    setMode(next);
    setSelected(new Set());
    setError(null);
  }, []);

  /** 切换成员选中态 */
  const toggleMember = useCallback(
    (userId: string) => {
      setError(null);
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(userId)) {
          next.delete(userId);
          return next;
        }
        if (mode === "direct") {
          // 单聊：只保留一个
          return new Set([userId]);
        }
        // 群聊：允许多选
        next.add(userId);
        return next;
      });
    },
    [mode],
  );

  /** 移除已选成员 */
  const removeSelected = useCallback((userId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(userId);
      return next;
    });
  }, []);

  /** 已选成员详情列表 */
  const selectedMembers = useMemo(
    () => members.filter((m) => selected.has(m.userId)),
    [members, selected],
  );

  /** 单聊去重：检查是否已存在与选中成员的 direct 会话 */
  const existingDirectConversation = useMemo(() => {
    if (mode !== "direct" || selected.size !== 1) return null;
    const targetUserId = Array.from(selected)[0];
    return (
      conversations.find(
        (conv) =>
          conv.type === "direct" &&
          conv.members.some((m) => m.userId === targetUserId) &&
          conv.members.some((m) => m.userId === currentUserId),
      ) ?? null
    );
  }, [mode, selected, conversations, currentUserId]);

  /** 是否可提交 */
  const canSubmit = useMemo(() => {
    if (submitting) return false;
    if (mode === "direct") return selected.size === 1;
    return selected.size >= 2 && groupTitle.trim().length > 0;
  }, [mode, selected, groupTitle, submitting]);

  /** 提交创建会话 */
  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        type: mode,
        memberIds: Array.from(selected),
      };
      if (mode === "group") body.title = groupTitle.trim();
      const conv = await api<{ id: string }>(`/api/v1/workspaces/${workspaceId}/conversations`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      onCreated(conv.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("createFailed"));
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, mode, selected, groupTitle, workspaceId, onCreated, t]);

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-[var(--space-4)]"
      role="dialog"
      aria-modal="true"
      aria-label={t("createConversation")}
    >
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-[var(--overlay)]" onClick={onClose} aria-hidden="true" />

      {/* 弹窗主体 */}
      <div className="relative w-full max-w-md flex flex-col bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-lg)] max-h-[80vh]">
        {/* 头部 */}
        <div className="flex items-center justify-between px-[var(--space-4)] py-[var(--space-3)] border-b border-[var(--border)]">
          <h2 className="text-[length:var(--text-base)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
            {t("createConversation")}
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

        {/* 模式切换 */}
        <div className="px-[var(--space-4)] pt-[var(--space-3)]">
          <div className="flex gap-[var(--space-1)] p-[var(--space-1)] rounded-[var(--radius-md)] bg-[var(--surface-2)]">
            <button
              type="button"
              onClick={() => handleModeChange("direct")}
              className={`flex-1 flex items-center justify-center gap-[var(--space-2)] py-[var(--space-2)] rounded-[var(--radius-sm)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] transition-colors duration-[var(--motion-fast)] ${
                mode === "direct"
                  ? "bg-[var(--surface)] text-[var(--fg)] shadow-[var(--elev-sm)]"
                  : "text-[var(--muted)] hover:text-[var(--fg-2)]"
              }`}
            >
              <User size={14} />
              {t("directMessage")}
            </button>
            <button
              type="button"
              onClick={() => handleModeChange("group")}
              className={`flex-1 flex items-center justify-center gap-[var(--space-2)] py-[var(--space-2)] rounded-[var(--radius-sm)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] transition-colors duration-[var(--motion-fast)] ${
                mode === "group"
                  ? "bg-[var(--surface)] text-[var(--fg)] shadow-[var(--elev-sm)]"
                  : "text-[var(--muted)] hover:text-[var(--fg-2)]"
              }`}
            >
              <Users size={14} />
              {t("groupMessage")}
            </button>
          </div>
        </div>

        {/* 群名输入（仅群聊） */}
        {mode === "group" && (
          <div className="px-[var(--space-4)] pt-[var(--space-3)]">
            <label className="block text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] mb-[var(--space-1)]">
              {t("groupName")}
            </label>
            <input
              type="text"
              value={groupTitle}
              onChange={(e) => setGroupTitle(e.target.value)}
              placeholder={t("groupNamePlaceholder")}
              maxLength={100}
              className="w-full h-9 px-[var(--space-3)] border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:border-[var(--accent)] placeholder:text-[var(--meta)] transition-colors duration-[var(--motion-fast)]"
            />
            {/* 群名验证提示：已选 2+ 成员但群名为空时显示 */}
            {selected.size >= 2 && groupTitle.trim().length === 0 && (
              <p className="mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--danger)]">
                {t("enterGroupName")}
              </p>
            )}
          </div>
        )}

        {/* 已选成员列表 */}
        {selectedMembers.length > 0 && (
          <div className="px-[var(--space-4)] pt-[var(--space-3)]">
            <div className="flex flex-wrap gap-[var(--space-1)]">
              {selectedMembers.map((m) => (
                <span
                  key={m.userId}
                  className="inline-flex items-center gap-[var(--space-1)] px-[var(--space-2)] py-[var(--space-1)] rounded-[var(--radius-pill)] bg-[var(--accent-soft)] text-[length:var(--text-xs)] text-[var(--accent-soft-fg)]"
                >
                  {m.user.name ?? m.user.email ?? t("unknownUser")}
                  <button
                    type="button"
                    onClick={() => removeSelected(m.userId)}
                    aria-label={t("removeMember")}
                    className="shrink-0 w-4 h-4 flex items-center justify-center rounded-full hover:bg-[var(--surface-3)]"
                  >
                    <X size={14} />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 单聊去重提示：已存在与该用户的会话 */}
        {existingDirectConversation && (
          <div className="px-[var(--space-4)] pt-[var(--space-3)]">
            <div className="flex items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[length:var(--text-xs)] text-[var(--danger)]">
              <AlertCircle size={14} className="shrink-0" />
              <span className="flex-1">{t("existingDirectConversation")}</span>
              <button
                type="button"
                onClick={() => onCreated(existingDirectConversation.id)}
                className="shrink-0 inline-flex items-center gap-[var(--space-1)] px-[var(--space-2)] py-[var(--space-1)] rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-fast)]"
              >
                {t("jumpToConversation")}
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* 搜索框 */}
        <div className="px-[var(--space-4)] pt-[var(--space-3)]">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-[var(--space-3)] top-1/2 -translate-y-1/2 text-[var(--muted)] pointer-events-none"
            />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("selectMembers")}
              className="w-full h-9 pl-9 pr-[var(--space-3)] border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:border-[var(--accent)] placeholder:text-[var(--meta)] transition-colors duration-[var(--motion-fast)]"
            />
          </div>
        </div>

        {/* 成员列表 */}
        <div className="flex-1 overflow-y-auto px-[var(--space-4)] py-[var(--space-3)]">
          {loading ? (
            <div className="flex items-center justify-center py-[var(--space-8)] text-[var(--muted)]">
              <Loader2 size={16} className="animate-spin" />
              <span className="ml-[var(--space-2)] text-[length:var(--text-sm)]">
                {t("createLoadingMembers")}
              </span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center py-[var(--space-8)] text-[length:var(--text-sm)] text-[var(--muted)]">
              {query ? t("createNoMatch") : t("createNoMembers")}
            </div>
          ) : (
            <ul className="space-y-[var(--space-1)]">
              {filtered.map((m) => {
                const isSel = selected.has(m.userId);
                const name = m.user.name ?? m.user.email ?? t("unknownUser");
                return (
                  <li key={m.userId}>
                    <button
                      type="button"
                      onClick={() => toggleMember(m.userId)}
                      className={`w-full flex items-center gap-[var(--space-3)] px-[var(--space-3)] py-[var(--space-2)] rounded-[var(--radius-md)] text-left transition-colors duration-[var(--motion-fast)] ${
                        isSel ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--surface-2)]"
                      }`}
                    >
                      {/* 头像 */}
                      <span className="shrink-0 w-8 h-8 rounded-full bg-[var(--surface-3)] flex items-center justify-center text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] overflow-hidden">
                        {m.user.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={m.user.image} alt="" className="w-full h-full object-cover" />
                        ) : (
                          name.charAt(0).toUpperCase()
                        )}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block truncate text-[length:var(--text-sm)] text-[var(--fg)]">
                          {name}
                        </span>
                        {m.user.email && (
                          <span className="block truncate text-[length:var(--text-xs)] text-[var(--meta)]">
                            {m.user.email}
                          </span>
                        )}
                      </span>
                      {isSel && <Check size={16} className="shrink-0 text-[var(--accent)]" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="px-[var(--space-4)] pb-[var(--space-2)]">
            <p className="text-[length:var(--text-xs)] text-[var(--danger)]">{error}</p>
          </div>
        )}

        {/* 底部按钮 */}
        <div className="flex items-center justify-end gap-[var(--space-2)] px-[var(--space-4)] py-[var(--space-3)] border-t border-[var(--border)]">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="h-9 px-[var(--space-4)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] disabled:opacity-50"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="h-9 px-[var(--space-4)] rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] flex items-center gap-[var(--space-2)]"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {t("create")}
          </button>
        </div>
      </div>
    </div>
  );
}
