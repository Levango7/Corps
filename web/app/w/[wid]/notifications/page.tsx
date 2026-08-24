"use client";

/**
 * 通知中心 · /w/[wid]/notifications
 *
 * 列表型页面，参考概览页（w/[wid]/page.tsx）的布局与 token 体系：
 *  - 所有颜色走 var(--token)，无裸 hex
 *  - 图标统一来自 lucide-react
 *  - 间距 / 字号 / 圆角 / 阴影 / 动效全部走 token
 *
 * 数据流：
 *  - GET  /api/v1/workspaces/[wid]/notifications → { notifications: Notification[] }
 *  - PATCH /api/v1/workspaces/[wid]/notifications body { id?: string, all?: boolean } → 标记已读
 *
 * 交互：
 *  - 顶部 segmented 筛选（全部 / 未读），客户端过滤
 *  - 「全部已读」按钮仅在有未读时出现，乐观更新 + PATCH all=true
 *  - 单条点击：乐观标记已读 + 跳转 /w/[wid]/task/{entityId}
 *
 * 状态：
 *  - 加载中：NotificationListSkeleton 骨架屏
 *  - 空列表：Bell 图标 + 引导文案
 *  - 筛选未读无结果：精简空状态「没有未读通知」
 */

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AtSign,
  UserPlus,
  RefreshCw,
  MessageSquare,
  FileText,
  Bell,
  CheckCheck,
} from "lucide-react";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/Skeleton";

type NotificationType =
  "mention" | "task_assigned" | "task_updated" | "comment_added" | "decision_updated";

interface Notification {
  id: string;
  type: NotificationType;
  entityId: string;
  entityTitle: string;
  read: boolean;
  createdAt: string;
}

type Filter = "all" | "unread";

/**
 * 通知类型元数据：图标 + 图标色 + 文案模板。
 *
 * 颜色映射（遵循设计规范，已对齐项目实际 token）：
 *  - mention         → AtSign        · var(--accent)   （提到我）
 *  - task_assigned   → UserPlus      · var(--success)  （分配任务）
 *  - task_updated    → RefreshCw     · var(--accent)   （规范写 var(--info)，项目无 --info，用 --accent 代替）
 *  - comment_added   → MessageSquare · var(--warn)     （规范写 var(--warning)，项目 token 为 --warn）
 *  - decision_updated→ FileText      · var(--fg-2)     （决策更新）
 */
const TYPE_META: Record<
  NotificationType,
  { icon: typeof AtSign; color: string; text: (title: string) => string }
> = {
  mention: { icon: AtSign, color: "var(--accent)", text: (t) => `${t} 中提到了你` },
  task_assigned: { icon: UserPlus, color: "var(--success)", text: (t) => `你被分配到任务 ${t}` },
  task_updated: { icon: RefreshCw, color: "var(--accent)", text: (t) => `任务 ${t} 已更新` },
  comment_added: { icon: MessageSquare, color: "var(--warn)", text: (t) => `${t} 有新评论` },
  decision_updated: { icon: FileText, color: "var(--fg-2)", text: (t) => `${t} 的决策已更新` },
};

/** 相对时间戳：刚刚 / N 分钟前 / N 小时前 / N 天前 / 月-日（与概览页一致） */
function relativeTime(iso?: string): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const diff = Math.max(0, Date.now() - then);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "刚刚";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

export default function NotificationsPage({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = use(params);
  const router = useRouter();

  const [all, setAll] = useState<Notification[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await api<{ notifications: Notification[] }>(
        `/api/v1/workspaces/${wid}/notifications`,
      );
      setAll(res?.notifications ?? []);
    } catch (e) {
      setError(e instanceof Error && e.message.includes("fetch") ? "网络连接失败，请检查网络" : "加载失败，请稍后重试");
      setAll([]);
    } finally {
      setLoaded(true);
    }
  }, [wid]);

  useEffect(() => {
    load();
  }, [load]);

  const unreadCount = useMemo(() => all.filter((n) => !n.read).length, [all]);

  // 当前筛选下的可见列表，按 createdAt 降序
  const visible = useMemo(() => {
    const list = filter === "unread" ? all.filter((n) => !n.read) : all;
    return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [all, filter]);

  /** 全部已读：乐观更新本地，再 PATCH all=true；失败回滚重新加载 */
  async function markAllRead() {
    if (marking || unreadCount === 0) return;
    setMarking(true);
    setAll((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      await api(`/api/v1/workspaces/${wid}/notifications`, {
        method: "PATCH",
        body: JSON.stringify({ all: true }),
      });
    } catch {
      await load();
    } finally {
      setMarking(false);
    }
  }

  /** 单条点击：乐观标记已读（fire-and-forget）+ 跳转对应详情
   *  跳转目标按通知类型区分：
   *    - task_assigned / task_updated / comment_added / mention → 任务详情
   *    - decision_updated → 任务详情的决策区（hash 锚点 #decisions）
   *  所有通知的 entityId 均指向关联任务，故统一跳 /task/{entityId}，
   *  decision_updated 追加 #decisions 锚点以便定位到决策记录区。
   */
  function openNotification(n: Notification) {
    if (!n.read) {
      setAll((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      // 不阻塞跳转，失败时下次进入页面会重新加载纠正
      api(`/api/v1/workspaces/${wid}/notifications`, {
        method: "PATCH",
        body: JSON.stringify({ id: n.id }),
      }).catch(() => {});
    }
    const target = `/w/${wid}/task/${n.entityId}`;
    router.push(n.type === "decision_updated" ? `${target}#decisions` : target);
  }

  return (
    <div className="max-w-[700px] mx-auto">
      {/* 页头：标题 + 未读计数 badge */}
      <header className="flex items-end justify-between mb-[var(--space-6)] gap-[var(--space-4)]">
        <div className="flex items-center gap-[var(--space-3)]">
          <h1 className="text-[length:var(--text-2xl)] font-[var(--weight-semibold)] text-[var(--fg)] tracking-[-0.01em]">
            通知中心
          </h1>
          {loaded && unreadCount > 0 && (
            <span
              className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-[var(--radius-pill)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-xs)] font-[var(--weight-medium)] tabular-nums"
              aria-label={`${unreadCount} 条未读`}
            >
              {unreadCount}
            </span>
          )}
        </div>
      </header>

      {/* 操作栏：左侧筛选 segmented · 右侧全部已读 */}
      <div className="flex items-center justify-between mb-[var(--space-4)] gap-[var(--space-3)]">
        <div
          role="tablist"
          aria-label="通知筛选"
          className="inline-flex p-0.5 bg-[var(--surface-2)] border border-[var(--border)] rounded-[var(--radius-md)]"
        >
          {(["all", "unread"] as const).map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={`px-3 h-7 rounded-[var(--radius-sm)] text-[length:var(--text-sm)] font-[var(--weight-medium)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none ${
                filter === f
                  ? "bg-[var(--surface)] text-[var(--fg)] shadow-[var(--elev-sm)]"
                  : "text-[var(--muted)] hover:text-[var(--fg-2)]"
              }`}
            >
              {f === "all" ? "全部" : "未读"}
            </button>
          ))}
        </div>

        {loaded && unreadCount > 0 && (
          <button
            onClick={markAllRead}
            disabled={marking}
            className="flex items-center gap-1.5 h-8 px-3 text-[length:var(--text-sm)] text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)] rounded-[var(--radius-md)] transition-colors duration-[var(--motion-fast)] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:outline-none"
          >
            <CheckCheck size={14} />
            全部已读
          </button>
        )}
      </div>

      {/* 列表区：加载骨架 / 空状态 / 通知卡片 */}
      {!loaded ? (
        <NotificationListSkeleton count={6} />
      ) : visible.length === 0 ? (
        <EmptyState filter={filter} />
      ) : (
        <>
          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex items-center justify-between">
              <span>{error}</span>
              <button onClick={() => { setError(null); load(); }} className="text-red-600 underline hover:text-red-800">重试</button>
            </div>
          )}
          <ul className="flex flex-col gap-[var(--space-3)]">
          {visible.map((n) => {
            const meta = TYPE_META[n.type];
            const Icon = meta.icon;
            const rel = relativeTime(n.createdAt);
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => openNotification(n)}
                  aria-label={`${meta.text(n.entityTitle)}${n.read ? "" : "，未读"}`}
                  className={`w-full flex items-start gap-3 px-4 py-3.5 rounded-[var(--radius-lg)] border border-[var(--border)] text-left transition-colors duration-[var(--motion-fast)] hover:border-[var(--muted)] focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:outline-none ${
                    n.read ? "bg-[var(--surface)]" : "bg-[var(--surface-2)]"
                  }`}
                >
                  <Icon size={16} className="shrink-0 mt-0.5" style={{ color: meta.color }} />
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-[length:var(--text-base)] truncate ${
                        n.read ? "text-[var(--fg-2)]" : "text-[var(--fg)]"
                      }`}
                    >
                      {meta.text(n.entityTitle)}
                    </p>
                    {rel && (
                      <p className="mt-0.5 text-[length:var(--text-xs)] text-[var(--meta)] tabular-nums">
                        {rel}
                      </p>
                    )}
                  </div>
                  {!n.read && (
                    <span
                      className="shrink-0 mt-1 w-2 h-2 rounded-full bg-[var(--accent)]"
                      aria-hidden="true"
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        </>
      )}
    </div>
  );
}

/**
 * 通知列表骨架
 * 渲染 count 张与正式卡片尺寸一致的占位块：
 *   左侧图标 16px + 标题行 + 时间行 + 右侧未读圆点
 * 宽度在 60%~95% 间错落，避免机械感（与 TaskListSkeleton 同思路）。
 */
function NotificationListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-[var(--space-3)]" aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex items-start gap-3 px-4 py-3.5 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]"
        >
          <Skeleton className="shrink-0 mt-0.5 w-4 h-4 rounded-full" />
          <div className="flex-1">
            <Skeleton className="h-[14px]" style={{ maxWidth: `${60 + ((i * 37) % 36)}%` }} />
            <Skeleton className="mt-1 w-16 h-[12px]" />
          </div>
          <Skeleton className="shrink-0 mt-1 w-2 h-2 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** 空状态：筛选未读无结果用精简文案，全列表空用引导文案 */
function EmptyState({ filter }: { filter: Filter }) {
  if (filter === "unread") {
    return (
      <div className="px-5 py-[var(--space-12)] flex flex-col items-center text-center">
        <Bell size={48} className="text-[var(--muted)] opacity-40 mb-4" strokeWidth={1.5} />
        <p className="text-[length:var(--text-base)] text-[var(--fg-2)]">没有未读通知</p>
      </div>
    );
  }
  return (
    <div className="px-5 py-[var(--space-12)] flex flex-col items-center text-center">
      <Bell size={48} className="text-[var(--muted)] opacity-40 mb-4" strokeWidth={1.5} />
      <p className="text-[length:var(--text-base)] text-[var(--fg-2)]">暂无通知</p>
      <p className="mt-1 text-[length:var(--text-sm)] text-[var(--muted)]">
        当有人 @你、分配任务或更新决策时，会在这里提醒你
      </p>
    </div>
  );
}
