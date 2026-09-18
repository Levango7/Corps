"use client";

/**
 * 消息搜索面板
 *
 * - 搜索输入框（带 Search 图标 + 300ms 防抖）
 * - 搜索结果列表：每条结果显示消息体摘要（关键词高亮）、作者、会话名、时间
 * - 点击搜索结果跳转到对应会话的消息
 * - 空状态 / loading / error 状态
 *
 * API：GET /api/v1/im/search?workspaceId=xxx&q=keyword&limit=20
 *   后端使用 PostgreSQL tsvector 全文检索（messages.body_tsv + GIN 索引）
 *
 * 所有样式走 design token（var(--*)），无裸 hex。
 * lucide-react 图标尺寸用 14/16（项目约定）。
 * i18n 使用 next-intl，key 在 im.search 命名空间。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { Search, X, Loader2, MessageSquare } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { api } from "@/lib/api";

interface MessageSearchProps {
  /** 当前工作区 ID */
  workspaceId: string;
  /** 点击搜索结果跳转到对应会话的消息 */
  onJumpToMessage?: (conversationId: string, messageId: string) => void;
  /** 可选：限定搜索的会话 ID */
  conversationId?: string;
}

/** 搜索结果项（与后端 API 响应对齐） */
interface SearchResult {
  /** 消息 ID */
  messageId: string;
  /** 消息体（可能被截断） */
  body: string;
  /** 作者 ID */
  authorId: string | null;
  /** 作者名称 */
  authorName: string | null;
  /** 作者头像 */
  authorImage: string | null;
  /** 会话 ID */
  conversationId: string | null;
  /** 会话标题 */
  conversationTitle: string | null;
  /** 消息创建时间（ISO 8601） */
  createdAt: string;
  /** ts_rank 相关性得分 */
  rank: number;
}

/** 搜索结果最大返回条数 */
const SEARCH_LIMIT = 20;
/** 搜索 debounce 延迟（毫秒） */
const DEBOUNCE_MS = 300;
/** 消息摘要最大显示长度 */
const BODY_MAX_LENGTH = 120;

/** 格式化时间：根据 locale 显示日期 + 时间 */
function formatTime(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 关键词高亮：将文本中匹配关键词的部分用 <mark> 包裹。
 * 大小写不敏感匹配，保留原文大小写。
 * 高亮样式走 design token（var(--accent-soft) 背景 + var(--accent) 文字）。
 */
function highlightKeyword(text: string, keyword: string): ReactNode[] {
  const trimmed = keyword.trim();
  if (!trimmed) return [text];

  const nodes: ReactNode[] = [];
  const lowerText = text.toLowerCase();
  const lowerKeyword = trimmed.toLowerCase();
  let lastIndex = 0;
  let index = lowerText.indexOf(lowerKeyword, lastIndex);
  let key = 0;

  while (index !== -1) {
    // 匹配前的普通文本
    if (index > lastIndex) {
      nodes.push(text.slice(lastIndex, index));
    }
    // 高亮匹配段
    nodes.push(
      <mark
        key={`hl-${key++}`}
        className="rounded-[var(--radius-sm)] bg-[var(--accent-soft)] px-0.5 text-[var(--accent)]"
      >
        {text.slice(index, index + trimmed.length)}
      </mark>,
    );
    lastIndex = index + trimmed.length;
    index = lowerText.indexOf(lowerKeyword, lastIndex);
  }

  // 尾部剩余普通文本
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

export function MessageSearch({ workspaceId, onJumpToMessage, conversationId }: MessageSearchProps) {
  const t = useTranslations("im.search");
  const locale = useLocale();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // debounce 计时器引用
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 当前请求的 AbortController（避免竞态：旧请求结果覆盖新请求）
  const abortRef = useRef<AbortController | null>(null);

  /** 执行搜索请求 */
  const doSearch = useCallback(
    async (keyword: string) => {
      // 取消上一次未完成请求
      if (abortRef.current) {
        abortRef.current.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setError(null);
      try {
        // 构造 query string：workspaceId + q + limit + 可选 conversationId
        const qs = new URLSearchParams({
          workspaceId,
          q: keyword,
          limit: String(SEARCH_LIMIT),
        });
        if (conversationId) {
          // P1-fix: 后端 schema 期望 cid 参数（非 conversationId）
          qs.set("cid", conversationId);
        }
        const data = await api<SearchResult[]>(
          `/api/v1/im/search?${qs.toString()}`,
          { signal: controller.signal },
        );
        setResults(data ?? []);
        setHasSearched(true);
      } catch (err) {
        // AbortError 是正常取消，不显示错误
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : t("error"));
        setResults([]);
        setHasSearched(true);
      } finally {
        setLoading(false);
      }
    },
    [workspaceId, conversationId, t],
  );

  // —— debounce 搜索 ——
  useEffect(() => {
    const keyword = query.trim();
    if (!keyword) {
      setResults([]);
      setHasSearched(false);
      setError(null);
      return;
    }

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      doSearch(keyword);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, doSearch]);

  // —— 组件卸载时取消进行中的请求 ——
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  /** 输入变化 */
  const handleChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
  }, []);

  /** 清空搜索 */
  const handleClear = useCallback(() => {
    setQuery("");
    setResults([]);
    setHasSearched(false);
    setError(null);
  }, []);

  /** 点击搜索结果 */
  const handleResultClick = useCallback(
    (result: SearchResult) => {
      if (result.conversationId) {
        onJumpToMessage?.(result.conversationId, result.messageId);
      }
    },
    [onJumpToMessage],
  );

  /** 获取作者显示名 */
  const getAuthorName = (r: SearchResult): string =>
    r.authorName ?? t("unknownAuthor");

  /** 获取作者头像首字母 */
  const getInitial = (r: SearchResult): string =>
    (r.authorName ?? "?")[0]?.toUpperCase() ?? "?";

  /** 截断消息体 */
  const truncateBody = useMemo(
    () => (body: string): string => {
      if (body.length <= BODY_MAX_LENGTH) return body;
      return body.slice(0, BODY_MAX_LENGTH) + "…";
    },
    [],
  );

  const keyword = query.trim();

  return (
    <div className="flex flex-col h-full bg-[var(--surface)]">
      {/* 搜索输入框 */}
      <div className="shrink-0 px-[var(--space-3)] py-[var(--space-2)] border-b border-[var(--border)]">
        <div className="flex items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] rounded-[var(--radius-md)] bg-[var(--surface-2)] border border-[var(--border)] focus-within:border-[var(--accent)] focus-within:ring-2 focus-within:ring-[var(--accent-ring)] transition-colors duration-[var(--motion-fast)]">
          <Search size={16} className="shrink-0 text-[var(--meta)]" />
          <input
            type="text"
            value={query}
            onChange={handleChange}
            placeholder={t("placeholder")}
            className="flex-1 min-w-0 bg-transparent text-[length:var(--text-sm)] text-[var(--fg)] outline-none placeholder:text-[var(--meta)]"
          />
          {query && (
            <button
              type="button"
              onClick={handleClear}
              aria-label={t("clear")}
              className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-3)] transition-colors duration-[var(--motion-fast)]"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* 搜索结果列表 */}
      <div className="flex-1 overflow-y-auto">
        {/* loading 状态 */}
        {loading && (
          <div className="flex items-center justify-center py-[var(--space-8)] text-[var(--meta)]">
            <Loader2 size={16} className="animate-spin" />
            <span className="ml-[var(--space-2)] text-[length:var(--text-sm)]">
              {t("searching")}
            </span>
          </div>
        )}

        {/* 错误状态 */}
        {!loading && error && (
          <div className="flex flex-col items-center justify-center py-[var(--space-8)] text-[var(--meta)]">
            <span className="text-[length:var(--text-sm)]">{error}</span>
          </div>
        )}

        {/* 空状态：已搜索但无结果 */}
        {!loading && !error && hasSearched && results.length === 0 && (
          <div className="flex flex-col items-center justify-center py-[var(--space-8)] text-[var(--meta)]">
            <MessageSquare size={24} className="mb-[var(--space-2)] opacity-50" />
            <span className="text-[length:var(--text-sm)]">
              {t("noResults", { keyword })}
            </span>
          </div>
        )}

        {/* 初始状态提示 */}
        {!loading && !error && !hasSearched && (
          <div className="flex flex-col items-center justify-center py-[var(--space-8)] text-[var(--meta)]">
            <Search size={24} className="mb-[var(--space-2)] opacity-40" />
            <span className="text-[length:var(--text-sm)]">
              {t("hint")}
            </span>
          </div>
        )}

        {/* 搜索结果 */}
        {!loading && !error && results.length > 0 && (
          <ul className="py-1">
            {results.map((r) => (
              <li key={r.messageId}>
                <button
                  type="button"
                  onClick={() => handleResultClick(r)}
                  className="w-full flex items-start gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] text-left"
                >
                  {/* 作者头像 */}
                  <div className="shrink-0 w-7 h-7 rounded-full bg-[var(--surface-3)] text-[var(--muted)] flex items-center justify-center text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] overflow-hidden">
                    {r.authorImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.authorImage}
                        alt={getAuthorName(r)}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      getInitial(r)
                    )}
                  </div>

                  {/* 消息信息 */}
                  <div className="min-w-0 flex-1">
                    {/* 作者 + 会话名 + 时间 */}
                    <div className="flex items-center gap-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--meta)]">
                      <span className="font-[weight:var(--weight-medium)] text-[var(--fg-2)] truncate">
                        {getAuthorName(r)}
                      </span>
                      <span>·</span>
                      <span className="truncate">
                        {r.conversationTitle ?? t("defaultConversation")}
                      </span>
                      <span>·</span>
                      <span className="shrink-0">{formatTime(r.createdAt, locale)}</span>
                    </div>
                    {/* 消息体摘要（关键词高亮） */}
                    <p className="mt-0.5 text-[length:var(--text-sm)] text-[var(--fg)] line-clamp-2 break-words">
                      {highlightKeyword(truncateBody(r.body), keyword)}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
