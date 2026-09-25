"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { FileText, ChevronRight, Plus, Loader2, Search } from "lucide-react";
import { api } from "@/lib/api";

/** Wiki 页面树节点（与 API 返回结构一致） */
export interface WikiPageNode {
  id: string;
  title: string;
  slug: string;
  content: string;
  parentId: string | null;
  createdBy: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  children: WikiPageNode[];
}

interface WikiSidebarProps {
  wid: string;
  selectedId?: string;
  onSelect: (page: WikiPageNode) => void;
  /** 刷新信号：外部改变后递增以触发重新拉取 */
  refreshKey?: number;
}

/** 递归渲染单个页面节点（含子页面缩进） */
function PageNode({
  node,
  depth,
  selectedId,
  onSelect,
  onCreateSub,
}: {
  node: WikiPageNode;
  depth: number;
  selectedId?: string;
  onSelect: (page: WikiPageNode) => void;
  onCreateSub: (parentId: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedId === node.id;

  return (
    <li>
      <div
        className={`group flex items-center gap-1 px-[var(--space-2)] py-1.5 rounded-[var(--radius-sm)] cursor-pointer transition-colors duration-[var(--motion-fast)] ${
          isSelected
            ? "bg-[var(--accent-soft)] text-[var(--accent)]"
            : "text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
        }`}
        style={{ paddingLeft: `calc(var(--space-2) + ${depth * 16}px)` }}
        onClick={() => onSelect(node)}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            className="shrink-0 w-4 h-4 flex items-center justify-center text-[var(--muted)] hover:text-[var(--fg)]"
            aria-label="toggle"
          >
            <ChevronRight
              size={14}
              className={`transition-transform duration-[var(--motion-fast)] ${expanded ? "rotate-90" : ""}`}
            />
          </button>
        ) : (
          <span className="shrink-0 w-4" />
        )}
        <FileText size={14} className="shrink-0 opacity-70" />
        <span className="flex-1 min-w-0 truncate text-[length:var(--text-sm)]">{node.title}</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCreateSub(node.id);
          }}
          className="shrink-0 w-5 h-5 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] opacity-0 group-hover:opacity-100 hover:bg-[var(--surface-3)] hover:text-[var(--fg)] transition-opacity duration-[var(--motion-fast)]"
          aria-label="new subpage"
        >
          <Plus size={14} />
        </button>
      </div>
      {hasChildren && expanded && (
        <ul className="mt-0.5">
          {node.children.map((child) => (
            <PageNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              onCreateSub={onCreateSub}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function WikiSidebar({ wid, selectedId, onSelect, refreshKey = 0 }: WikiSidebarProps) {
  const t = useTranslations("wiki");
  const [tree, setTree] = useState<WikiPageNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [internalRefresh, setInternalRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (search) params.set("q", search);
        const data = await api<{ items: WikiPageNode[]; total: number; hasMore: boolean }>(
          `/api/v1/workspaces/${wid}/wiki?${params.toString()}`,
        );
        if (!cancelled) setTree(data.items);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t("loadError"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wid, search, refreshKey, internalRefresh, t]);

  /** 创建新页面（根或子页面），创建后选中 */
  async function handleCreate(parentId?: string) {
    try {
      const title = window.prompt(parentId ? t("newSubPage") : t("newPage"), "");
      if (!title?.trim()) return;
      const page = await api<WikiPageNode>(`/api/v1/workspaces/${wid}/wiki`, {
        method: "POST",
        body: JSON.stringify({ title: title.trim(), parentId: parentId ?? null, content: "" }),
      });
      // 重新拉取树（递增内部刷新计数器触发 useEffect）
      setInternalRefresh((n) => n + 1);
      onSelect(page);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveError"));
    }
  }

  return (
    <aside className="flex flex-col h-full min-w-0 border-r border-[var(--border)] bg-[var(--surface)]">
      {/* 头部：标题 + 新建按钮 */}
      <div className="flex items-center justify-between px-[var(--space-3)] py-[var(--space-3)] border-b border-[var(--border-soft)]">
        <h2 className="text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
          {t("sidebar")}
        </h2>
        <button
          type="button"
          onClick={() => handleCreate(undefined)}
          className="inline-flex items-center gap-1 h-7 px-2 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-fast)]"
        >
          <Plus size={14} />
          {t("newPage")}
        </button>
      </div>

      {/* 搜索框 */}
      <div className="px-[var(--space-3)] py-[var(--space-2)] border-b border-[var(--border-soft)]">
        <div className="relative">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)]"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="w-full h-8 pl-8 pr-2.5 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] text-[length:var(--text-sm)] text-[var(--fg)] placeholder:text-[var(--muted)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
          />
        </div>
      </div>

      {/* 页面树 */}
      <div className="flex-1 overflow-y-auto px-[var(--space-2)] py-[var(--space-2)]">
        {error && (
          <p className="px-[var(--space-2)] py-2 text-[length:var(--text-xs)] text-[var(--danger)]">
            {error}
          </p>
        )}
        {loading ? (
          <div className="py-[var(--space-6)] text-center text-[var(--muted)] text-[length:var(--text-sm)]">
            <Loader2 size={16} className="inline animate-spin mr-2" />
            {t("loadError")}
          </div>
        ) : tree.length === 0 ? (
          <div className="py-[var(--space-6)] text-center text-[var(--muted)] text-[length:var(--text-sm)]">
            {t("noPages")}
          </div>
        ) : (
          <ul>
            {tree.map((node) => (
              <PageNode
                key={node.id}
                node={node}
                depth={0}
                selectedId={selectedId}
                onSelect={onSelect}
                onCreateSub={(pid) => handleCreate(pid)}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
