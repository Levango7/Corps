"use client";

/**
 * ActivityWidget — 活动流卡片 Widget（用于 WidgetGrid）。
 *
 * 职责：
 * - 调用 /api/v1/workspaces/{wid}/activity 拉取最近活动列表
 * - 每条活动：头像（首字母占位）+ 用户名 + 动作 + 时间
 * - 紧凑布局，适配卡片网格场景（最多 5 条）
 * - 所有样式走 design token（var(--*)），无裸 hex
 * - lucide-react 图标 size 14
 *
 * 与 ActivityFeed 的区别：ActivityFeed 是独立全功能组件（自动刷新 / 分页 / i18n），
 * ActivityWidget 是轻量卡片版，专注 WidgetGrid 嵌入场景。
 *
 * 用法：
 *   <ActivityWidget wid={wid} />
 */

import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  CheckCircle2,
  MessageSquare,
  GitBranch,
  Activity as ActivityIcon,
} from "lucide-react";
import { api } from "@/lib/api";

/** 活动项（与 activity GET 响应 data.items 对齐） */
interface Activity {
  id: string;
  type:
    "task.created" | "task.updated" | "comment.created" | "decision.created" | "decision.updated";
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

interface ActivityWidgetProps {
  /** 工作区 ID */
  wid: string;
  /** 最多显示多少条活动，默认 5 */
  limit?: number;
}

/** 活动类型 → 图标 + 动作文案映射 */
const ACTIVITY_META: Record<Activity["type"], { icon: typeof Plus; label: string }> = {
  "task.created": { icon: Plus, label: "创建了任务" },
  "task.updated": { icon: CheckCircle2, label: "更新了任务" },
  "comment.created": { icon: MessageSquare, label: "评论了" },
  "decision.created": { icon: GitBranch, label: "创建了决策" },
  "decision.updated": { icon: GitBranch, label: "更新了决策" },
};

/** 相对时间格式化（刚刚 / N 分钟前 / N 小时前 / N 天前） */
function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHour = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin} 分钟前`;
  if (diffHour < 24) return `${diffHour} 小时前`;
  if (diffDay < 7) return `${diffDay} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
}

/** 头像占位：取用户名首字母（无用户名则用问号） */
function getInitial(name: string | null): string {
  if (!name) return "?";
  return name.charAt(0).toUpperCase();
}

/** 头像背景色：根据用户名 hash 分配语义色（避免裸 hex） */
function getAvatarColor(name: string | null): string {
  if (!name) return "var(--muted)";
  const colors = ["var(--accent)", "var(--success)", "var(--warn)", "var(--danger)"];
  const hash = name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

export default function ActivityWidget({ wid, limit = 5 }: ActivityWidgetProps) {
  const [data, setData] = useState<ActivityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api<ActivityData>(`/api/v1/workspaces/${wid}/activity`);
      setData(result);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [wid]);

  useEffect(() => {
    load();
  }, [load]);

  // 骨架屏
  if (loading) {
    return (
      <div
        className="flex flex-col gap-[var(--space-2)] p-[var(--space-3)]"
        aria-busy="true"
        aria-label="加载活动流"
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-[var(--space-2)]">
            <span className="h-6 w-6 rounded-full bg-[var(--surface-3)] animate-pulse" />
            <span className="h-3 flex-1 rounded bg-[var(--surface-3)] animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  // 错误态
  if (error && !data) {
    return (
      <div
        className="flex items-center gap-[var(--space-2)] p-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--muted)]"
        role="status"
        aria-live="polite"
      >
        <ActivityIcon size={14} aria-hidden />
        <span>活动加载失败</span>
      </div>
    );
  }

  const items = (data?.items ?? []).slice(0, limit);

  // 空状态
  if (items.length === 0) {
    return (
      <div className="flex items-center gap-[var(--space-2)] p-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--muted)]">
        <ActivityIcon size={14} aria-hidden />
        <span>暂无活动</span>
      </div>
    );
  }

  return (
    <ul
      className="flex flex-col gap-[var(--space-1)] p-[var(--space-3)]"
      role="feed"
      aria-label="最近活动"
    >
      {items.map((activity) => {
        const meta = ACTIVITY_META[activity.type];
        const Icon = meta.icon;
        const actorName = activity.actorName ?? "未知用户";
        return (
          <li
            key={activity.id}
            className="flex items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] px-[var(--space-1)] py-[var(--space-1)] hover:bg-[var(--surface-2)] transition-colors"
          >
            {/* 头像占位（首字母） */}
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--on-accent)]"
              style={{ background: getAvatarColor(activity.actorName) }}
              aria-hidden
            >
              {getInitial(activity.actorName)}
            </span>
            {/* 动作图标 */}
            <Icon size={14} className="shrink-0 text-[var(--muted)]" aria-hidden />
            {/* 文案：用户名 + 动作 + 实体标题 */}
            <span className="flex-1 truncate text-[length:var(--text-sm)]">
              <span className="font-[weight:var(--weight-medium)] text-[var(--fg)]">
                {actorName}
              </span>
              <span className="text-[var(--muted)]"> {meta.label} </span>
              <span className="text-[var(--fg-2)]">{activity.entityTitle}</span>
            </span>
            {/* 时间 */}
            <time
              className="shrink-0 text-[length:var(--text-xs)] text-[var(--meta)]"
              dateTime={activity.createdAt}
            >
              {formatRelativeTime(activity.createdAt)}
            </time>
          </li>
        );
      })}
    </ul>
  );
}
