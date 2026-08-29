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
import Link from "next/link";
import { FileText, Search, Loader2, ChevronRight, X } from "lucide-react";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/Skeleton";
import { useTranslations } from "next-intl";

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
}

interface DecisionsResp {
  decisions: Decision[];
  total: number;
}

const PAGE_SIZE = 20;
const SUMMARY_LIMIT = 200;
const DEBOUNCE_MS = 300;

/**
 * 相对时间戳：刚刚 / N 分钟前 / N 小时前 / N 天前 / 月-日
 * 与概览页 relativeTime 保持一致风格。
 */
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
        setDecisions((prev) => (append ? [...prev, ...resp.decisions] : resp.decisions));
      } catch (e) {
        setError(e instanceof Error ? e.message : "加载失败");
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
    <div className="max-w-[800px] mx-auto">
      {/* ── 标题栏 ── */}
      <div className="mb-[var(--space-6)]">
        <h1 className="text-[length:var(--text-2xl)] font-[var(--weight-semibold)] text-[var(--fg)] tracking-[-0.01em]">
          决策记录
        </h1>
        <p className="mt-1 text-[length:var(--text-sm)] text-[var(--muted)]">
          {loading ? "正在读取决策" : `共 ${total} 条决策记录`}
        </p>
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
              className="absolute right-[var(--space-2)] top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-6 h-6 rounded-[var(--radius-sm)] text-[var(--meta)] hover:bg-[var(--surface-2)] hover:text-[var(--fg-2)] transition-colors duration-[var(--motion-fast)]"
            >
              <X size={14} />
            </button>
          )}
        </div>
        {/* 结果计数：搜索时显示，避免与标题栏 total 重复 */}
        {isSearching && !loading && (
          <p className="mt-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--meta)]">
            匹配 {decisions.length} / {total} 条
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
                <li key={d.id} className="relative pl-[var(--space-8)]">
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
                        className="flex items-center gap-1 min-w-0 flex-1 text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--fg)] hover:text-[var(--accent)] transition-colors duration-[var(--motion-fast)]"
                      >
                        <span className="truncate">{d.taskTitle || "未命名任务"}</span>
                        <ChevronRight size={13} className="shrink-0 text-[var(--meta)]" />
                      </Link>
                      <span className="shrink-0 px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--surface-2)] border border-[var(--border)] text-[length:var(--text-xs)] font-[family-name:var(--font-mono)] text-[var(--fg-2)]">
                        v{d.version}
                      </span>
                    </header>

                    {/* 中间：markdown 内容摘要（纯文本，截取 200 字符） */}
                    <div className="px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--fg-2)] leading-[1.7]">
                      {summary ? (
                        <p className="whitespace-pre-wrap break-words">{summary}</p>
                      ) : (
                        <span className="text-[var(--meta)]">（无内容）</span>
                      )}
                    </div>

                    {/* 底部：作者 + 创建时间 + 更新时间 */}
                    <footer className="flex items-center gap-[var(--space-2)] px-[var(--space-4)] py-2 border-t border-[var(--border-soft)] text-[length:var(--text-xs)] text-[var(--meta)]">
                      <span className="truncate">{d.authorName || "未知作者"}</span>
                      {createdRel && (
                        <>
                          <span className="shrink-0">·</span>
                          <span className="shrink-0 tabular-nums">{createdRel}</span>
                        </>
                      )}
                      {isUpdated && updatedRel && (
                        <>
                          <span className="shrink-0">·</span>
                          <span className="shrink-0 tabular-nums">更新于 {updatedRel}</span>
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
                className="inline-flex items-center gap-2 h-9 px-5 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:border-[var(--muted)] disabled:opacity-60 disabled:cursor-not-allowed transition-colors duration-[var(--motion-fast)]"
              >
                {loadingMore ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    加载中
                  </>
                ) : (
                  <>{t("loadMore")}</>
                )}
              </button>
            </div>
          )}
        </>
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
        <div key={i} className="relative pl-[var(--space-8)]">
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
        在任务详情中记录决策后，会在这里展示
      </p>
    </div>
  );
}
