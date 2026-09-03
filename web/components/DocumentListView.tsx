"use client";

/**
 * 工作区文档列表页：搜索 + 新建 + 入口到编辑页。
 *
 * 数据流：useEffect 拉 GET /documents 列表；搜索是受控 input + 拉取。
 * 新建：POST /documents 获取 id 后跳到编辑页。
 */

import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/lib/i18n-navigation";
import { Plus, Search, FileText, Loader2, X } from "lucide-react";
import { api } from "@/lib/api";

interface DocumentListItem {
  id: string;
  title: string;
  publishedAt: string | null;
  updatedAt: string;
  author: { id: string; name: string | null; email: string } | null;
}

export function DocumentListView({ wid }: { wid: string }) {
  const t = useTranslations("document");
  const router = useRouter();
  const [items, setItems] = useState<DocumentListItem[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (q) params.set("q", q);
        const data = await api<DocumentListItem[]>(
          `/api/v1/workspaces/${wid}/documents?${params.toString()}`,
        );
        if (!cancelled) setItems(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t("loadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wid, q]);

  async function createDoc(e: FormEvent) {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    setError("");
    try {
      const res = await api<{ id: string; title: string }>(`/api/v1/workspaces/${wid}/documents`, {
        method: "POST",
        body: JSON.stringify({ title: t("untitledDoc") }),
      });
      router.push(`/w/${wid}/documents/${res.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("createFailed"));
      setCreating(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-[var(--space-4)] py-[var(--space-6)]">
      <div className="flex items-center justify-between mb-[var(--space-5)]">
        <h1 className="text-[length:var(--text-2xl)] font-[var(--weight-semibold)] text-[var(--fg)] tracking-[-0.01em]">
          {t("listTitle")}
        </h1>
        <button
          onClick={createDoc}
          disabled={creating}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors"
        >
          {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          {t("newDocument")}
        </button>
      </div>

      {/* 搜索 */}
      <div className="relative mb-[var(--space-4)]">
        <Search
          size={15}
          className="absolute left-[var(--space-3)] top-1/2 -translate-y-1/2 text-[var(--meta)] pointer-events-none"
        />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="w-full h-9 pl-9 pr-9 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)]"
        />
        {q && (
          <button
            onClick={() => setQ("")}
            className="absolute right-[var(--space-2)] top-1/2 -translate-y-1/2 p-1 rounded text-[var(--meta)] hover:text-[var(--fg)]"
            aria-label={t("clearSearch")}
          >
            <X size={13} />
          </button>
        )}
      </div>

      {error && <p className="mb-3 text-[length:var(--text-sm)] text-[var(--danger)]">{error}</p>}

      {loading ? (
        <div className="py-[var(--space-12)] text-center text-[var(--muted)]">
          <Loader2 size={20} className="inline animate-spin mr-2" />
          {t("loading")}
        </div>
      ) : items.length === 0 ? (
        <div className="py-[var(--space-12)] text-center text-[var(--muted)]">
          <FileText size={36} className="mx-auto mb-3 opacity-50" />
          <p>{q ? t("noSearchResults") : t("emptyState")}</p>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--border-soft)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
          {items.map((d) => {
            const author = d.author?.name || d.author?.email;
            return (
              <li key={d.id}>
                <a
                  href={`/w/${wid}/documents/${d.id}`}
                  className="block px-[var(--space-4)] py-3 hover:bg-[var(--surface-2)] transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <FileText size={15} className="shrink-0 text-[var(--muted)]" />
                    <span className="flex-1 min-w-0 text-[length:var(--text-sm)] font-medium text-[var(--fg)] truncate">
                      {d.title}
                    </span>
                    {d.publishedAt ? (
                      <span className="shrink-0 inline-flex items-center gap-1 text-[length:var(--text-xs)] text-[var(--success)]">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--success)]" />
                        {t("publishedBadge")}
                      </span>
                    ) : (
                      <span className="shrink-0 text-[length:var(--text-xs)] text-[var(--muted)]">
                        {t("draftBadge")}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 ml-6 text-[length:var(--text-xs)] text-[var(--muted)] flex items-center gap-2">
                    {author && <span>{author}</span>}
                    <span>·</span>
                    <span>{t("updatedAt", { date: new Date(d.updatedAt).toLocaleString() })}</span>
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
