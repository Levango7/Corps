"use client";

/**
 * 公告管理页面 · /w/[wid]/announcements
 *
 * 职责：
 *  - 公告列表（API 已按 pinned DESC + publishedAt DESC 排序：置顶在前，再按发布时间倒序）
 *  - 每条公告显示：标题 / 内容摘要 / 发布人 / 发布时间 / 已读状态
 *  - 创建 / 编辑 / 删除公告（仅 Owner/Admin 可操作编辑/删除/置顶）
 *  - 公告详情展开（点击卡片切换全文，展开自动标记已读）
 *  - 已读 / 未读统计（基于 localStorage 追踪当前用户已读 ID）
 *  - 类型过滤 + 关键词搜索
 *  - 自定义确认弹窗（不使用 window.confirm/alert）
 *
 * 复用 AnnouncementEditor 弹窗（标题/内容/类型/置顶/受众/过期）。
 */
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import AnnouncementEditor, {
  type AnnouncementItem,
  type AnnouncementType,
  TYPE_TOKEN,
} from "@/components/announcement/AnnouncementEditor";
import {
  Plus,
  Loader2,
  Megaphone,
  Pin,
  PinOff,
  Pencil,
  Trash2,
  Info,
  AlertTriangle,
  AlertOctagon,
  X,
  CheckCheck,
  Search,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Check,
} from "lucide-react";

/** 类型 → 图标映射 */
const TYPE_ICON: Record<AnnouncementType, typeof Info> = {
  info: Info,
  warning: AlertTriangle,
  urgent: AlertOctagon,
};

/** 从 Markdown 内容生成纯文本摘要（去标记 + 截断） */
function summarize(markdown: string, max = 160): string {
  const plain = markdown
    .replace(/^#+\s*/gm, "")
    .replace(/[*`>_~]/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\n+/g, " ")
    .trim();
  return plain.length > max ? plain.slice(0, max) + "…" : plain;
}

/** 已读追踪 localStorage key */
const readStorageKey = (wid: string) => `announcement-read-${wid}`;

function loadReadIds(wid: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(readStorageKey(wid));
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? new Set(arr.filter((x): x is string => typeof x === "string")) : new Set();
  } catch {
    return new Set();
  }
}

function persistReadIds(wid: string, ids: Set<string>) {
  try {
    window.localStorage.setItem(readStorageKey(wid), JSON.stringify(Array.from(ids)));
  } catch {
    // localStorage 不可用时静默失败
  }
}

// ─── 删除确认弹窗（自定义 modal，替代 window.confirm） ─────────────
function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Esc 关闭 + focus trap
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    const el = dialogRef.current;
    const focusable = el?.querySelectorAll<HTMLElement>(
      'button, a, input, textarea, select, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.[0]?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-delete-title"
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 bg-[var(--overlay)]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-sm bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-lg)]">
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-soft)]">
          <h2
            id="confirm-delete-title"
            className="flex items-center gap-2 text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]"
          >
            <AlertCircle size={16} className="text-[var(--danger)]" />
            {title}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            aria-label={cancelLabel}
          >
            <X size={16} />
          </button>
        </header>
        <div className="px-5 py-4">
          <p className="text-[length:var(--text-sm)] text-[var(--fg-2)]">{body}</p>
        </div>
        <footer className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-[var(--border-soft)]">
          <button
            type="button"
            onClick={onCancel}
            className="h-9 px-4 rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex items-center gap-1.5 h-9 px-4 bg-[var(--danger)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:opacity-90 transition-opacity duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
          >
            <Trash2 size={14} />
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ─── 主页面 ───────────────────────────────────────────────────────
export default function AnnouncementsPage({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = use(params);
  const t = useTranslations("announcement");
  const tButton = useTranslations("button");
  const tErr = useTranslations("error");

  const [items, setItems] = useState<AnnouncementItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<AnnouncementType | "">("");
  const [search, setSearch] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<AnnouncementItem | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [role, setRole] = useState<string>("member");
  const [confirmTarget, setConfirmTarget] = useState<AnnouncementItem | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const canManage = role === "owner" || role === "admin";

  // 加载公告列表
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (typeFilter) params.set("type", typeFilter);
        params.set("limit", "100");
        const data = await api<{ items: AnnouncementItem[]; total: number }>(
          `/api/v1/workspaces/${wid}/announcements?${params.toString()}`,
        );
        if (!cancelled) {
          setItems(data.items);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error && e.message.includes("fetch")
              ? tErr("networkConnectFailed")
              : t("loadFailed"),
          );
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wid, typeFilter, refreshKey, t, tErr]);

  // 加载当前用户角色（从 members 列表找 isSelf）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api<{
          items: Array<{ id: string; role: string; isSelf: boolean }>;
        }>(`/api/v1/workspaces/${wid}/members?limit=100`);
        if (cancelled) return;
        const self = data.items.find((m) => m.isSelf);
        if (self) setRole(self.role);
      } catch {
        // 角色获取失败降级为 member（不可管理）
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wid]);

  // 初始化已读集合
  useEffect(() => {
    setReadIds(loadReadIds(wid));
  }, [wid]);

  // 标记单条已读
  const markRead = useCallback(
    (id: string) => {
      setReadIds((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        persistReadIds(wid, next);
        return next;
      });
    },
    [wid],
  );

  // 全部标记已读
  const markAllRead = useCallback(() => {
    setReadIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const item of items) {
        if (!next.has(item.id)) {
          next.add(item.id);
          changed = true;
        }
      }
      if (!changed) return prev;
      persistReadIds(wid, next);
      return next;
    });
  }, [wid, items]);

  // 展开/收起详情（展开时自动标记已读）
  const toggleExpand = useCallback(
    (id: string) => {
      setExpandedId((prev) => {
        if (prev === id) return null;
        markRead(id);
        return id;
      });
    },
    [markRead],
  );

  // 操作：新建 / 编辑
  function openCreate() {
    setEditing(null);
    setEditorOpen(true);
  }
  function openEdit(item: AnnouncementItem) {
    setEditing(item);
    setEditorOpen(true);
  }

  // 操作：置顶切换
  async function togglePin(item: AnnouncementItem) {
    try {
      setActionError(null);
      const updated = await api<AnnouncementItem>(
        `/api/v1/workspaces/${wid}/announcements/${item.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ pinned: !item.pinned }),
        },
      );
      setItems((prev) => prev.map((a) => (a.id === item.id ? updated : a)));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t("pinFailed"));
    }
  }

  // 操作：删除（打开确认弹窗）
  function requestDelete(item: AnnouncementItem) {
    setConfirmTarget(item);
  }

  async function confirmDelete() {
    if (!confirmTarget) return;
    const target = confirmTarget;
    setConfirmTarget(null);
    try {
      setActionError(null);
      await api(`/api/v1/workspaces/${wid}/announcements/${target.id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((a) => a.id !== target.id));
      // 收起已删除项
      setExpandedId((prev) => (prev === target.id ? null : prev));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t("deleteFailed"));
    }
  }

  // 关键词搜索（本地过滤标题 + 摘要）
  const filteredItems = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.trim().toLowerCase();
    return items.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        summarize(a.content).toLowerCase().includes(q),
    );
  }, [items, search]);

  // 统计
  const stats = useMemo(() => {
    const total = items.length;
    const read = items.reduce((acc, a) => acc + (readIds.has(a.id) ? 1 : 0), 0);
    return { total, read, unread: total - read };
  }, [items, readIds]);

  // 操作错误自动消失
  useEffect(() => {
    if (!actionError) return;
    const timer = window.setTimeout(() => setActionError(null), 5000);
    return () => window.clearTimeout(timer);
  }, [actionError]);

  return (
    <main className="flex-1 min-w-0">
      <div className="max-w-[var(--container-max)] mx-auto px-[var(--space-4)] py-[var(--space-6)]">
        {/* 标题栏 */}
        <div className="flex items-center justify-between mb-[var(--space-5)]">
          <h1 className="flex items-center gap-2 text-[length:var(--text-2xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tracking-[var(--tracking-tight)]">
            <Megaphone size={20} className="text-[var(--accent)]" />
            {t("title")}
          </h1>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
          >
            <Plus size={14} />
            {t("create")}
          </button>
        </div>

        {/* 统计概览栏 */}
        {!loading && items.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 mb-[var(--space-4)] px-4 py-3 rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--surface)]">
            <span className="inline-flex items-center gap-1.5 text-[length:var(--text-sm)] text-[var(--fg-2)]">
              <Megaphone size={14} className="text-[var(--muted)]" />
              <span className="font-[weight:var(--weight-medium)] text-[var(--fg)]">{stats.total}</span>
              {t("overview")}
            </span>
            <span className="text-[var(--meta)]">·</span>
            <span className="inline-flex items-center gap-1.5 text-[length:var(--text-sm)] text-[var(--fg-2)]">
              <Check size={14} className="text-[var(--accent)]" />
              <span className="font-[weight:var(--weight-medium)] text-[var(--fg)]">{stats.read}</span>
              {t("statsRead")}
            </span>
            <span className="text-[var(--meta)]">·</span>
            <span className="inline-flex items-center gap-1.5 text-[length:var(--text-sm)] text-[var(--fg-2)]">
              <Megaphone size={14} className="text-[var(--muted)]" />
              <span className="font-[weight:var(--weight-medium)] text-[var(--fg)]">{stats.unread}</span>
              {t("statsUnread")}
            </span>
            {stats.unread > 0 && (
              <button
                onClick={markAllRead}
                className="ml-auto inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-sm)] text-[length:var(--text-sm)] text-[var(--accent)] hover:bg-[var(--accent-soft)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
              >
                <CheckCheck size={14} />
                {t("markAllRead")}
              </button>
            )}
          </div>
        )}

        {/* 搜索框 + 类型过滤 */}
        {!loading && items.length > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-[var(--space-4)]">
            <div className="relative flex-1 max-w-sm">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)] pointer-events-none"
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("searchPlaceholder")}
                className="w-full h-9 pl-9 pr-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] placeholder:text-[var(--meta)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setTypeFilter("")}
                className={`h-8 px-3 rounded-[var(--radius-sm)] text-[length:var(--text-sm)] transition-colors duration-[var(--motion-fast)] ${
                  typeFilter === ""
                    ? "bg-[var(--surface-2)] text-[var(--fg)] border border-[var(--border)]"
                    : "text-[var(--muted)] hover:text-[var(--fg)]"
                }`}
                aria-pressed={typeFilter === ""}
              >
                {t("type")}
              </button>
              {(["info", "warning", "urgent"] as AnnouncementType[]).map((tp) => {
                const tok = TYPE_TOKEN[tp];
                const active = typeFilter === tp;
                return (
                  <button
                    key={tp}
                    onClick={() => setTypeFilter(active ? "" : tp)}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-sm)] text-[length:var(--text-sm)] transition-colors duration-[var(--motion-fast)]"
                    style={{
                      background: active ? tok.soft : "transparent",
                      color: active ? tok.softFg : "var(--muted)",
                      border: `1px solid ${active ? tok.fg : "var(--border-soft)"}`,
                    }}
                    aria-pressed={active}
                  >
                    {t(tp)}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 操作错误提示 */}
        {actionError && (
          <div
            role="alert"
            aria-live="assertive"
            className="mb-[var(--space-4)] flex items-center gap-2 px-4 py-2.5 rounded-[var(--radius-md)] border bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] border-[color-mix(in_srgb,var(--danger)_30%,transparent)] text-[var(--danger)]"
          >
            <AlertCircle size={16} className="shrink-0" />
            <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)]">{actionError}</span>
          </div>
        )}

        {/* 加载错误提示 */}
        {error && (
          <div className="mb-[var(--space-4)] rounded-[var(--radius-md)] p-3 text-[length:var(--text-sm)] flex items-center justify-between bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] text-[var(--danger)]">
            <span>{error}</span>
            <button
              onClick={() => {
                setError(null);
                setRefreshKey((k) => k + 1);
              }}
              className="underline hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] text-[var(--danger)]"
            >
              {tButton("retry")}
            </button>
          </div>
        )}

        {/* 列表 */}
        {loading ? (
          <div className="py-[var(--space-12)] text-center text-[var(--muted)]">
            <Loader2 size={20} className="inline animate-spin mr-2" />
            {t("noAnnouncements")}
          </div>
        ) : filteredItems.length === 0 ? (
          items.length === 0 ? (
            <div className="py-[var(--space-12)] text-center text-[var(--muted)]">
              <Megaphone size={36} className="mx-auto mb-3 opacity-50" />
              <p className="mb-1">{t("noAnnouncements")}</p>
              <p className="text-[length:var(--text-sm)]">{t("emptyHint")}</p>
            </div>
          ) : (
            <div className="py-[var(--space-12)] text-center text-[var(--muted)]">
              <Search size={28} className="mx-auto mb-3 opacity-50" />
              <p className="text-[length:var(--text-sm)]">{t("noAnnouncements")}</p>
            </div>
          )
        ) : (
          <ul className="space-y-3">
            {filteredItems.map((item) => {
              const tok = TYPE_TOKEN[item.type];
              const Icon = TYPE_ICON[item.type];
              const expanded = expandedId === item.id;
              const isRead = readIds.has(item.id);
              return (
                <li
                  key={item.id}
                  className={`rounded-[var(--radius-md)] border bg-[var(--surface)] overflow-hidden transition-shadow duration-[var(--motion-fast)] ${
                    expanded ? "border-[var(--accent)] shadow-[var(--elev-md)]" : "border-[var(--border)]"
                  }`}
                >
                  <div className="flex items-start gap-3 px-[var(--space-4)] py-[var(--space-3)]">
                    {/* 类型色条 */}
                    <span
                      className="shrink-0 w-1 self-stretch rounded-full"
                      style={{ background: tok.fg }}
                      aria-hidden="true"
                    />
                    <div className="flex-1 min-w-0">
                      {/* 徽标行 */}
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <Icon size={14} className="shrink-0" style={{ color: tok.fg }} />
                        <span
                          className="inline-flex items-center px-1.5 py-0.5 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)]"
                          style={{ background: tok.soft, color: tok.softFg }}
                        >
                          {t(item.type)}
                        </span>
                        {item.pinned && (
                          <span className="inline-flex items-center gap-0.5 text-[length:var(--text-xs)] text-[var(--accent)]">
                            <Pin size={12} />
                            {t("pinned")}
                          </span>
                        )}
                        {/* 已读/未读徽标 */}
                        {isRead ? (
                          <span className="inline-flex items-center gap-0.5 text-[length:var(--text-xs)] text-[var(--muted)]">
                            <Check size={12} />
                            {t("read")}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] bg-[var(--accent-soft)] text-[var(--accent)]">
                            {t("unread")}
                          </span>
                        )}
                      </div>

                      {/* 标题（可点击展开） */}
                      <button
                        type="button"
                        onClick={() => toggleExpand(item.id)}
                        className="text-left w-full text-[length:var(--text-base)] font-[weight:var(--weight-semibold)] text-[var(--fg)] mb-1 hover:text-[var(--accent)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] rounded-[var(--radius-sm)]"
                        aria-expanded={expanded}
                      >
                        <span className="inline-flex items-center gap-1">
                          {item.title}
                          {expanded ? (
                            <ChevronUp size={14} className="text-[var(--muted)]" />
                          ) : (
                            <ChevronDown size={14} className="text-[var(--muted)]" />
                          )}
                        </span>
                      </button>

                      {/* 内容：展开显示全文，否则摘要 */}
                      {expanded ? (
                        <div className="mt-2 px-3 py-2.5 rounded-[var(--radius-sm)] bg-[var(--surface-2)] border border-[var(--border-soft)]">
                          <p className="whitespace-pre-wrap text-[length:var(--text-sm)] text-[var(--fg-2)] leading-relaxed">
                            {item.content}
                          </p>
                        </div>
                      ) : (
                        <p className="text-[length:var(--text-sm)] text-[var(--fg-2)] line-clamp-2">
                          {summarize(item.content)}
                        </p>
                      )}

                      {/* 元信息行 */}
                      <div className="mt-2 flex items-center gap-2 text-[length:var(--text-xs)] text-[var(--muted)] flex-wrap">
                        {item.publisher?.name || item.publisher?.email ? (
                          <>
                            <span className="text-[var(--meta)]">{t("publishedBy")}:</span>
                            <span className="text-[var(--fg-2)]">
                              {item.publisher?.name || item.publisher?.email}
                            </span>
                            <span>·</span>
                          </>
                        ) : null}
                        <span>{new Date(item.publishedAt).toLocaleString()}</span>
                        {item.expiresAt && (
                          <>
                            <span>·</span>
                            <span>
                              {t("expiresAt")}: {new Date(item.expiresAt).toLocaleDateString()}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* 操作按钮 */}
                    <div className="shrink-0 flex items-center gap-1">
                      {canManage && (
                        <>
                          <button
                            onClick={() => togglePin(item)}
                            className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                            aria-label={item.pinned ? t("unpin") : t("pinned")}
                            title={item.pinned ? t("unpin") : t("pinned")}
                          >
                            {item.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                          </button>
                          <button
                            onClick={() => openEdit(item)}
                            className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                            aria-label={t("edit")}
                            title={t("edit")}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => requestDelete(item)}
                            className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                            aria-label={t("delete")}
                            title={t("delete")}
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* 权限提示（非管理员且存在公告时） */}
        {!loading && items.length > 0 && !canManage && (
          <p className="mt-[var(--space-4)] text-[length:var(--text-xs)] text-[var(--meta)] text-center">
            {t("noPermission")}
          </p>
        )}
      </div>

      {/* 创建/编辑弹窗 */}
      <AnnouncementEditor
        wid={wid}
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSaved={() => {
          setRefreshKey((k) => k + 1);
        }}
        announcement={editing}
      />

      {/* 删除确认弹窗 */}
      <ConfirmDialog
        open={confirmTarget !== null}
        title={t("confirmDeleteTitle")}
        body={t("confirmDeleteBody")}
        confirmLabel={tButton("delete")}
        cancelLabel={tButton("cancel")}
        onConfirm={confirmDelete}
        onCancel={() => setConfirmTarget(null)}
      />
    </main>
  );
}
