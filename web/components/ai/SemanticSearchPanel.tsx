"use client";

/**
 * AI 语义搜索面板组件。
 *
 * 调用 POST /api/v1/ai/semantic-search（deepseek-reasoner）：
 *  - AI 理解查询意图并生成扩展关键词（同义词/相关概念/中英文变体）
 *  - 用扩展关键词在工作区内对消息/Wiki/待办/决策做多源 contains 搜索
 *  - 结果按类型分组展示，按关键词匹配度排序
 *
 * 交互流程：
 *  1. 用户输入查询、勾选搜索范围（消息/文档/待办/决策）
 *  2. 点击搜索按钮触发 API 调用
 *  3. 展示 expandedKeywords（AI 扩展了哪些关键词）+ intent（搜索意图）
 *  4. 按类型分组展示搜索结果，每组显示前 N 条
 *
 * Design token 颜色映射：
 *  - 面板边框/背景 → var(--border) / var(--surface)
 *  - 强调色 → var(--accent) / var(--accent-soft)
 *  - 次要文字 → var(--meta) / var(--muted)
 *  - 分组标题 → var(--fg-2)
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Search,
  Loader2,
  MessageSquare,
  FileText,
  CheckSquare,
  Gavel,
  Sparkles,
  CornerDownRight,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";

/** 搜索范围类型 */
type SearchScope = "messages" | "wikis" | "todos" | "decisions";

/** 后端返回的统一消息结果 */
interface MessageResult {
  id: string;
  body: string;
  createdAt: string;
  authorName: string | null;
  authorAvatar: string | null;
  matchCount: number;
}

/** 后端返回的统一 Wiki 结果 */
interface WikiResult {
  id: string;
  title: string;
  slug: string;
  content: string;
  updatedAt: string;
  matchCount: number;
}

/** 后端返回的统一待办结果 */
interface TodoResult {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  createdAt: string;
  assigneeName: string | null;
  matchCount: number;
}

/** 后端返回的统一决策结果 */
interface DecisionResult {
  id: string;
  taskTitle: string;
  markdown: string;
  version: number;
  createdAt: string;
  matchCount: number;
}

/** 后端返回的聚合数据 */
interface SemanticSearchData {
  messages: MessageResult[];
  wikis: WikiResult[];
  todos: TodoResult[];
  decisions: DecisionResult[];
  expandedKeywords: string[];
  intent: string;
}

interface SemanticSearchPanelProps {
  /** 工作区 ID */
  wid: string;
}

/** 范围选项配置：value → 图标 + i18n key */
const SCOPE_OPTIONS: { value: SearchScope; icon: typeof MessageSquare }[] = [
  { value: "messages", icon: MessageSquare },
  { value: "wikis", icon: FileText },
  { value: "todos", icon: CheckSquare },
  { value: "decisions", icon: Gavel },
];

/** 范围值 → i18n label key 映射 */
const SCOPE_LABEL_KEYS: Record<SearchScope, string> = {
  messages: "scopeMessages",
  wikis: "scopeWikis",
  todos: "scopeTodos",
  decisions: "scopeDecisions",
};

/** 截取文本摘要，超长则截断并加省略号 */
function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

/** 格式化 ISO 时间为本地短日期 */
function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  } catch {
    return iso;
  }
}

export function SemanticSearchPanel({ wid }: SemanticSearchPanelProps) {
  const t = useTranslations("ai.semanticSearch");

  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Set<SearchScope>>(
    new Set(["messages", "wikis", "todos", "decisions"]),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [result, setResult] = useState<SemanticSearchData | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // cancelled 标志：组件卸载时置 true，避免在已卸载组件上触发 setState
  const cancelledRef = useRef(false);
  // AbortController：中止进行中的 fetch 请求
  const abortRef = useRef<AbortController | null>(null);

  /** 切换搜索范围勾选 */
  const toggleScope = (value: SearchScope) => {
    setScope((prev) => {
      const next = new Set(prev);
      if (next.has(value)) {
        // 至少保留一个范围，避免空 scope
        if (next.size > 1) next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  };

  /** 执行语义搜索 */
  const handleSearch = async () => {
    const trimmed = query.trim();
    if (!trimmed || loading) return;

    if (cancelledRef.current) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoading(true);
    setError(false);
    setHasSearched(true);

    try {
      const data = await api<SemanticSearchData>("/api/v1/ai/semantic-search", {
        method: "POST",
        body: JSON.stringify({
          wid,
          query: trimmed,
          scope: Array.from(scope),
          limit: 20,
        }),
        signal: ac.signal,
      });
      if (cancelledRef.current || ac.signal.aborted) return;
      setResult(data);
    } catch (e) {
      if (cancelledRef.current || ac.signal.aborted) return;
      if (e instanceof Error && e.name === "AbortError") return;
      setError(true);
      setResult(null);
      if (
        process.env.NODE_ENV === "development" &&
        (e instanceof ApiError || e instanceof Error)
      ) {
        console.error("[SemanticSearchPanel] error:", e.message);
      }
    } finally {
      if (cancelledRef.current || ac.signal.aborted) return;
      setLoading(false);
    }
  };

  /** 回车触发搜索 */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleSearch();
    }
  };

  // 组件卸载时标记 cancelled、中止进行中的请求，避免在已卸载组件上触发 setState
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      abortRef.current?.abort();
    };
  }, []);

  const hasResults =
    result != null &&
    (result.messages.length > 0 ||
      result.wikis.length > 0 ||
      result.todos.length > 0 ||
      result.decisions.length > 0);

  return (
    <section
      className="flex w-full flex-col gap-[var(--space-4)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]"
      aria-label={t("title")}
    >
      {/* 标题 */}
      <header className="flex items-center gap-[var(--space-2)]">
        <Sparkles size={16} className="shrink-0 text-[var(--accent)]" />
        <h2 className="text-[length:var(--text-base)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
          {t("title")}
        </h2>
      </header>

      {/* 搜索输入框 */}
      <div className="relative flex items-center">
        <Search
          size={16}
          className="pointer-events-none absolute left-[var(--space-3)] shrink-0 text-[var(--muted)]"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("placeholder")}
          maxLength={200}
          disabled={loading}
          aria-label={t("placeholder")}
          className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] py-[var(--space-2)] pl-[calc(var(--space-3)*2+16px)] pr-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--fg)] placeholder:text-[var(--muted)] transition-colors duration-[var(--motion-fast)] focus:border-[var(--accent-ring)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:opacity-60"
        />
      </div>

      {/* 搜索范围 checkbox + 搜索按钮 */}
      <div className="flex flex-wrap items-center justify-between gap-[var(--space-3)]">
        <div className="flex flex-wrap items-center gap-[var(--space-3)]">
          {SCOPE_OPTIONS.map(({ value, icon: Icon }) => {
            const checked = scope.has(value);
            return (
              <label
                key={value}
                className="inline-flex cursor-pointer items-center gap-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--fg-2)] transition-colors duration-[var(--motion-fast)] hover:text-[var(--fg)]"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleScope(value)}
                  disabled={loading}
                  className="h-[14px] w-[14px] cursor-pointer accent-[var(--accent)]"
                />
                <Icon size={14} className="shrink-0 text-[var(--muted)]" />
                {t(SCOPE_LABEL_KEYS[value])}
              </label>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => void handleSearch()}
          disabled={loading || !query.trim()}
          className="inline-flex items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] bg-[var(--accent)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--accent-on)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--accent-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <Loader2 size={16} className="shrink-0 animate-spin" />
          ) : (
            <Search size={16} className="shrink-0" />
          )}
          {loading ? t("searching") : t("search")}
        </button>
      </div>

      {/* 加载状态 */}
      {loading && (
        <div className="flex items-center justify-center gap-[var(--space-2)] py-[var(--space-4)]">
          <Loader2 size={16} className="shrink-0 animate-spin text-[var(--muted)]" />
          <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
            {t("searching")}
          </span>
        </div>
      )}

      {/* 错误状态 */}
      {error && !loading && (
        <div className="flex items-center justify-center py-[var(--space-3)]">
          <p className="text-[length:var(--text-xs)] text-[var(--danger)]">
            {t("noResults")}
          </p>
        </div>
      )}

      {/* 搜索结果 */}
      {!loading && !error && result != null && (
        <div className="flex flex-col gap-[var(--space-4)]">
          {/* AI 扩展关键词 + 意图 */}
          {result.expandedKeywords.length > 0 && (
            <div className="flex flex-col gap-[var(--space-2)] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] p-[var(--space-3)]">
              <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                <span className="inline-flex items-center gap-[var(--space-1)] text-[length:var(--text-xs)] font-[weight:var(--weight-semibold)] text-[var(--accent)]">
                  <CornerDownRight size={14} className="shrink-0" />
                  {t("intent")}
                </span>
                <span className="text-[length:var(--text-xs)] text-[var(--fg-2)]">
                  {result.intent}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                <span className="text-[length:var(--text-xs)] font-[weight:var(--weight-semibold)] text-[var(--fg-2)]">
                  {t("expandedKeywords")}
                </span>
                {result.expandedKeywords.map((kw, i) => (
                  <span
                    key={`${kw}_${i}`}
                    className="inline-flex items-center rounded-[var(--radius-sm)] bg-[var(--accent-soft)] px-[var(--space-2)] py-[0.125rem] text-[length:var(--text-xs)] text-[var(--accent)]"
                  >
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 空结果 */}
          {!hasResults && (
            <p className="py-[var(--space-3)] text-center text-[length:var(--text-xs)] text-[var(--meta)]">
              {t("noResults")}
            </p>
          )}

          {/* 消息结果分组 */}
          {result.messages.length > 0 && (
            <ResultGroup
              icon={MessageSquare}
              label={t("resultMessages")}
              count={result.messages.length}
            >
              {result.messages.map((m) => (
                <li
                  key={m.id}
                  className="flex flex-col gap-[var(--space-1)] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] p-[var(--space-3)]"
                >
                  <div className="flex items-center justify-between gap-[var(--space-2)]">
                    <span className="text-[length:var(--text-xs)] font-[weight:var(--weight-semibold)] text-[var(--fg-2)]">
                      {m.authorName ?? "—"}
                    </span>
                    <div className="flex items-center gap-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--meta)]">
                      <span>{formatTime(m.createdAt)}</span>
                      <MatchBadge count={m.matchCount} />
                    </div>
                  </div>
                  <p className="break-words text-[length:var(--text-sm)] leading-relaxed text-[var(--fg-2)]">
                    {truncate(m.body, 200)}
                  </p>
                </li>
              ))}
            </ResultGroup>
          )}

          {/* Wiki 结果分组 */}
          {result.wikis.length > 0 && (
            <ResultGroup
              icon={FileText}
              label={t("resultWikis")}
              count={result.wikis.length}
            >
              {result.wikis.map((w) => (
                <li
                  key={w.id}
                  className="flex flex-col gap-[var(--space-1)] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] p-[var(--space-3)]"
                >
                  <div className="flex items-center justify-between gap-[var(--space-2)]">
                    <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
                      {w.title}
                    </span>
                    <div className="flex items-center gap-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--meta)]">
                      <span>{formatTime(w.updatedAt)}</span>
                      <MatchBadge count={w.matchCount} />
                    </div>
                  </div>
                  <p className="break-words text-[length:var(--text-xs)] leading-relaxed text-[var(--meta)]">
                    {truncate(w.content, 150)}
                  </p>
                </li>
              ))}
            </ResultGroup>
          )}

          {/* 待办结果分组 */}
          {result.todos.length > 0 && (
            <ResultGroup
              icon={CheckSquare}
              label={t("resultTodos")}
              count={result.todos.length}
            >
              {result.todos.map((todo) => (
                <li
                  key={todo.id}
                  className="flex flex-col gap-[var(--space-1)] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] p-[var(--space-3)]"
                >
                  <div className="flex items-center justify-between gap-[var(--space-2)]">
                    <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
                      {todo.title}
                    </span>
                    <div className="flex items-center gap-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--meta)]">
                      <span>{formatTime(todo.createdAt)}</span>
                      <MatchBadge count={todo.matchCount} />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--meta)]">
                    <span className="rounded-[var(--radius-sm)] bg-[var(--surface-3)] px-[var(--space-2)] py-[0.125rem]">
                      {todo.status}
                    </span>
                    <span className="rounded-[var(--radius-sm)] bg-[var(--surface-3)] px-[var(--space-2)] py-[0.125rem]">
                      {todo.priority}
                    </span>
                    {todo.assigneeName && (
                      <span>{todo.assigneeName}</span>
                    )}
                  </div>
                  {todo.description && (
                    <p className="break-words text-[length:var(--text-xs)] leading-relaxed text-[var(--meta)]">
                      {truncate(todo.description, 150)}
                    </p>
                  )}
                </li>
              ))}
            </ResultGroup>
          )}

          {/* 决策结果分组 */}
          {result.decisions.length > 0 && (
            <ResultGroup
              icon={Gavel}
              label={t("resultDecisions")}
              count={result.decisions.length}
            >
              {result.decisions.map((d) => (
                <li
                  key={d.id}
                  className="flex flex-col gap-[var(--space-1)] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] p-[var(--space-3)]"
                >
                  <div className="flex items-center justify-between gap-[var(--space-2)]">
                    <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
                      {d.taskTitle}
                      <span className="ml-[var(--space-1)] text-[length:var(--text-xs)] font-[weight:var(--weight-normal)] text-[var(--meta)]">
                        v{d.version}
                      </span>
                    </span>
                    <div className="flex items-center gap-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--meta)]">
                      <span>{formatTime(d.createdAt)}</span>
                      <MatchBadge count={d.matchCount} />
                    </div>
                  </div>
                  <p className="break-words text-[length:var(--text-xs)] leading-relaxed text-[var(--meta)]">
                    {truncate(d.markdown, 200)}
                  </p>
                </li>
              ))}
            </ResultGroup>
          )}
        </div>
      )}

      {/* 初始空状态（未搜索） */}
      {!loading && !error && !hasSearched && (
        <p className="py-[var(--space-3)] text-center text-[length:var(--text-xs)] text-[var(--meta)]">
          {t("placeholder")}
        </p>
      )}
    </section>
  );
}

/** 结果分组容器：图标 + 标题 + 计数 + 子项列表 */
function ResultGroup({
  icon: Icon,
  label,
  count,
  children,
}: {
  icon: typeof MessageSquare;
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-[var(--space-2)]">
      <div className="flex items-center gap-[var(--space-2)]">
        <Icon size={16} className="shrink-0 text-[var(--accent)]" />
        <h3 className="text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg-2)]">
          {label}
        </h3>
        <span className="rounded-[var(--radius-sm)] bg-[var(--surface-3)] px-[var(--space-2)] py-[0.125rem] text-[length:var(--text-xs)] text-[var(--meta)]">
          {count}
        </span>
      </div>
      <ul className="flex flex-col gap-[var(--space-2)]">{children}</ul>
    </div>
  );
}

/** 匹配度徽章：显示关键词匹配次数 */
function MatchBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="inline-flex items-center rounded-[var(--radius-sm)] bg-[var(--accent-soft)] px-[var(--space-1)] py-[0.125rem] text-[length:var(--text-xs)] font-[weight:var(--weight-semibold)] text-[var(--accent)]"
      aria-label={`match ${count}`}
    >
      ×{count}
    </span>
  );
}

export default SemanticSearchPanel;