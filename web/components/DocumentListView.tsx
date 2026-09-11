"use client";

/**
 * 工作区文档列表页：搜索 + 新建 + 入口到编辑页 + 批量导出（F4）。
 *
 * 数据流：useEffect 拉 GET /documents 列表；搜索是受控 input + 拉取。
 * 新建：POST /documents 获取 id 后跳到编辑页。
 * 批量导出（F4 任务 188）：
 *  - 每个文档行添加复选框
 *  - 选中数量 > 0 时显示批量操作工具栏（全选/取消全选 + 批量导出 + 选中数量）
 *  - 点击"批量导出"：POST /documents/batch-export → 打开 ExportPreview 批量模式预览
 */

import { useEffect, useState, useDeferredValue, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/lib/i18n-navigation";
import { Plus, Search, FileText, Loader2, X, Download, CheckSquare, Square } from "lucide-react";
import { api } from "@/lib/api";
import { ExportPreview, type BatchDocument } from "@/components/ExportPreview";

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
  // M3 修复：搜索防抖——useDeferredValue 让输入快速变化时不立即触发请求，
  // React 会在空闲时提交 deferredQ，避免每个按键都打一次 API。
  const deferredQ = useDeferredValue(q);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  // ── 批量导出状态（F4 任务 188）──
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchExporting, setBatchExporting] = useState(false);
  const [batchPreviewOpen, setBatchPreviewOpen] = useState(false);
  const [batchDocuments, setBatchDocuments] = useState<BatchDocument[]>([]);
  const [batchTitle, setBatchTitle] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (deferredQ) params.set("q", deferredQ);
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
  }, [wid, deferredQ]);

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

  // ── 批量选择操作 ──
  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map((d) => d.id)));
    }
  }

  // ── 批量导出 ──
  async function handleBatchExport() {
    if (selectedIds.size === 0 || batchExporting) return;
    setBatchExporting(true);
    setError("");
    try {
      const res = await api<{ html: string; documentCount: number }>(
        `/api/v1/workspaces/${wid}/documents/batch-export`,
        {
          method: "POST",
          body: JSON.stringify({
            documentIds: [...selectedIds],
            format: "pdf",
            includeTableOfContents: true,
          }),
        },
      );

      // 从返回的 HTML 中提取文档内容用于预览
      // API 返回完整 HTML 文档，这里提取每个 section 的内容用于 ExportPreview 预览
      const docs = extractDocumentsFromHtml(res.html);

      setBatchDocuments(docs);
      setBatchTitle(`批量导出 (${res.documentCount}个文档)`);
      setBatchPreviewOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "批量导出失败");
    } finally {
      setBatchExporting(false);
    }
  }

  /**
   * 从 batch-export API 返回的合并 HTML 中提取文档列表用于 ExportPreview 预览。
   * 解析 <section class="doc-section" id="doc-N"> 中的 <h1> 标题和后续内容。
   *
   * 兜底：若解析失败，返回单个文档占位（标题=批量导出，markdown=原始 HTML），
   * 保证预览不空白。
   */
  function extractDocumentsFromHtml(html: string): BatchDocument[] {
    try {
      const docs: BatchDocument[] = [];
      // 匹配每个 doc-section（排除 toc section）
      const sectionRegex =
        /<section class="doc-section" id="doc-(\d+)">([\s\S]*?)<\/section>/g;
      let match: RegExpExecArray | null;
      while ((match = sectionRegex.exec(html)) !== null) {
        const sectionContent = match[2];
        // 提取 <h1> 标题
        const titleMatch = sectionContent.match(/<h1>([\s\S]*?)<\/h1>/);
        const title = titleMatch ? titleMatch[1].trim() : "未命名文档";
        // 提取 <div class="doc-meta"> 后的内容作为 markdown（HTML 形式）
        const contentMatch = sectionContent.match(
          /<div class="doc-meta">[\s\S]*?<\/div>([\s\S]*)/,
        );
        const contentHtml = contentMatch ? contentMatch[1].trim() : sectionContent;
        docs.push({ title, markdown: contentHtml });
      }
      return docs.length > 0
        ? docs
        : [{ title: "批量导出", markdown: html }];
    } catch {
      return [{ title: "批量导出", markdown: html }];
    }
  }

  const selectedCount = selectedIds.size;
  const allSelected = items.length > 0 && selectedIds.size === items.length;

  return (
    <div className="max-w-[var(--container-max)] mx-auto px-[var(--space-4)] py-[var(--space-6)]">
      <div className="flex items-center justify-between mb-[var(--space-5)]">
        <h1 className="text-[length:var(--text-2xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tracking-[var(--tracking-tight)]">
          {t("listTitle")}
        </h1>
        <button
          onClick={createDoc}
          disabled={creating}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)]"
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
            className="absolute right-[var(--space-2)] top-1/2 -translate-y-1/2 p-1 rounded-[var(--radius-sm)] text-[var(--meta)] hover:text-[var(--fg)]"
            aria-label={t("clearSearch")}
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* 批量操作工具栏（选中数量 > 0 时显示） */}
      {selectedCount > 0 && (
        <div className="flex items-center gap-3 mb-[var(--space-3)] px-[var(--space-4)] py-[var(--space-2)] rounded-[var(--radius-md)] bg-[var(--surface-2)] border border-[var(--border-soft)]">
          <span className="text-[length:var(--text-sm)] text-[var(--fg-2)]">
            已选择 <span className="font-[weight:var(--weight-semibold)] text-[var(--fg)]">{selectedCount}</span> 个文档
          </span>
          <div className="flex-1" />
          <button
            onClick={toggleSelectAll}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
          >
            {allSelected ? <CheckSquare size={14} /> : <Square size={14} />}
            {allSelected ? "取消全选" : "全选"}
          </button>
          <button
            onClick={handleBatchExport}
            disabled={batchExporting}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)]"
          >
            {batchExporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            批量导出
          </button>
        </div>
      )}

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
            const isSelected = selectedIds.has(d.id);
            return (
              <li key={d.id} className="relative">
                {/* 复选框（绝对定位在左侧） */}
                <label
                  className="absolute left-[var(--space-3)] top-1/2 -translate-y-1/2 z-10 cursor-pointer inline-flex items-center justify-center w-4 h-4"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(d.id)}
                    className="w-4 h-4 rounded-[var(--radius-sm)] border border-[var(--border)] accent-[var(--accent)] cursor-pointer"
                  />
                </label>
                <Link
                  href={`/w/${wid}/documents/${d.id}`}
                  className="block px-[var(--space-4)] py-3 pl-[var(--space-8)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
                >
                  <div className="flex items-center gap-2">
                    <FileText size={15} className="shrink-0 text-[var(--muted)]" />
                    <span className="flex-1 min-w-0 text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)] truncate">
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
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {/* ── 批量导出预览模态框（F4）── */}
      <ExportPreview
        title={batchTitle}
        markdown=""
        open={batchPreviewOpen}
        onClose={() => setBatchPreviewOpen(false)}
        batchMode
        documents={batchDocuments}
      />
    </div>
  );
}
