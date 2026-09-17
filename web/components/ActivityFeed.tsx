"use client";

/**
 * M4 实时协作基础：实时活动流组件
 *
 * 职责：
 * - 拉取 /api/v1/workspaces/{wid}/activity 获取最近活动列表
 * - 展示谁创建了任务、谁更新了状态、谁评论了、谁创建了决策等
 * - 自动刷新：每 30 秒重新拉取
 * - 手动刷新按钮
 * - lucide-react 图标（Activity/MessageSquare/CheckCircle 等）尺寸 14
 * - 所有样式走 design token（var(--*)），无裸 hex
 *
 * 活动类型图标映射：
 *  - task.created → Plus（新建）
 *  - task.updated → CheckCircle（更新）
 *  - comment.created → MessageSquare（评论）
 *  - decision.created → GitBranch（决策）
 *  - decision.updated → GitBranch（决策更新）
 *
 * 用法：
 *   <ActivityFeed wid={wid} />
 *   <ActivityFeed wid={wid} autoRefresh={false} />
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import {
  Activity as ActivityIcon,
  MessageSquare,
  CheckCircle2,
  Plus,
  GitBranch,
  RefreshCw,
} from "lucide-react";
import { api } from "@/lib/api";

/** 自动刷新间隔：30 秒 */
const REFRESH_INTERVAL_MS = 30 * 1000;

/** 活动项（与 activity GET 响应 data.items 对齐） */
interface Activity {
  id: string;
  type:
    | "task.created"
    | "task.updated"
    | "comment.created"
    | "decision.created"
    | "decision.updated";
  actorId: string | null;
  actorName: string | null;
  entityType: "task" | "comment" | "decision";
  entityId: string;
  entityTitle: string;
  createdAt: string;
}

/** activity GET 响应 data */
interface ActivityData {
  items: Activity[];
  nextCursor: string | null;
}

interface ActivityFeedProps {
  /** 工作区 ID */
  wid: string;
  /** 是否自动刷新，默认 true */
  autoRefresh?: boolean;
  /** 最多显示多少条活动，默认 20 */
  limit?: number;
}

/** 活动类型 → 图标 + 文案 key 映射 */
const ACTIVITY_META: Record<
  Activity["type"],
  { icon: typeof Plus; labelKey: "taskCreated" | "taskUpdated" | "commentCreated" | "decisionCreated" | "decisionUpdated" }
> = {
  "task.created": { icon: Plus, labelKey: "taskCreated" },
  "task.updated": { icon: CheckCircle2, labelKey: "taskUpdated" },
  "comment.created": { icon: MessageSquare, labelKey: "commentCreated" },
  "decision.created": { icon: GitBranch, labelKey: "decisionCreated" },
  "decision.updated": { icon: GitBranch, labelKey: "decisionUpdated" },
};

/** 相对时间格式化（与项目现有约定一致：刚刚 / N 分钟前 / N 小时前 / N 天前） */
function formatRelativeTime(iso: string, locale: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHour = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) return locale === "zh" ? "刚刚" : "just now";
  if (diffMin < 60) return locale === "zh" ? `${diffMin} 分钟前` : `${diffMin}m ago`;
  if (diffHour < 24) return locale === "zh" ? `${diffHour} 小时前` : `${diffHour}h ago`;
  if (diffDay < 7) return locale === "zh" ? `${diffDay} 天前` : `${diffDay}d ago`;
  // 超过 7 天显示绝对日期
  return new Date(iso).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US");
}

export default function ActivityFeed({
  wid,
  autoRefresh = true,
  limit = 20,
}: ActivityFeedProps) {
  const t = useTranslations("activity");
  // next-intl 暴露当前 locale（用于相对时间格式化）
  const locale = useLocale();
  const [data, setData] = useState<ActivityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** 拉取活动列表 */
  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      try {
        const result = await api<ActivityData>(`/api/v1/workspaces/${wid}/activity`);
        setData(result);
        setError(false);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [wid],
  );

  useEffect(() => {
    load();
    if (autoRefresh) {
      refreshTimerRef.current = setInterval(() => load(true), REFRESH_INTERVAL_MS);
    }
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [load, autoRefresh]);

  /** 手动刷新 */
  const handleRefresh = () => load(true);

  if (loading) {
    // 骨架屏
    return (
      <div className="flex flex-col gap-[var(--space-2)]" aria-busy="true" aria-label={t("loading")}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-2)]"
          >
            <span className="h-4 w-4 rounded-full bg-[var(--surface-hover)] animate-pulse" />
            <span className="h-3 flex-1 rounded bg-[var(--surface-hover)] animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (error && !data) {
    return (
      <div
        className="flex items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--muted)]"
        role="status"
        aria-live="polite"
      >
        <ActivityIcon size={14} aria-hidden />
        <span>{t("loadFailed")}</span>
        <button
          type="button"
          onClick={handleRefresh}
          className="ml-auto inline-flex items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] px-[var(--space-2)] py-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--accent-fg)] bg-[var(--accent)] hover:opacity-80"
        >
          <RefreshCw size={14} aria-hidden />
          {t("refresh")}
        </button>
      </div>
    );
  }

  const items = (data?.items ?? []).slice(0, limit);

  return (
    <div className="flex flex-col gap-[var(--space-2)]">
      {/* 头部：标题 + 刷新按钮 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-[var(--space-2)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
          <ActivityIcon size={14} className="text-[var(--muted)]" aria-hidden />
          <span>{t("title")}</span>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] px-[var(--space-2)] py-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--muted)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
          aria-label={t("refresh")}
        >
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} aria-hidden />
          {t("refresh")}
        </button>
      </div>

      {/* 活动列表 */}
      {items.length === 0 ? (
        <div className="flex items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--muted)]">
          <ActivityIcon size={14} aria-hidden />
          <span>{t("empty")}</span>
        </div>
      ) : (
        <ul className="flex flex-col gap-[var(--space-1)]" role="feed" aria-label={t("title")}>
          {items.map((activity) => {
            const meta = ACTIVITY_META[activity.type];
            const Icon = meta.icon;
            return (
              <li
                key={activity.id}
                className="flex items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-2)] text-[length:var(--text-sm)]"
              >
                <Icon size={14} className="shrink-0 text-[var(--muted)]" aria-hidden />
                <span className="flex-1 truncate">
                  <span className="font-[weight:var(--weight-medium)] text-[var(--fg)]">
                    {activity.actorName ?? t("unknownUser")}
                  </span>
                  <span className="text-[var(--muted)]"> {t(meta.labelKey)} </span>
                  <span className="font-[weight:var(--weight-medium)] text-[var(--fg)]">
                    {activity.entityTitle}
                  </span>
                </span>
                <time
                  className="shrink-0 text-[length:var(--text-xs)] text-[var(--muted)]"
                  dateTime={activity.createdAt}
                >
                  {formatRelativeTime(activity.createdAt, locale)}
                </time>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}