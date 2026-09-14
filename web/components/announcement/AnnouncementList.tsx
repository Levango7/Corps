"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
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
} from "lucide-react";
import { api } from "@/lib/api";
import AnnouncementEditor, {
  type AnnouncementItem,
  type AnnouncementType,
  TYPE_TOKEN,
} from "./AnnouncementEditor";

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

export function AnnouncementList({ wid }: { wid: string }) {
  const t = useTranslations("announcement");
  const [items, setItems] = useState<AnnouncementItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [typeFilter, setTypeFilter] = useState<AnnouncementType | "">("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<AnnouncementItem | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (typeFilter) params.set("type", typeFilter);
        const data = await api<{ items: AnnouncementItem[]; total: number }>(
          `/api/v1/workspaces/${wid}/announcements?${params.toString()}`,
        );
        if (!cancelled) setItems(data.items);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t("noAnnouncements"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wid, typeFilter, refreshKey, t]);

  function openCreate() {
    setEditing(null);
    setEditorOpen(true);
  }

  function openEdit(item: AnnouncementItem) {
    setEditing(item);
    setEditorOpen(true);
  }

  async function togglePin(item: AnnouncementItem) {
    try {
      const updated = await api<AnnouncementItem>(
        `/api/v1/workspaces/${wid}/announcements/${item.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ pinned: !item.pinned }),
        },
      );
      setItems((prev) => prev.map((a) => (a.id === item.id ? updated : a)));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("noAnnouncements"));
    }
  }

  async function handleDelete(item: AnnouncementItem) {
    if (!window.confirm(t("confirmDelete"))) return;
    try {
      await api(`/api/v1/workspaces/${wid}/announcements/${item.id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((a) => a.id !== item.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("noAnnouncements"));
    }
  }

  return (
    <div className="max-w-[var(--container-max)] mx-auto px-[var(--space-4)] py-[var(--space-6)]">
      <div className="flex items-center justify-between mb-[var(--space-5)]">
        <h1 className="flex items-center gap-2 text-[length:var(--text-2xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tracking-[var(--tracking-tight)]">
          <Megaphone size={20} className="text-[var(--accent)]" />
          {t("title")}
        </h1>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-fast)]"
        >
          <Plus size={14} />
          {t("create")}
        </button>
      </div>

      {/* 类型过滤 */}
      <div className="flex items-center gap-2 mb-[var(--space-4)]">
        <button
          onClick={() => setTypeFilter("")}
          className={`h-8 px-3 rounded-[var(--radius-sm)] text-[length:var(--text-sm)] transition-colors duration-[var(--motion-fast)] ${
            typeFilter === ""
              ? "bg-[var(--surface-2)] text-[var(--fg)] border border-[var(--border)]"
              : "text-[var(--muted)] hover:text-[var(--fg)]"
          }`}
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

      {error && <p className="mb-3 text-[length:var(--text-sm)] text-[var(--danger)]">{error}</p>}

      {loading ? (
        <div className="py-[var(--space-12)] text-center text-[var(--muted)]">
          <Loader2 size={20} className="inline animate-spin mr-2" />
          {t("noAnnouncements")}
        </div>
      ) : items.length === 0 ? (
        <div className="py-[var(--space-12)] text-center text-[var(--muted)]">
          <Megaphone size={36} className="mx-auto mb-3 opacity-50" />
          <p>{t("noAnnouncements")}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const tok = TYPE_TOKEN[item.type];
            const Icon = TYPE_ICON[item.type];
            return (
              <li
                key={item.id}
                className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] overflow-hidden"
              >
                <div className="flex items-start gap-3 px-[var(--space-4)] py-[var(--space-3)]">
                  {/* 类型色条 */}
                  <span
                    className="shrink-0 w-1 self-stretch rounded-full"
                    style={{ background: tok.fg }}
                    aria-hidden="true"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
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
                    </div>
                    <h3 className="text-[length:var(--text-base)] font-[weight:var(--weight-semibold)] text-[var(--fg)] mb-1">
                      {item.title}
                    </h3>
                    <p className="text-[length:var(--text-sm)] text-[var(--fg-2)] line-clamp-2">
                      {summarize(item.content)}
                    </p>
                    <div className="mt-2 flex items-center gap-2 text-[length:var(--text-xs)] text-[var(--muted)]">
                      {item.publisher?.name || item.publisher?.email ? (
                        <span>{item.publisher?.name || item.publisher?.email}</span>
                      ) : null}
                      <span>·</span>
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
                      onClick={() => handleDelete(item)}
                      className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                      aria-label={t("delete")}
                      title={t("delete")}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <AnnouncementEditor
        wid={wid}
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSaved={() => {
          // 保存后重新拉取列表
          setRefreshKey((k) => k + 1);
        }}
        announcement={editing}
      />
    </div>
  );
}