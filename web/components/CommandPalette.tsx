"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "@/lib/i18n-navigation";
import { Search, FileText, CheckSquare, CornerDownLeft, Scale, X } from "lucide-react";
import { api } from "@/lib/api";
import { useTranslations } from "next-intl";
import { MODULE_ICONS, type ModuleIconName } from "@/lib/modules/icons";
import { WORKSPACE_MODULES, moduleHref } from "@/lib/modules/registry";

/** 搜索结果类型 */
type SearchType = "document" | "task" | "decision";

interface CmdItem {
  id: string;
  /** 渲染文案：搜索结果为原文；导航项走 titleKey（此时 title 可缺省） */
  title?: string;
  /** 导航项的翻译 key（阶段 2-6 i18n）：完整路径如 "nav.menu.overview"，显示经 tNav(titleKey) */
  titleKey?: string;
  kind: SearchType | "nav";
  href: string;
  icon: typeof FileText;
  /** 分组提示翻译 key（nav.menu.*） */
  hintKey?: string;
  /** hintKey 渲染出的分组文案缓存（搜索结果注入时填充） */
  hint?: string;
  /** 搜索结果匹配上下文摘要（仅搜索结果项有值） */
  snippet?: string;
}

/** 搜索 API 返回的统一项 */
interface SearchItem {
  type: SearchType;
  id: string;
  title: string;
  snippet: string;
  href: string;
  updatedAt: string;
}

interface SearchResults {
  items: SearchItem[];
  total: number;
}

/** 高亮匹配文本：在 text 中标记 query 命中的首段 */
function highlight(text: string, query: string) {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-[var(--accent-soft)] text-[var(--accent)] rounded-[var(--radius-sm)] px-0.5">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

/** 搜索结果项的图标映射 */
const SEARCH_ICONS: Record<SearchType, typeof FileText> = {
  document: FileText,
  task: CheckSquare,
  decision: Scale,
};

/**
 * Cmd+K 独有的两项：注册表**刻意未收录**的产品差异（#300 接线时确定）。
 *
 * 为什么不并进 registry：registry 是侧栏 / 设置 / 模块可见性的事实源，这两项
 * 不在侧栏出现；并进去会改变侧栏与视觉基线。所以它们留在命令面板，但只保留
 * path / titleKey / icon 三项数据，不再重复写 href 模板与图标组件引用。
 */
const CMDK_EXTRA_NAV: readonly {
  id: string;
  titleKey: string;
  path: string;
  icon: ModuleIconName;
}[] = [
  { id: "nav-ai-usage", titleKey: "ai.usage.pageTitle", path: "/ai-usage", icon: "analytics" },
  { id: "nav-assistant", titleKey: "assistant.welcome", path: "/assistant", icon: "im" },
];

export default function CommandPalette({ wid, onClose }: { wid: string; onClose: () => void }) {
  const t = useTranslations("command");
  // 根命名空间：titleKey / hintKey 存的都是完整路径（nav.menu.*），
  // 若这里用 useTranslations("nav") 会二次叠加成 nav.nav.menu.*，全部 MISSING_MESSAGE。
  const tNav = useTranslations();
  const tSearch = useTranslations("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CmdItem[]>([]);
  const [cursor, setCursor] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  // 搜索失败标记：显示错误提示而非静默清空结果
  const [searchError, setSearchError] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  // 持有 go 的最新引用，供键盘 useEffect 使用，避免 stale closure
  const goRef = useRef<(href: string) => void>(() => {});

  // query 变化：防抖 300ms 后调用全局搜索端点（文档 + 任务 + 决策）
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setIsSearching(false);
      setSearchError(false);
      return;
    }
    // 防抖期间：尚未发出请求
    setIsSearching(false);
    setSearchError(false);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      // 请求发出
      setIsSearching(true);
      api<SearchResults>(`/api/v1/workspaces/${wid}/search?q=${encodeURIComponent(q)}`, {
        signal: controller.signal,
      })
        .then((data) => {
          setResults(
            (data?.items ?? []).map((item) => ({
              id: item.id,
              title: item.title,
              kind: item.type,
              href: item.href,
              icon: SEARCH_ICONS[item.type],
              snippet: item.snippet,
            })),
          );
          setSearchError(false);
        })
        .catch((err: unknown) => {
          // AbortError 是防抖/卸载触发的取消，不算真实失败
          if (err instanceof DOMException && err.name === "AbortError") return;
          setResults([]);
          setSearchError(true);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, wid]);

  const items = useMemo<CmdItem[]>(() => {
    // 单一事实源：导航项由 registry 派生，不再手写第二份清单。
    // 顺序即 registry 顺序（= 侧栏顺序）；空态仍只展示前 8 项。
    // id 保持旧形态：overview 用 nav-home（既有 E2E / 埋点按它索引），其余 nav-<id>。
    const navItems: CmdItem[] = [
      ...WORKSPACE_MODULES.map((m) => ({
        id: m.id === "overview" ? "nav-home" : `nav-${m.id}`,
        titleKey: `nav.${m.labelKey}`,
        kind: "nav" as const,
        href: moduleHref(m, wid),
        icon: MODULE_ICONS[m.icon],
      })),
      ...CMDK_EXTRA_NAV.map((item) => ({
        id: item.id,
        titleKey: item.titleKey,
        kind: "nav" as const,
        href: `/w/${wid}${item.path}`,
        icon: MODULE_ICONS[item.icon],
      })),
    ];

    const q = query.trim().toLowerCase();
    // query 为空：仅展示核心导航项（避免 33 项长列表；其余入口在搜索态可达）
    if (!q) return navItems.slice(0, 8);
    // query 非空：先本地匹配导航项（titleKey 翻译后 contains，零请求即时出），
    // 再拼接搜索端点返回的文档 + 任务 + 决策结果（分组显示）
    const matchedNav = navItems.filter((n) =>
      tNav(n.titleKey ?? "")
        .toLowerCase()
        .includes(q),
    );
    // 结果已按 updatedAt 倒序，但需按 type 分组：document → task → decision
    const typeOrder: Record<SearchType, number> = { document: 0, task: 1, decision: 2 };
    const sortedResults = [...results].sort((a, b) => {
      const ta = typeOrder[a.kind as SearchType];
      const tb = typeOrder[b.kind as SearchType];
      return ta - tb;
    });
    return [...matchedNav, ...sortedResults];
  }, [query, results, wid, tNav]);

  // 是否展示分组标题（仅搜索态下）
  const showGroups = query.trim().length > 0;

  // 结果集变化后把游标收回首项，避免指向越界
  useEffect(() => {
    setCursor(0);
  }, [query, results.length]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => (items.length === 0 ? 0 : (c + 1) % items.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => (items.length === 0 ? 0 : (c - 1 + items.length) % items.length));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const target = items[cursor];
        if (target) goRef.current(target.href);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, cursor]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const go = useCallback(
    (href: string) => {
      router.push(href);
      onClose();
    },
    [router, onClose],
  );

  // 把 go 的最新引用同步到 ref，供键盘 useEffect 使用，避免 stale closure。
  // 必须在 useEffect 中写入 ref，渲染期间直接赋值是 React 反模式。
  useEffect(() => {
    goRef.current = go;
  }, [go]);

  /** 分组标题翻译 key 映射 */
  const groupLabel = (kind: SearchType): string => {
    switch (kind) {
      case "document":
        return tSearch("groupDocuments");
      case "task":
        return tSearch("groupTasks");
      case "decision":
        return tSearch("groupDecisions");
    }
  };

  return (
    // ⚠️ 这里刻意**不**套用「遮罩转 presentational、语义下移」的写法。
    // 本仓库 PR #50 定下的约定是「遮罩元素自己带 role=dialog aria-modal」，
    // 且被两条硬断言固化：ui-layout.spec.ts 的「遮罩矩形 == 视口」与
    // fixed-overlay-portal.spec.ts 的「role=dialog 的**父节点**才是遮罩」。
    // 把 role 下移会让断言测到内容卡（实测 549×730 ≠ 1280），属于改坏约定。
    //
    // 那两条 jsx-a11y 违规改用另一条路清：把关闭处理器挂到一层
    // aria-hidden 的装饰层上 —— 交互规则会整体跳过 aria-hidden 元素
    // （见 tests/unit/a11y-baseline.test.ts 判定笔记 5），于是 role=dialog
    // 的遮罩自身不携带任何事件处理器，规则不再误报，行为完全不变。
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("ariaLabel")}
      className="modal-overlay fixed inset-0 z-[var(--z-modal)] flex items-start justify-center pt-[var(--cmd-palette-top)] px-4 bg-[var(--overlay)]"
    >
      <div className="absolute inset-0" aria-hidden="true" onClick={onClose} />
      <div className="modal-enter relative z-10 w-full max-w-[560px] bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-lg)] overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 h-12 border-b border-[var(--border-soft)]">
          <Search size={17} className="text-[var(--muted)] shrink-0" />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            className="flex-1 bg-transparent outline-none text-[length:var(--text-md)] text-[var(--fg)] placeholder:text-[var(--meta)]"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              className="w-6 h-6 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] shrink-0"
              aria-label={t("clearSearch")}
            >
              <X size={16} />
            </button>
          )}
          <kbd className="text-[length:var(--text-xs)] text-[var(--meta)] font-[family-name:var(--font-mono)] shrink-0">
            ESC
          </kbd>
        </div>

        <ul ref={listRef} className="max-h-[var(--cmd-palette-max-h)] overflow-y-auto py-1.5">
          {items.length === 0 && (
            <li
              className={`px-4 py-8 text-center text-[length:var(--text-sm)] ${
                searchError ? "text-[var(--danger)]" : "text-[var(--muted)]"
              }`}
            >
              {searchError
                ? t("searchFailed")
                : query.trim()
                  ? isSearching
                    ? t("searching")
                    : tSearch("noResults")
                  : t("noItems")}
            </li>
          )}
          {items.map((item, idx) => {
            const Icon = item.icon;
            const active = idx === cursor;
            const prev = items[idx - 1];
            // 分组标题显示：搜索态下，当前项 kind 与前一项不同时显示分组标题。
            // 搜索态 items 只含搜索结果（不含 nav），prev 为 undefined（首项）或不同 kind 时触发。
            const showGroupHeader = showGroups && item.kind !== "nav" && prev?.kind !== item.kind;
            return (
              <Fragment key={item.id}>
                {showGroupHeader && (
                  <li className="px-4 pt-2 pb-1 text-[length:var(--text-xs)] text-[var(--meta)] uppercase tracking-wide">
                    {groupLabel(item.kind as SearchType)}
                  </li>
                )}
                <li>
                  <button
                    data-idx={idx}
                    onMouseEnter={() => setCursor(idx)}
                    onClick={() => go(item.href)}
                    className={`w-full flex items-center gap-3 px-4 h-10 text-[length:var(--text-base)] transition-colors duration-[var(--motion-fast)] ${
                      active ? "bg-[var(--surface-2)] text-[var(--fg)]" : "text-[var(--fg-2)]"
                    }`}
                  >
                    <Icon
                      size={16}
                      className={`shrink-0 ${active ? "text-[var(--accent)]" : "text-[var(--meta)]"}`}
                    />
                    <span className="flex-1 text-left min-w-0">
                      <span className="block truncate">
                        {highlight(
                          item.titleKey ? tNav(item.titleKey) : (item.title ?? ""),
                          query.trim(),
                        )}
                      </span>
                      {item.snippet && (
                        <span className="block truncate text-[length:var(--text-xs)] text-[var(--meta)] mt-0.5">
                          {highlight(item.snippet, query.trim())}
                        </span>
                      )}
                    </span>
                    {item.hintKey && (
                      <span className="text-[length:var(--text-xs)] text-[var(--meta)] shrink-0">
                        {tNav(item.hintKey)}
                      </span>
                    )}
                    {active && <CornerDownLeft size={13} className="text-[var(--meta)] shrink-0" />}
                  </button>
                </li>
              </Fragment>
            );
          })}
        </ul>

        <div className="flex items-center gap-2 sm:gap-4 px-4 h-9 border-t border-[var(--border-soft)] bg-[var(--surface-2)] text-[length:var(--text-xs)] text-[var(--meta)]">
          <span>{t("kbdSelect")}</span>
          <span>{t("kbdOpen")}</span>
          <span className="ml-auto tabular-nums">{t("itemCount", { count: items.length })}</span>
        </div>
      </div>
    </div>
  );
}
