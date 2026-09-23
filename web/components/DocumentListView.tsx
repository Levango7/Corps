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

import { useEffect, useRef, useState, useDeferredValue, type ComponentProps, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/lib/i18n-navigation";
import { Plus, Search, FileText, Loader2, X, Download, CheckSquare, Square, Eye, MoreHorizontal, Share2, Pencil, Trash2, FolderInput } from "lucide-react";
import { DocumentPreview } from "@/components/DocumentPreview";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api";
import { ExportPreview, type BatchDocument } from "@/components/ExportPreview";
import { DocumentListSkeleton } from "@/components/Skeleton";
import { QuickActionMenu, type QuickAction } from "@/components/QuickActionMenu";
import { useLongPress } from "@/lib/use-long-press";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import { useMotionTokens } from "@/lib/motion-tokens";

interface DocumentListItem {
  id: string;
  title: string;
  publishedAt: string | null;
  updatedAt: string;
  author: { id: string; name: string | null; email: string } | null;
}

export function DocumentListView({ wid }: { wid: string }) {
  const t = useTranslations("document");
  const tExport = useTranslations("exportPreview");
  const router = useRouter();
  // 动画 token：感知 F6 三档 + prefers-reduced-motion（见 §2.2 列表布局动画）
  const { slow, easeOut, reduced } = useMotionTokens();
  const [items, setItems] = useState<DocumentListItem[]>([]);
  const [q, setQ] = useState("");
  // M3 修复：搜索防抖——useDeferredValue 让输入快速变化时不立即触发请求，
  // React 会在空闲时提交 deferredQ，避免每个按键都打一次 API。
  const deferredQ = useDeferredValue(q);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const { toast } = useToast();
  const [previewDocument, setPreviewDocument] = useState<ComponentProps<typeof DocumentPreview>["document"] | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const actionInFlight = useRef(false);
  const previewRequest = useRef<AbortController | null>(null);
  const previewDialog = useRef<HTMLDialogElement>(null);

  // ── 长按快捷菜单（QuickActionMenu）──
  const [longPressOpen, setLongPressOpen] = useState(false);
  const [longPressX, setLongPressX] = useState(0);
  const [longPressY, setLongPressY] = useState(0);
  const [longPressItem, setLongPressItem] = useState<DocumentListItem | null>(null);

  const longPressHandlers = useLongPress((pos) => {
    setLongPressX(pos.x);
    setLongPressY(pos.y);
    setLongPressOpen(true);
  });

  const longPressActions: QuickAction[] = longPressItem
    ? [
        {
          icon: Eye,
          label: t("previewMode"),
          onClick: () => openPreview(longPressItem),
        },
        {
          icon: Pencil,
          label: t("rename"),
          onClick: () => router.push(`/w/${wid}/documents/${longPressItem.id}`),
        },
        {
          icon: FolderInput,
          label: t("move"),
          onClick: () => router.push(`/w/${wid}/documents/${longPressItem.id}`),
        },
        {
          icon: Share2,
          label: t("share"),
          onClick: () => runDocumentAction(longPressItem, "share"),
        },
        {
          icon: Trash2,
          label: t("delete"),
          onClick: () => router.push(`/w/${wid}/documents/${longPressItem.id}`),
          danger: true,
        },
      ]
    : [];

  // 原生模态对话框提供焦点圈定、Escape 关闭及关闭后的焦点恢复。
  useEffect(() => {
    if (previewDocument) previewDialog.current?.showModal();
  }, [previewDocument]);

  useEffect(() => {
    return () => previewRequest.current?.abort();
  }, [wid]);

  useEffect(() => {
    if (!menuId) return;
    const closeMenu = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest("[data-document-actions]")) setMenuId(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuId(null);
    };
    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuId]);

  async function openPreview(item: DocumentListItem) {
    previewRequest.current?.abort();
    const controller = new AbortController();
    previewRequest.current = controller;
    setPreviewId(item.id);
    try {
      const doc = await api<{ title: string; markdown: string }>(
        `/api/v1/workspaces/${wid}/documents/${item.id}`,
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) setPreviewDocument({ title: doc.title, content: doc.markdown, type: "markdown" });
    } catch {
      if (!controller.signal.aborted) toast("error", t("loadFailed"));
    } finally {
      if (!controller.signal.aborted) setPreviewId(null);
    }
  }

  async function runDocumentAction(item: DocumentListItem, action: "share" | "convert") {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setBusyId(item.id);
    setMenuId(null);
    try {
      const path = `/api/v1/workspaces/${wid}/documents/${item.id}/${action}`;
      if (action === "share") {
        const result = await api<{ shareUrl: string }>(path, {
          method: "POST",
          body: JSON.stringify({ visibility: "private", expiresIn: 24 }),
        });
        if (!result.shareUrl) throw new Error("Missing share URL");
        try {
          await navigator.clipboard.writeText(new URL(result.shareUrl, window.location.origin).href);
          toast("success", t("shareLinkCopied"));
        } catch {
          toast("error", t("shareCopyFailed"));
        }
      } else {
        const result = await api<{ content: string }>(path, {
          method: "POST",
          body: JSON.stringify({ format: "html" }),
        });
        if (typeof result.content !== "string") throw new Error("Invalid converted content");
        const url = URL.createObjectURL(new Blob([result.content], { type: "text/html;charset=utf-8" }));
        const link = document.createElement("a");
        try {
          link.href = url;
          link.download = `${item.title.replace(/[<>:"/\\\\|?*\u0000-\u001f]/g, "_").slice(0, 120).trim() || item.id}.html`;
          document.body.appendChild(link);
          link.click();
          toast("success", t("exportStarted"));
        } finally {
          link.remove();
          // 下载开始后再释放 URL，避免部分浏览器读取到失效资源。
          window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      }
    } catch {
      toast("error", t(action === "share" ? "shareFailed" : "exportFailed"));
    } finally {
      actionInFlight.current = false;
      setBusyId(null);
    }
  }

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
      setBatchTitle(tExport("batchTitle", { count: res.documentCount }));
      setBatchPreviewOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : tExport("batchExportFailed"));
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
        const title = titleMatch ? titleMatch[1].trim() : t("untitledDoc");
        // 提取 <div class="doc-meta"> 后的内容作为 markdown（HTML 形式）
        const contentMatch = sectionContent.match(
          /<div class="doc-meta">[\s\S]*?<\/div>([\s\S]*)/,
        );
        const contentHtml = contentMatch ? contentMatch[1].trim() : sectionContent;
        docs.push({ title, markdown: contentHtml });
      }
      return docs.length > 0
        ? docs
        : [{ title: tExport("batchExport"), markdown: html }];
    } catch {
      return [{ title: tExport("batchExport"), markdown: html }];
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
          className="inline-flex items-center gap-1.5 h-9 px-[var(--space-3)] rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)]"
        >
          {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          {t("newDocument")}
        </button>
      </div>

      {/* 搜索 */}
      <div className="relative mb-[var(--space-4)]">
        <Search
          size={14}
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
            <X size={14} />
          </button>
        )}
      </div>

      {/* 批量操作工具栏（选中数量 > 0 时显示） */}
      {selectedCount > 0 && (
        <div className="flex items-center gap-[var(--space-3)] mb-[var(--space-3)] px-[var(--space-4)] py-[var(--space-2)] rounded-[var(--radius-md)] bg-[var(--surface-2)] border border-[var(--border-soft)]">
          <span className="text-[length:var(--text-sm)] text-[var(--fg-2)]">
            {tExport("documentsSelectedInline", { count: selectedCount })}
          </span>
          <div className="flex-1" />
          <button
            onClick={toggleSelectAll}
            className="inline-flex items-center gap-1.5 h-8 px-[var(--space-3)] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
          >
            {allSelected ? <CheckSquare size={14} /> : <Square size={14} />}
            {allSelected ? tExport("deselectAll") : tExport("selectAll")}
          </button>
          <button
            onClick={handleBatchExport}
            disabled={batchExporting}
            className="inline-flex items-center gap-1.5 h-8 px-[var(--space-3)] rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)]"
          >
            {batchExporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {tExport("exportBatch")}
          </button>
        </div>
      )}

      {error && <p className="mb-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--danger)]">{error}</p>}

      {loading ? (
        <DocumentListSkeleton count={5} />
      ) : items.length === 0 ? (
        <div className="py-[var(--space-12)] text-center text-[var(--muted)]">
          <FileText size={32} className="mx-auto mb-[var(--space-3)] opacity-50" />
          <p>{q ? t("noSearchResults") : t("emptyState")}</p>
        </div>
      ) : (
        <LayoutGroup>
          <ul className="divide-y divide-[var(--border-soft)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
            <AnimatePresence initial={false}>
              {items.map((d) => {
                const author = d.author?.name || d.author?.email;
                const isSelected = selectedIds.has(d.id);
                return (
                  <motion.li
                    key={d.id}
                    // layout="position"：仅动画位置（等高项），跳过尺寸测量性能最优
                    // 删除/新增时剩余项自动平滑让位（见 §2.2）
                    layout={reduced ? false : "position"}
                    initial={reduced ? false : { opacity: 0, height: 0 }}
                    animate={reduced ? { opacity: 1 } : { opacity: 1, height: "auto" }}
                    // exit：fade + shrink（高度收折），剩余项 layout 让位
                    exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                    // var(--motion-slow) 220ms + var(--ease-out) 退场减速
                    transition={reduced ? { duration: 0 } : { duration: slow, ease: easeOut }}
                    className="relative"
                    onPointerDown={(e) => {
                      setLongPressItem(d);
                      longPressHandlers.onPointerDown(e);
                    }}
                    onPointerUp={longPressHandlers.onPointerUp}
                    onPointerLeave={longPressHandlers.onPointerLeave}
                    onPointerCancel={longPressHandlers.onPointerCancel}
                    onContextMenu={(e) => {
                      setLongPressItem(d);
                      longPressHandlers.onContextMenu(e);
                    }}
                  >
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
                      className="block px-[var(--space-4)] py-[var(--space-3)] pl-[var(--space-8)] pr-[6rem] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
                    >
                      <div className="flex items-center gap-2">
                        <FileText size={14} className="shrink-0 text-[var(--muted)]" />
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
                      <div className="mt-[var(--space-1)] ml-6 text-[length:var(--text-xs)] text-[var(--muted)] flex items-center gap-2">
                        {author && <span>{author}</span>}
                        <span>·</span>
                        <span>{t("updatedAt", { date: new Date(d.updatedAt).toLocaleString() })}</span>
                      </div>
                    </Link>
                    <div data-document-actions className="absolute right-[var(--space-3)] top-[var(--space-3)] flex items-center gap-1">
                      <button type="button" onClick={() => openPreview(d)} disabled={previewId === d.id} aria-label={t("previewMode")} title={t("previewMode")} className="p-2 rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]">
                        {previewId === d.id ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                      </button>
                      <button type="button" onClick={() => setMenuId(menuId === d.id ? null : d.id)} disabled={busyId !== null} aria-label={t("moreActions")} aria-expanded={menuId === d.id} aria-controls={`document-actions-${d.id}`} className="p-2 rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]">
                        {busyId === d.id ? <Loader2 size={14} className="animate-spin" /> : <MoreHorizontal size={14} />}
                      </button>
                      {menuId === d.id && (
                        <div id={`document-actions-${d.id}`} className="absolute right-0 top-full z-20 min-w-40 p-1 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-sm)]" onBlur={(event) => { if (!event.currentTarget.parentElement?.contains(event.relatedTarget)) setMenuId(null); }}>
                          <button type="button" onClick={() => runDocumentAction(d, "share")} className="flex w-full items-center gap-2 px-3 py-2 rounded-[var(--radius-sm)] text-[length:var(--text-sm)] text-[var(--fg)] hover:bg-[var(--surface-2)] focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"><Share2 size={14} />{t("share")}</button>
                          <button type="button" onClick={() => runDocumentAction(d, "convert")} className="flex w-full items-center gap-2 px-3 py-2 rounded-[var(--radius-sm)] text-[length:var(--text-sm)] text-[var(--fg)] hover:bg-[var(--surface-2)] focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"><Download size={14} />{t("export")}</button>
                        </div>
                      )}
                    </div>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        </LayoutGroup>
      )}

      <dialog
        ref={previewDialog}
        aria-label={t("previewMode")}
        onClose={() => setPreviewDocument(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            const bounds = event.currentTarget.getBoundingClientRect();
            if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) previewDialog.current?.close();
          }
        }}
        className="m-auto w-[calc(100%-var(--space-8))] max-w-4xl max-h-[90dvh] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)] text-[var(--fg)] shadow-[var(--elev-sm)] backdrop:bg-[var(--overlay)]"
      >
        <div className="flex justify-end mb-[var(--space-2)]">
          <button type="button" autoFocus onClick={() => previewDialog.current?.close()} aria-label={t("close")} className="p-2 rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"><X size={16} /></button>
        </div>
        {previewDocument && <DocumentPreview document={previewDocument} />}
      </dialog>

      {/* ── 批量导出预览模态框（F4）── */}
      <ExportPreview
        title={batchTitle}
        markdown=""
        open={batchPreviewOpen}
        onClose={() => setBatchPreviewOpen(false)}
        batchMode
        documents={batchDocuments}
      />

      {/* ── 长按快捷菜单 ── */}
      <QuickActionMenu
        open={longPressOpen}
        onClose={() => setLongPressOpen(false)}
        actions={longPressActions}
        x={longPressX}
        y={longPressY}
      />
    </div>
  );
}
