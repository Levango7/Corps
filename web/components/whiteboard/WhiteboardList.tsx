"use client";

/**
 * 白板列表组件：卡片式展示白板（标题/最后更新时间/元素数量），支持新建/删除。
 *
 * 数据流：useEffect 拉 GET /whiteboards 列表。
 * 新建：POST /whiteboards 获取 id 后跳到编辑页。
 * 删除：DELETE /whiteboards/{wbid}，确认后执行。
 */

import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/lib/i18n-navigation";
import { Plus, Loader2, Trash2, PenSquare, Layers } from "lucide-react";
import { api } from "@/lib/api";

/** 列表项（与 API GET 列表响应一致） */
interface WhiteboardListItem {
  id: string;
  title: string;
  updatedAt: string;
  createdAt: string;
}

export function WhiteboardList({ wid }: { wid: string }) {
  const t = useTranslations("whiteboard");
  const router = useRouter();

  const [items, setItems] = useState<WhiteboardListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await api<{ items: WhiteboardListItem[]; total: number; hasMore: boolean }>(
          `/api/v1/workspaces/${wid}/whiteboards`,
        );
        if (!cancelled) setItems(data.items);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t("noWhiteboards"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wid, t]);

  async function createWb(e: FormEvent) {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    setError("");
    try {
      const res = await api<{ id: string; title: string }>(
        `/api/v1/workspaces/${wid}/whiteboards`,
        {
          method: "POST",
          body: JSON.stringify({ title: t("untitled") }),
        },
      );
      router.push(`/w/${wid}/whiteboards/${res.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("create"));
      setCreating(false);
    }
  }

  async function deleteWb(id: string) {
    if (!window.confirm(t("confirmDelete"))) return;
    setDeletingId(id);
    setError("");
    try {
      await api(`/api/v1/workspaces/${wid}/whiteboards/${id}`, {
        method: "DELETE",
      });
      setItems((prev) => prev.filter((item) => item.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("delete"));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="max-w-[var(--container-max)] mx-auto px-[var(--space-4)] py-[var(--space-6)]">
      {/* 标题 + 新建按钮 */}
      <div className="flex items-center justify-between mb-[var(--space-5)]">
        <h1 className="text-[length:var(--text-2xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tracking-[var(--tracking-tight)]">
          {t("title")}
        </h1>
        <button
          onClick={createWb}
          disabled={creating}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)]"
        >
          {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          {t("create")}
        </button>
      </div>

      {error && <p className="mb-3 text-[length:var(--text-sm)] text-[var(--danger)]">{error}</p>}

      {loading ? (
        <div className="py-[var(--space-12)] text-center text-[var(--muted)]">
          <Loader2 size={20} className="inline animate-spin mr-2" />
          {t("loading")}
        </div>
      ) : items.length === 0 ? (
        <div className="py-[var(--space-12)] text-center text-[var(--muted)]">
          <Layers size={36} className="mx-auto mb-3 opacity-50" />
          <p>{t("noWhiteboards")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[var(--space-4)]">
          {items.map((wb) => (
            <div
              key={wb.id}
              className="group relative rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)] hover:shadow-[var(--elev-sm)] transition-all duration-[var(--motion-fast)]"
            >
              <Link
                href={`/w/${wid}/whiteboards/${wb.id}`}
                className="block px-[var(--space-4)] py-[var(--space-4)]"
              >
                <div className="flex items-start gap-2 mb-2">
                  <PenSquare
                    size={16}
                    className="shrink-0 mt-0.5 text-[var(--muted)]"
                  />
                  <h2 className="flex-1 min-w-0 text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)] truncate">
                    {wb.title || t("untitled")}
                  </h2>
                </div>
                <p className="ml-6 text-[length:var(--text-xs)] text-[var(--muted)]">
                  {t("lastUpdated", {
                    date: new Date(wb.updatedAt).toLocaleString(),
                  })}
                </p>
              </Link>
              {/* 删除按钮（hover 显示） */}
              <button
                onClick={() => deleteWb(wb.id)}
                disabled={deletingId === wb.id}
                title={t("delete")}
                aria-label={t("delete")}
                className="absolute top-[var(--space-2)] right-[var(--space-2)] w-8 h-8 inline-flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger-fg)] opacity-0 group-hover:opacity-100 transition-all duration-[var(--motion-fast)] disabled:opacity-50"
              >
                {deletingId === wb.id ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Trash2 size={14} />
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}