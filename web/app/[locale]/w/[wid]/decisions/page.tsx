"use client";

/**
 * 决策记录页 · /w/[wid]/decisions
 *
 * 时间线列表展示工作区内全部任务的决策记录：
 *  - 顶部搜索栏：按 markdown 内容关键词检索，debounce 300ms
 *  - 时间线卡片：左侧圆点 + 竖线连接，按 createdAt 降序
 *  - 卡片含关联任务标题（可跳转）、版本 badge、内容摘要、作者与时间
 *  - 底部"加载更多"分页，每次 20 条
 *
 * 设计参考概览页（max-w 容器、surface 卡片、Skeleton 占位）与
 * 任务详情页的决策卡片（版本 badge、相对时间）。
 * 所有色值走 var(--token)，间距/字号/圆角走 token，图标仅用 lucide-react。
 */

import { use, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@/lib/i18n-navigation";
import { FileText, Search, Loader2, ChevronRight, X, Sparkles, ClipboardCopy, ListChecks } from "lucide-react";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/Skeleton";
import { useToast } from "@/components/Toast";
import { useTranslations } from "next-intl";
import { relativeTime as sharedRelativeTime } from "@/lib/format";

interface Decision {
  id: string;
  taskId: string;
  taskTitle: string;
  markdown: string;
  version: number;
  authorId: string | null;
  authorName: string;
  createdAt: string;
  updatedAt: string;
  /**
   * 执行进度（F1 决策驱动执行）：
   *  - actionItemCount：行动项总数（null=后端尚未返回，前端不显示进度列）
   *  - actionItemCompleted：已完成行动项数
   * 由决策列表 API 内嵌（可选）；缺失时不渲染进度列，保持向后兼容。
   */
  actionItemCount?: number | null;
  actionItemCompleted?: number | null;
}

interface DecisionsResp {
  items: Decision[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

const PAGE_SIZE = 20;
const SUMMARY_LIMIT = 200;
const DEBOUNCE_MS = 300;

// 相对时间戳：走共享 format.ts（阶段 2-6 i18n——经 useTranslations("time") 输出当前语言）

/**
 * 将 markdown 转为纯文本并截取前 N 字符作为摘要。
 * 仅做轻量剥离（标题符号、强调、链接、代码、列表标记、HTML），
 * 不引入 markdown 解析依赖；摘要仅用于列表预览，完整内容在任务详情查看。
 */
function markdownToPlainText(md: string, limit = SUMMARY_LIMIT): string {
  const text = md
    // 去除标题井号
    .replace(/^#{1,6}\s+/gm, "")
    // 去除强调/加粗/斜体
    .replace(/(\*{1,3}|_{1,3})(.+?)\1/g, "$2")
    // 去除行内代码反引号
    .replace(/`([^`]+)`/g, "$1")
    // 去除图片
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    // 链接保留文本
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // 去除无序列表标记
    .replace(/^\s*[-*+]\s+/gm, "")
    // 去除有序列表标记
    .replace(/^\s*\d+\.\s+/gm, "")
    // 去除引用块 >
    .replace(/^\s*>\s?/gm, "")
    // 去除水平分隔线
    .replace(/^---+\s*$/gm, "")
    // 去除 HTML 标签
    .replace(/<[^>]+>/g, "")
    // 折叠多余空白
    .replace(/\n{2,}/g, "\n")
    .trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

export default function DecisionsPage({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = use(params);

  const t = useTranslations("decisions");
  const tTime = useTranslations("time");
  const { toast } = useToast();
  const relativeTime = (iso?: string) => sharedRelativeTime(iso, tTime);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  // 搜索：inputValue 即时跟随输入，query 为 debounce 后下发 API 的值
  const [inputValue, setInputValue] = useState("");
  const [query, setQuery] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 页码（从 1 开始），搜索条件变化时重置
  const pageRef = useRef(1);
  // T3.2：AbortController 用于取消上一次未完成的搜索请求
  const abortRef = useRef<AbortController | null>(null);

  const base = `/api/v1/workspaces/${wid}/decisions`;

  // AI 提炼对话框状态
  const [aiOpen, setAiOpen] = useState(false);
  const [aiSource, setAiSource] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiResult, setAiResult] = useState<{ title: string; markdown: string } | null>(null);
  const [aiErr, setAiErr] = useState("");

  async function handleExtract() {
    if (aiBusy) return;
    if (aiSource.trim().length < 10) {
      setAiErr(t("aiSourceTooShort"));
      return;
    }
    setAiBusy(true);
    setAiErr("");
    setAiResult(null);
    try {
      const j = await api<{ title: string; markdown: string }>(`${base}/extract`, {
        method: "POST",
        body: JSON.stringify({ sourceText: aiSource }),
      });
      setAiResult(j);
    } catch (e) {
      setAiErr(e instanceof Error ? e.message : t("aiFailed"));
    } finally {
      setAiBusy(false);
    }
  }

  async function copyAiMarkdown() {
    if (!aiResult) return;
    try {
      await navigator.clipboard.writeText(aiResult.markdown);
      toast("success", t("aiCopySuccess"));
    } catch {
      toast("error", t("aiCopyFailed"));
    }
  }

  function closeAi() {
    if (aiBusy) return;
    setAiOpen(false);
    setAiSource("");
    setAiResult(null);
    setAiErr("");
  }

  /**
   * 拉取决策列表。
   * @param q    搜索关键词
   * @param page 页码
   * @param append true=追加（加载更多），false=覆盖（首次/搜索）
   */
  const fetchDecisions = useCallback(
    async (q: string, page: number, append: boolean) => {
      if (!append) setLoading(true);
      else setLoadingMore(true);
      setError("");
      // 取消上一次未完成的请求
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: String(PAGE_SIZE),
        });
        if (q.trim()) params.set("q", q.trim());
        const resp = await api<DecisionsResp>(`${base}?${params.toString()}`, {
          signal: controller.signal,
        });
        setTotal(resp.total);
        setDecisions((prev) => (append ? [...prev, ...resp.items] : resp.items));
      } catch (e) {
        setError(e instanceof Error ? e.message : t("loadFailed"));
        if (!append) setDecisions([]);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [base],
  );

  // 首次加载
  useEffect(() => {
    fetchDecisions("", 1, false);
  }, [fetchDecisions]);

  /**
   * 搜索输入 debounce 300ms：
   * 输入变化时清除上一次定时器，300ms 后才更新 query 并重置页码、重新拉取。
   */
  function handleSearchChange(value: string) {
    setInputValue(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      pageRef.current = 1;
      setQuery(value);
      fetchDecisions(value, 1, false);
    }, DEBOUNCE_MS);
  }

  // 卸载时清掉定时器和未完成请求，避免 setState on unmounted
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, []);

  /** 加载更多：页码 +1，追加拉取 */
  function handleLoadMore() {
    if (loadingMore) return;
    const next = pageRef.current + 1;
    pageRef.current = next;
    fetchDecisions(query, next, true);
  }

  /** 清空搜索 */
  function handleClearSearch() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setInputValue("");
    setQuery("");
    pageRef.current = 1;
    fetchDecisions("", 1, false);
  }

  const hasMore = decisions.length < total;
  const isSearching = query.trim().length > 0;
  const isEmpty = !loading && decisions.length === 0;

  return (
    <div className="max-w-[var(--container-max)] mx-auto">
      {/* ── 标题栏 ── */}
      <div className="mb-[var(--space-6)] flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[length:var(--text-2xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tracking-[var(--tracking-tight)]">
            {t("title")}
          </h1>
          <p className="mt-1 text-[length:var(--text-sm)] text-[var(--muted)]">
            {loading ? t("loading") : t("count", { count: total })}
          </p>
        </div>
        <button
          onClick={() => setAiOpen(true)}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-fast)] shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
        >
          <Sparkles size={14} />
          {t("aiExtract")}
        </button>
      </div>

      {/* ── 搜索栏 ── */}
      <div className="mb-[var(--space-5)]">
        <div className="relative">
          <Search
            size={15}
            className="absolute left-[var(--space-3)] top-1/2 -translate-y-1/2 text-[var(--meta)] pointer-events-none"
          />
          <input
            type="text"
            value={inputValue}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchAria")}
            className="w-full h-10 pl-9 pr-9 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] text-[var(--fg)] placeholder:text-[var(--meta)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:border-[var(--accent)] transition-colors duration-[var(--motion-fast)]"
          />
          {inputValue && (
            <button
              type="button"
              onClick={handleClearSearch}
              aria-label={t("clearSearch")}
              className="absolute right-[var(--space-2)] top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-[var(--icon-lg)] h-[var(--icon-lg)] rounded-[var(--radius-sm)] text-[var(--meta)] hover:bg-[var(--surface-2)] hover:text-[var(--fg-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
            >
              <X size={14} />
            </button>
          )}
        </div>
        {/* 结果计数：搜索时显示，避免与标题栏 total 重复 */}
        {isSearching && !loading && (
          <p className="mt-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--meta)]">
            {t("matchCount", { matched: decisions.length, total })}
          </p>
        )}
      </div>

      {/* ── 错误提示 ── */}
      {error && (
        <div className="mb-[var(--space-4)] px-[var(--space-4)] py-[var(--space-3)] rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-sm)]">
          {error}
        </div>
      )}

      {/* ── 内容区 ── */}
      {loading ? (
        <DecisionsSkeleton count={4} />
      ) : isEmpty ? (
        <EmptyState searching={isSearching} />
      ) : (
        <>
          <ol className="relative">
            {decisions.map((d, i) => {
              const isLast = i === decisions.length - 1;
              const summary = markdownToPlainText(d.markdown);
              const createdRel = relativeTime(d.createdAt);
              const updatedRel = relativeTime(d.updatedAt);
              const isUpdated =
                d.updatedAt &&
                d.createdAt &&
                new Date(d.updatedAt).getTime() > new Date(d.createdAt).getTime();
              return (
                <li key={d.id} className="relative pl-[var(--space-4)] sm:pl-[var(--space-8)]">
                  {/* 时间线竖线：非末项时显示，连接到下一项节点 */}
                  {!isLast && (
                    <span
                      aria-hidden
                      className="absolute left-[7px] top-[18px] bottom-0 w-px bg-[var(--border)]"
                    />
                  )}
                  {/* 时间线圆点节点 */}
                  <span
                    aria-hidden
                    className="absolute left-0 top-[10px] w-[15px] h-[15px] rounded-full border-2 border-[var(--accent)] bg-[var(--surface)]"
                  />

                  <article className="mb-[var(--space-4)] bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] overflow-hidden">
                    {/* 顶部：关联任务标题 + 版本 badge */}
                    <header className="flex items-center gap-[var(--space-2)] px-[var(--space-4)] py-2.5 border-b border-[var(--border-soft)]">
                      <Link
                        href={`/w/${wid}/task/${d.taskId}`}
                        className="flex items-center gap-1 min-w-0 flex-1 text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)] hover:text-[var(--accent)] transition-colors duration-[var(--motion-fast)]"
                      >
                        <span className="truncate">{d.taskTitle || t("unnamedTask")}</span>
                        <ChevronRight size={13} className="shrink-0 text-[var(--meta)]" />
                      </Link>
                      <span className="shrink-0 px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--surface-2)] border border-[var(--border)] text-[length:var(--text-xs)] font-[family-name:var(--font-mono)] text-[var(--fg-2)]">
                        v{d.version}
                      </span>
                    </header>

                    {/* 中间：markdown 内容摘要（纯文本，截取 200 字符） */}
                    <div className="px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--fg-2)] leading-[var(--leading-relaxed)]">
                      {summary ? (
                        <p className="whitespace-pre-wrap break-words">{summary}</p>
                      ) : (
                        <span className="text-[var(--meta)]">{t("noContent")}</span>
                      )}
                    </div>

                    {/* 底部：作者 + 创建时间 + 更新时间 + 执行进度 */}
                    <footer className="flex items-center gap-[var(--space-2)] px-[var(--space-4)] py-2 border-t border-[var(--border-soft)] text-[length:var(--text-xs)] text-[var(--meta)]">
                      <span className="truncate">{d.authorName || t("unknownAuthor")}</span>
                      {createdRel && (
                        <>
                          <span className="shrink-0">·</span>
                          <span className="shrink-0 tabular-nums">{createdRel}</span>
                        </>
                      )}
                      {isUpdated && updatedRel && (
                        <>
                          <span className="shrink-0">·</span>
                          <span className="shrink-0 tabular-nums">
                            {t("updatedAtRel", { time: updatedRel })}
                          </span>
                        </>
                      )}
                      {/* F1 执行进度列：仅当后端返回 actionItemCount 时渲染 */}
                      {typeof d.actionItemCount === "number" && d.actionItemCount > 0 && (
                        <>
                          <span className="shrink-0">·</span>
                          <span className="shrink-0 inline-flex items-center gap-1 tabular-nums">
                            <ListChecks size={11} className="text-[var(--muted)]" />
                            {/* 迷你进度条：宽度按完成率填充 */}
                            <span className="inline-flex items-center gap-1">
                              <span className="relative inline-block w-10 h-1.5 rounded-full bg-[var(--surface-3)] overflow-hidden">
                                <span
                                  className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-[var(--motion-base)]"
                                  style={{
                                    width: `${Math.round(
                                      ((d.actionItemCompleted ?? 0) / (d.actionItemCount ?? 1)) * 100,
                                    )}%`,
                                    background:
                                      (d.actionItemCompleted ?? 0) >= (d.actionItemCount ?? 0)
                                        ? "var(--success)"
                                        : "var(--accent)",
                                  }}
                                />
                              </span>
                              <span>
                                {d.actionItemCompleted ?? 0}/{d.actionItemCount}
                              </span>
                            </span>
                          </span>
                        </>
                      )}
                    </footer>
                  </article>
                </li>
              );
            })}
          </ol>

          {/* ── 加载更多 ── */}
          {hasMore && (
            <div className="flex justify-center pt-[var(--space-2)]">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="inline-flex items-center gap-2 h-9 px-5 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:border-[var(--muted)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
              >
                {loadingMore ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    {t("loadingMore")}
                  </>
                ) : (
                  <>{t("loadMore")}</>
                )}
              </button>
            </div>
          )}
        </>
      )}

      {/* AI 提炼对话框：粘贴原始讨论 → 生成 markdown 草稿 → 复制后到任务详情粘贴 */}
      {aiOpen && (
        <div
          className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-[var(--overlay)] px-4"
          role="dialog"
          aria-modal="true"
          aria-label={t("aiDialogTitle")}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeAi();
          }}
        >
          <div className="w-full max-w-2xl bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-lg)] overflow-hidden max-h-[85dvh] flex flex-col">
            <div className="px-4 py-3 border-b border-[var(--border-soft)] flex items-center justify-between">
              <h2 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)] flex items-center gap-2">
                <Sparkles size={16} className="text-[var(--accent)]" />
                {t("aiDialogTitle")}
              </h2>
              <button
                onClick={closeAi}
                aria-label={t("aiClose")}
                className="p-1.5 rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
              >
                <X size={16} />
              </button>
            </div>
            <div className="px-4 py-3 overflow-y-auto flex-1">
              <label className="block text-[length:var(--text-xs)] text-[var(--muted)] mb-1.5">
                {t("aiSourceLabel")}
              </label>
              <textarea
                value={aiSource}
                onChange={(e) => setAiSource(e.target.value)}
                placeholder={t("aiSourcePlaceholder")}
                rows={8}
                className="w-full px-3 py-2 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[var(--fg)] text-[length:var(--text-sm)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)] resize-y font-[family-name:var(--font-mono)]"
              />
              {aiErr && (
                <p className="mt-2 text-[length:var(--text-xs)] text-[var(--danger-fg)]">{aiErr}</p>
              )}
              {aiResult && (
                <div className="mt-4 border border-[var(--border)] rounded-[var(--radius-md)] overflow-hidden">
                  <div className="px-3 py-2 bg-[var(--surface-2)] flex items-center justify-between gap-2">
                    <span className="text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] truncate">
                      {aiResult.title}
                    </span>
                    <button
                      onClick={copyAiMarkdown}
                      className="inline-flex items-center gap-1 px-2 h-7 text-[length:var(--text-xs)] text-[var(--fg-2)] rounded-[var(--radius-sm)] border border-[var(--border)] hover:bg-[var(--surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
                    >
                      <ClipboardCopy size={12} />
                      {t("aiCopy")}
                    </button>
                  </div>
                  <pre className="px-3 py-2 text-[length:var(--text-xs)] text-[var(--fg-2)] overflow-x-auto whitespace-pre-wrap break-words">
                    {aiResult.markdown}
                  </pre>
                </div>
              )}
            </div>
            <div className="px-4 py-3 border-t border-[var(--border-soft)] flex items-center justify-end gap-2">
              <button
                onClick={closeAi}
                className="h-9 px-3 text-[length:var(--text-sm)] text-[var(--fg-2)] rounded-[var(--radius-md)] hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
              >
                {t("aiClose")}
              </button>
              <button
                onClick={handleExtract}
                disabled={aiBusy || aiSource.trim().length < 10}
                className="inline-flex items-center gap-1.5 h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
              >
                {aiBusy && <Loader2 size={14} className="animate-spin" />}
                {aiResult ? t("aiReGenerate") : t("aiGenerate")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 决策列表 Skeleton：与时间线卡片尺寸对齐。
 * 渲染 count 条骨架，每条含节点占位 + 卡片（标题行 + 摘要 2 行 + 底部行）。
 */
function DecisionsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div aria-busy="true" className="relative">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="relative pl-[var(--space-4)] sm:pl-[var(--space-8)]">
          {/* 竖线 */}
          {i < count - 1 && (
            <span
              aria-hidden
              className="absolute left-[7px] top-[18px] bottom-0 w-px bg-[var(--border)]"
            />
          )}
          {/* 圆点 */}
          <Skeleton className="absolute left-0 top-[10px] w-[15px] h-[15px] rounded-full" />
          <div className="mb-[var(--space-4)] bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] overflow-hidden">
            {/* 标题行 */}
            <div className="flex items-center gap-[var(--space-2)] px-[var(--space-4)] py-2.5 border-b border-[var(--border-soft)]">
              <Skeleton
                className="flex-1 h-[14px]"
                style={{ maxWidth: `${55 + ((i * 23) % 30)}%` }}
              />
              <Skeleton className="shrink-0 w-8 h-[18px] rounded-[var(--radius-sm)]" />
            </div>
            {/* 摘要占位 2 行 */}
            <div className="px-[var(--space-4)] py-[var(--space-3)] space-y-2">
              <Skeleton className="w-full h-[12px]" />
              <Skeleton className="w-3/4 h-[12px]" />
            </div>
            {/* 底部行 */}
            <div className="flex items-center gap-[var(--space-2)] px-[var(--space-4)] py-2 border-t border-[var(--border-soft)]">
              <Skeleton className="w-16 h-[11px]" />
              <Skeleton className="w-20 h-[11px]" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * 空状态：
 *  - 搜索无结果：「没有找到匹配的决策记录」
 *  - 工作区无决策：FileText 图标 + 「暂无决策记录」+ 引导文案
 */
function EmptyState({ searching }: { searching: boolean }) {
  const t = useTranslations("decisions");
  const tEmpty = useTranslations("empty");
  if (searching) {
    return (
      <div className="px-[var(--space-4)] py-[var(--space-12)] flex flex-col items-center text-center">
        <Search
          size={40}
          className="text-[var(--muted)] opacity-40 mb-[var(--space-3)]"
          strokeWidth={1.5}
        />
        <p className="text-[length:var(--text-base)] text-[var(--fg-2)]">{t("noResultsMatch")}</p>
        <p className="mt-1 text-[length:var(--text-sm)] text-[var(--muted)]">
          {t("tryDifferentKeyword")}
        </p>
      </div>
    );
  }
  return (
    <div className="px-[var(--space-4)] py-[var(--space-12)] flex flex-col items-center text-center">
      <FileText
        size={48}
        className="text-[var(--muted)] opacity-40 mb-[var(--space-4)]"
        strokeWidth={1.5}
      />
      <p className="text-[length:var(--text-base)] text-[var(--fg-2)]">{tEmpty("noDecisions")}</p>
      <p className="mt-1 text-[length:var(--text-sm)] text-[var(--muted)]">
        {tEmpty("noDecisionsHint")}
      </p>
    </div>
  );
}
