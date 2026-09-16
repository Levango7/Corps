"use client";

/**
 * 收藏列表面板。
 *
 * 交互流程：
 *  1. 挂载时调用 GET /api/v1/favorites 获取当前用户在工作区的所有收藏
 *  2. 按 targetType 分组显示（任务/文档/消息/Wiki/白板/表单/会议）
 *  3. 每项显示：类型图标 + 目标 ID + 备注 + 收藏时间
 *  4. 点击项目跳转到对应模块页面
 *  5. 支持取消收藏（删除按钮）
 *
 * Design token 样式 + lucide-react 图标 size 14/16。
 * Props: { workspaceId }
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Star,
  Trash2,
  Loader2,
  AlertCircle,
  X,
  CheckSquare,
  FileText,
  MessageSquare,
  BookOpen,
  PenTool,
  ClipboardList,
  Video,
} from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/Toast";

/** 收藏记录 */
interface FavoriteRecord {
  id: string;
  targetType: string;
  targetId: string;
  note: string | null;
  createdAt: string;
}

/** 收藏目标类型 */
type TargetType =
  | "task"
  | "document"
  | "message"
  | "wiki"
  | "whiteboard"
  | "form"
  | "meeting";

/** 类型 → 图标映射 */
const TYPE_ICON: Record<TargetType, typeof Star> = {
  task: CheckSquare,
  document: FileText,
  message: MessageSquare,
  wiki: BookOpen,
  whiteboard: PenTool,
  form: ClipboardList,
  meeting: Video,
};

/** 类型 → i18n key 映射 */
const TYPE_LABEL_KEY: Record<TargetType, string> = {
  task: "typeTask",
  document: "typeDocument",
  message: "typeMessage",
  wiki: "typeWiki",
  whiteboard: "typeWhiteboard",
  form: "typeForm",
  meeting: "typeMeeting",
};

/** 类型 → 跳转路径前缀映射 */
const TYPE_ROUTE: Record<TargetType, string> = {
  task: "/dashboard/tasks",
  document: "/dashboard/documents",
  message: "/dashboard/messages",
  wiki: "/dashboard/wiki",
  whiteboard: "/dashboard/whiteboards",
  form: "/dashboard/forms",
  meeting: "/dashboard/meetings",
};

/** 类型展示顺序 */
const TYPE_ORDER: TargetType[] = [
  "task",
  "document",
  "wiki",
  "whiteboard",
  "form",
  "meeting",
  "message",
];

/** 格式化收藏时间（简短相对时间） */
function formatFavoriteTime(iso: string): string {
  const date = new Date(iso);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin}分钟前`;
  if (diffHour < 24) return `${diffHour}小时前`;
  if (diffDay < 30) return `${diffDay}天前`;
  // 超过 30 天显示具体日期
  return date.toLocaleDateString();
}

/** FavoriteList Props */
interface FavoriteListProps {
  /** 工作区 ID */
  workspaceId: string;
}

export default function FavoriteList({ workspaceId }: FavoriteListProps) {
  const t = useTranslations("common.favorite");
  const { toast } = useToast();

  const [favorites, setFavorites] = useState<FavoriteRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);

  // AbortController：组件卸载时中止进行中的请求
  const abortRef = useRef<AbortController | null>(null);

  /** 加载收藏列表 */
  async function loadFavorites() {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError("");
    try {
      const data = await api<FavoriteRecord[]>(
        `/api/v1/favorites?wid=${encodeURIComponent(workspaceId)}&limit=200`,
        { signal: ac.signal },
      );
      if (ac.signal.aborted) return;
      setFavorites(data);
    } catch (e) {
      if (ac.signal.aborted || (e instanceof Error && e.name === "AbortError"))
        return;
      if (process.env.NODE_ENV === "development")
        console.error("[FavoriteList] loadFavorites error:", e);
      setError(t("error"));
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    loadFavorites();
    return () => {
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  /** 取消收藏 */
  async function removeFavorite(id: string) {
    if (removingId) return;
    setRemovingId(id);
    try {
      await api(
        `/api/v1/favorites/${id}?wid=${encodeURIComponent(workspaceId)}`,
        { method: "DELETE" },
      );
      setFavorites((prev) => prev.filter((f) => f.id !== id));
      toast("success", t("removed"));
    } catch (e) {
      if (process.env.NODE_ENV === "development")
        console.error("[FavoriteList] removeFavorite error:", e);
      toast("error", t("error"));
    } finally {
      setRemovingId(null);
    }
  }

  /** 跳转到对应模块 */
  function navigateTo(type: string, id: string) {
    const route = TYPE_ROUTE[type as TargetType];
    if (route) {
      window.open(`${route}/${id}`, "_blank", "noopener,noreferrer");
    }
  }

  /** 按类型分组 */
  const grouped = TYPE_ORDER.map((type) => ({
    type,
    items: favorites.filter((f) => f.targetType === type),
  })).filter((g) => g.items.length > 0);

  return (
    <div
      className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-sm)]"
      aria-label={t("title")}
    >
      {/* ── 头部 ── */}
      <header className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-soft)]">
        <h2 className="flex items-center gap-2 text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
          <Star size={16} className="text-[var(--accent)]" fill="currentColor" />
          {t("title")}
        </h2>
        <span className="text-[length:var(--text-xs)] text-[var(--muted)]">
          {favorites.length}
        </span>
      </header>

      {/* ── 正文 ── */}
      <div className="px-5 py-4 space-y-[var(--space-3)]">
        {/* 错误态 */}
        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-sm)]">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={() => setError("")}
              className="shrink-0 opacity-60 hover:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] rounded-[var(--radius-sm)]"
              aria-label="close"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* 加载态 */}
        {loading && (
          <div className="flex items-center justify-center py-8 text-[var(--muted)] text-[length:var(--text-sm)]">
            <Loader2 size={16} className="animate-spin mr-2" />
            {t("loading")}
          </div>
        )}

        {/* 空态 */}
        {!loading && favorites.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-12 text-[var(--muted)] text-[length:var(--text-sm)] gap-2">
            <Star size={32} className="opacity-40" />
            <p>{t("noFavorites")}</p>
          </div>
        )}

        {/* 分组列表 */}
        {!loading && grouped.length > 0 && (
          <div className="space-y-[var(--space-4)]">
            {grouped.map(({ type, items }) => {
              const Icon = TYPE_ICON[type];
              return (
                <div key={type}>
                  {/* 分组标题 */}
                  <div className="flex items-center gap-1.5 mb-2 text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--muted)] uppercase tracking-wide">
                    <Icon size={14} />
                    <span>{t(TYPE_LABEL_KEY[type])}</span>
                    <span className="text-[var(--meta)]">({items.length})</span>
                  </div>

                  {/* 收藏项列表 */}
                  <div className="space-y-1">
                    {items.map((fav) => {
                      const Icon = TYPE_ICON[type];
                      return (
                        <div
                          key={fav.id}
                          className="group flex items-center gap-2.5 px-2.5 py-2 rounded-[var(--radius-md)] hover:bg-[var(--surface-2)] transition-colors"
                        >
                          {/* 类型图标 */}
                          <Icon
                            size={14}
                            className="shrink-0 text-[var(--accent)]"
                          />

                          {/* 主要内容（可点击跳转） */}
                          <button
                            type="button"
                            onClick={() => navigateTo(fav.targetType, fav.targetId)}
                            className="flex-1 min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] rounded-[var(--radius-sm)]"
                          >
                            <div className="flex items-baseline gap-2">
                              <span className="text-[length:var(--text-sm)] text-[var(--fg)] truncate font-[weight:var(--weight-medium)]">
                                {fav.targetId}
                              </span>
                              <span className="shrink-0 text-[length:var(--text-xs)] text-[var(--meta)] tabular-nums">
                                {formatFavoriteTime(fav.createdAt)}
                              </span>
                            </div>
                            {fav.note && (
                              <p className="text-[length:var(--text-xs)] text-[var(--muted)] truncate mt-0.5">
                                {fav.note}
                              </p>
                            )}
                          </button>

                          {/* 删除按钮 */}
                          <button
                            type="button"
                            onClick={() => removeFavorite(fav.id)}
                            disabled={removingId === fav.id}
                            className="shrink-0 p-1 rounded-[var(--radius-sm)] text-[var(--muted)] hover:text-[var(--danger-fg)] hover:bg-[var(--danger-soft)] transition-colors opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:opacity-50"
                            aria-label={t("remove")}
                            title={t("remove")}
                          >
                            {removingId === fav.id ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Trash2 size={14} />
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}