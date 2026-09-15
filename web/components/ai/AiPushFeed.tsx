"use client";

/**
 * AI 主动推送消息流组件（方向 A）
 *
 * 功能：
 *  - 展示推送记录流（类似通知中心）
 *  - 每条记录显示标题、摘要、时间、已读/未读状态
 *  - 支持标记已读、按 capability 过滤
 *  - 未读记录高亮显示
 *
 * 样式全走 design token（var(--*)），lucide-react 图标尺寸 14/16。
 * 错误处理：catch 中用 t("error") / t("loadFailed")，不泄露 e.message。
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Bell,
  Check,
  Loader2,
  Inbox,
  AlertTriangle,
  TrendingDown,
  Sun,
} from "lucide-react";
import { api } from "@/lib/api";

/** 推送记录类型（与 Prisma AiPushRecord 对齐） */
interface PushRecord {
  id: string;
  scheduleId: string;
  workspaceId: string;
  userId: string;
  capability: string;
  title: string;
  summary: string;
  detail: unknown;
  read: boolean;
  createdAt: string;
}

/** 分页响应 */
interface RecordsResponse {
  items: PushRecord[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** capability 过滤选项 */
const FILTER_OPTIONS = [
  { value: "all", labelKey: "all" },
  { value: "daily_briefing", labelKey: "dailyBriefing" },
  { value: "risk_alert", labelKey: "riskAlert" },
  { value: "progress_anomaly", labelKey: "progressAnomaly" },
] as const;

/** capability → 图标映射 */
function CapabilityIcon({ capability, size }: { capability: string; size: number }) {
  switch (capability) {
    case "daily_briefing":
      return <Sun size={size} className="text-[var(--accent)]" />;
    case "risk_alert":
      return <AlertTriangle size={size} className="text-[var(--danger)]" />;
    case "progress_anomaly":
      return <TrendingDown size={size} className="text-[var(--warning, var(--accent))]" />;
    default:
      return <Bell size={size} className="text-[var(--meta)]" />;
  }
}

interface AiPushFeedProps {
  /** 工作区 ID */
  wid: string;
}

export function AiPushFeed({ wid }: AiPushFeedProps) {
  const t = useTranslations("aiPush");

  const [records, setRecords] = useState<PushRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);

  /** 加载推送记录（首页） */
  const loadRecords = useCallback(
    async (filterValue: string, unread: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ wid });
        if (unread) params.set("unread", "true");
        if (filterValue !== "all") params.set("capability", filterValue);
        params.set("limit", "20");

        const data = await api<RecordsResponse>(
          `/api/v1/ai/push/records?${params.toString()}`,
        );
        setRecords(data.items);
        setHasMore(data.hasMore);
        setCursor(data.nextCursor);
      } catch (e) {
        console.error("[AiPushFeed] load failed:", e);
        setError(t("loadFailed"));
      } finally {
        setLoading(false);
      }
    },
    [wid, t],
  );

  /** 加载更多（下一页） */
  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ wid, cursor });
      if (unreadOnly) params.set("unread", "true");
      if (filter !== "all") params.set("capability", filter);
      params.set("limit", "20");

      const data = await api<RecordsResponse>(
        `/api/v1/ai/push/records?${params.toString()}`,
      );
      setRecords((prev) => [...prev, ...data.items]);
      setHasMore(data.hasMore);
      setCursor(data.nextCursor);
    } catch (e) {
      console.error("[AiPushFeed] loadMore failed:", e);
      setError(t("error"));
    } finally {
      setLoadingMore(false);
    }
  }, [wid, cursor, filter, unreadOnly, loadingMore, t]);

  // 过滤条件变化时重新加载
  useEffect(() => {
    loadRecords(filter, unreadOnly);
  }, [filter, unreadOnly, loadRecords]);

  /** 标记已读 */
  const handleMarkRead = useCallback(
    async (record: PushRecord) => {
      if (record.read) return;
      setMarkingId(record.id);
      try {
        await api(`/api/v1/ai/push/records/${record.id}`, {
          method: "PATCH",
          body: JSON.stringify({ wid, read: true }),
        });
        // 本地更新状态，避免重新拉取
        setRecords((prev) =>
          prev.map((r) => (r.id === record.id ? { ...r, read: true } : r)),
        );
      } catch (e) {
        console.error("[AiPushFeed] markRead failed:", e);
        setError(t("error"));
      } finally {
        setMarkingId(null);
      }
    },
    [wid, t],
  );

  /** 格式化时间 */
  const formatTime = useCallback((createdAt: string): string => {
    const d = new Date(createdAt);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 1) return "刚刚";
    if (diffMin < 60) return `${diffMin} 分钟前`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour} 小时前`;
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay < 7) return `${diffDay} 天前`;
    return d.toLocaleDateString();
  }, []);

  /** 获取 capability 显示名称 */
  const capabilityLabel = useCallback(
    (cap: string): string => {
      const opt = FILTER_OPTIONS.find((o) => o.value === cap);
      return opt ? t(opt.labelKey) : cap;
    },
    [t],
  );

  return (
    <div className="flex h-full flex-col">
      {/* 顶部标题栏 */}
      <header className="flex items-center gap-[var(--space-3)] border-b border-[var(--border)] px-[var(--space-6)] py-[var(--space-4)]">
        <Bell size={16} className="text-[var(--accent)]" />
        <h1 className="text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
          {t("feed")}
        </h1>

        {/* 过滤控件 */}
        <div className="ml-auto flex items-center gap-[var(--space-3)]">
          {/* capability 过滤 */}
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-2)] py-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--fg)] transition-colors duration-[var(--motion-fast)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
          >
            {FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </option>
            ))}
          </select>

          {/* 未读过滤开关 */}
          <label className="flex items-center gap-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--fg-2)]">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(e) => setUnreadOnly(e.target.checked)}
              className="h-3.5 w-3.5 rounded-[var(--radius-sm)] border-[var(--border)] accent-[var(--accent)]"
            />
            {t("unread")}
          </label>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-[var(--space-6)] py-[var(--space-4)]">
        {error && (
          <div className="mb-[var(--space-4)] rounded-[var(--radius-md)] border border-[var(--danger)] bg-[var(--danger-soft)] px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--danger)]">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-[var(--space-8)]">
            <Loader2 size={20} className="animate-spin text-[var(--meta)] motion-reduce:animate-none" />
          </div>
        ) : records.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-[var(--space-2)] py-[var(--space-8)] text-center">
            <Inbox size={24} className="text-[var(--meta)]" />
            <p className="text-[length:var(--text-sm)] text-[var(--meta)]">
              {t("noRecords")}
            </p>
          </div>
        ) : (
          <>
            <ul className="flex flex-col gap-[var(--space-2)]">
              {records.map((record) => (
                <li
                  key={record.id}
                  className={`rounded-[var(--radius-md)] border px-[var(--space-4)] py-[var(--space-3)] transition-colors duration-[var(--motion-fast)] ${
                    record.read
                      ? "border-[var(--border-soft)] bg-[var(--surface)]"
                      : "border-[var(--accent)] bg-[var(--surface-2)]"
                  }`}
                >
                  <div className="flex items-start gap-[var(--space-3)]">
                    {/* capability 图标 */}
                    <CapabilityIcon capability={record.capability} size={16} />

                    <div className="min-w-0 flex-1">
                      {/* 标题行 */}
                      <div className="flex items-center gap-[var(--space-2)]">
                        <span
                          className={`truncate text-[length:var(--text-sm)] ${
                            record.read
                              ? "font-[weight:var(--weight-medium)] text-[var(--fg)]"
                              : "font-[weight:var(--weight-semibold)] text-[var(--fg)]"
                          }`}
                        >
                          {record.title}
                        </span>
                        {!record.read && (
                          <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                        )}
                      </div>

                      {/* 摘要 */}
                      {record.summary && (
                        <p className="mt-[var(--space-1)] line-clamp-2 text-[length:var(--text-xs)] text-[var(--fg-2)]">
                          {record.summary}
                        </p>
                      )}

                      {/* 元信息行 */}
                      <div className="mt-[var(--space-2)] flex items-center gap-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--meta)]">
                        <span>{capabilityLabel(record.capability)}</span>
                        <span>·</span>
                        <span>{formatTime(record.createdAt)}</span>
                      </div>
                    </div>

                    {/* 标记已读按钮 */}
                    {!record.read && (
                      <button
                        type="button"
                        onClick={() => handleMarkRead(record)}
                        disabled={markingId === record.id}
                        title={t("markRead")}
                        className="shrink-0 rounded-[var(--radius-sm)] p-[var(--space-1)] text-[var(--fg-2)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-2)] hover:text-[var(--success)] disabled:opacity-40"
                      >
                        {markingId === record.id ? (
                          <Loader2 size={14} className="animate-spin motion-reduce:animate-none" />
                        ) : (
                          <Check size={14} />
                        )}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {/* 加载更多 */}
            {hasMore && (
              <div className="mt-[var(--space-4)] flex justify-center">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="inline-flex items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--fg-2)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-2)] disabled:opacity-40"
                >
                  {loadingMore ? (
                    <Loader2 size={14} className="animate-spin motion-reduce:animate-none" />
                  ) : null}
                  {t("all")}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}