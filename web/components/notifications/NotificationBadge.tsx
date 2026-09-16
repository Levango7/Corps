"use client";

/**
 * 通知徽章组件
 *
 * 功能：
 *  - 显示未读通知数量
 *  - 点击展开通知列表
 *  - 标记单条已读
 *  - 标记全部已读
 *
 * 数据来源：GET /api/v1/notifications/unread?workspaceId=xxx
 * 样式：design token（var(--*)），lucide-react 图标 size 14/16
 * i18n：useTranslations("notifications")
 *
 * 经验来源：2026-09-16-ai-assist-dialog-editable-results-batch-create-pattern
 *  - 样式全用 var(--fg)、var(--muted)、var(--surface) 等 token，不写裸 hex
 *  - lucide-react 图标 size 14 或 16
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Bell, Check, CheckCheck, Loader2, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";

/** 未读通知项 */
interface NotificationItem {
  id: string;
  type: string;
  entityId: string;
  entityTitle: string;
  read: boolean;
  createdAt: string;
}

/** 未读通知响应 */
interface UnreadResponse {
  total: number;
  items: NotificationItem[];
}

interface NotificationBadgeProps {
  /** 工作区 ID（用于查询工作区内未读通知） */
  workspaceId: string;
}

export function NotificationBadge({ workspaceId }: NotificationBadgeProps) {
  const t = useTranslations("notifications");

  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);

  // AbortController：组件卸载时中止进行中的请求
  const abortRef = useRef<AbortController | null>(null);

  /** 加载未读通知 */
  const loadUnread = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoading(true);
    setError(null);
    try {
      const data = await api<UnreadResponse>(
        `/api/v1/notifications/unread?workspaceId=${workspaceId}&limit=20`,
        { signal: ac.signal },
      );
      if (ac.signal.aborted) return;
      setTotal(data.total);
      setItems(data.items);
    } catch (e) {
      if (ac.signal.aborted) return;
      if (e instanceof Error && e.name === "AbortError") return;
      setError(t("error"));
      if (process.env.NODE_ENV === "development") {
        console.error("[NotificationBadge] load error:", e);
      }
    } finally {
      if (!ac.signal.aborted) {
        setLoading(false);
      }
    }
  }, [workspaceId, t]);

  // 初始加载 + workspaceId 变化时重新加载
  useEffect(() => {
    void loadUnread();
    return () => abortRef.current?.abort();
  }, [loadUnread]);

  /** 标记单条已读 */
  const handleMarkRead = useCallback(
    async (id: string) => {
      setMarkingId(id);
      try {
        await api(`/api/v1/notifications/${id}?workspaceId=${workspaceId}`, {
          method: "PATCH",
          body: JSON.stringify({ read: true }),
        });
        // 本地更新：移除已读项，减少总数
        setItems((prev) => prev.filter((n) => n.id !== id));
        setTotal((prev) => Math.max(0, prev - 1));
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          setError(t("error"));
        } else {
          setError(t("error"));
        }
        if (process.env.NODE_ENV === "development") {
          console.error("[NotificationBadge] mark read error:", e);
        }
      } finally {
        setMarkingId(null);
      }
    },
    [workspaceId, t],
  );

  /** 标记全部已读 */
  const handleMarkAllRead = useCallback(async () => {
    if (items.length === 0) return;
    try {
      // 逐条标记已读（API 无批量端点，并行发送）
      await Promise.all(
        items.map((n) =>
          api(`/api/v1/notifications/${n.id}?workspaceId=${workspaceId}`, {
            method: "PATCH",
            body: JSON.stringify({ read: true }),
          }),
        ),
      );
      setItems([]);
      setTotal(0);
    } catch (e) {
      setError(t("error"));
      if (process.env.NODE_ENV === "development") {
        console.error("[NotificationBadge] mark all read error:", e);
      }
    }
  }, [items, workspaceId, t]);

  /** 格式化通知类型文本 */
  const formatType = (type: string): string => {
    switch (type) {
      case "mention":
        return t("mentionText", { title: "" }).trim();
      case "task_assigned":
        return t("assignedText", { title: "" }).trim();
      case "task_updated":
        return t("updatedText", { title: "" }).trim();
      case "comment_added":
        return t("commentText", { title: "" }).trim();
      case "decision_updated":
        return t("decisionText", { title: "" }).trim();
      default:
        return type;
    }
  };

  return (
    <div className="relative">
      {/* 铃铛按钮 */}
      <button
        type="button"
        onClick={() => {
          setOpen(!open);
          if (!open) void loadUnread();
        }}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[var(--fg)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
        aria-label={t("title")}
        aria-expanded={open}
      >
        <Bell size={16} />
        {total > 0 && (
          <span
            className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--danger)] px-1 text-[length:var(--text-xs)] font-[weight:var(--weight-semibold)] text-[var(--danger-fg)]"
            aria-label={t("unreadCount", { count: total })}
          >
            {total > 99 ? "99+" : total}
          </span>
        )}
      </button>

      {/* 下拉面板 */}
      {open && (
        <>
          {/* 点击外部关闭 */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />

          <div
            className="absolute right-0 top-full z-20 mt-[var(--space-2)] w-80 max-w-[calc(100vw-2rem)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] shadow-lg"
            role="dialog"
            aria-label={t("title")}
          >
            {/* 头部 */}
            <div className="flex items-center justify-between border-b border-[var(--border)] px-[var(--space-4)] py-[var(--space-3)]">
              <div className="flex items-center gap-[var(--space-2)]">
                <Bell size={14} className="text-[var(--accent)]" />
                <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
                  {t("title")}
                </span>
                {total > 0 && (
                  <span className="text-[length:var(--text-xs)] text-[var(--muted)]">
                    ({total})
                  </span>
                )}
              </div>
              <div className="flex items-center gap-[var(--space-1)]">
                {total > 0 && (
                  <button
                    type="button"
                    onClick={handleMarkAllRead}
                    className="inline-flex items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] px-[var(--space-2)] py-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--muted)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
                    aria-label={t("markAllRead")}
                  >
                    <CheckCheck size={14} />
                    <span>{t("markAllRead")}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
                  aria-label="Close"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* 内容 */}
            <div className="max-h-80 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center px-[var(--space-4)] py-[var(--space-6)] text-[length:var(--text-sm)] text-[var(--muted)]">
                  <Loader2 size={14} className="animate-spin" />
                  <span className="ml-[var(--space-2)]">{t("loading")}</span>
                </div>
              ) : error ? (
                <div className="px-[var(--space-4)] py-[var(--space-6)] text-center text-[length:var(--text-sm)] text-[var(--danger)]">
                  {error}
                </div>
              ) : items.length === 0 ? (
                <div className="px-[var(--space-4)] py-[var(--space-6)] text-center text-[length:var(--text-sm)] text-[var(--muted)]">
                  {t("noUnreadNotifications")}
                </div>
              ) : (
                <ul className="divide-y divide-[var(--border)]">
                  {items.map((n) => (
                    <li
                      key={n.id}
                      className="flex items-start gap-[var(--space-3)] px-[var(--space-4)] py-[var(--space-3)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-2)]"
                    >
                      <div className="flex-1 overflow-hidden">
                        <p className="text-[length:var(--text-sm)] text-[var(--fg)]">
                          <span className="font-[weight:var(--weight-medium)]">
                            {formatType(n.type)}
                          </span>{" "}
                          {n.entityTitle}
                        </p>
                        <p className="mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--muted)]">
                          {new Date(n.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleMarkRead(n.id)}
                        disabled={markingId === n.id}
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-3)] hover:text-[var(--success)] disabled:opacity-50"
                        aria-label={t("markRead")}
                      >
                        {markingId === n.id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Check size={14} />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default NotificationBadge;