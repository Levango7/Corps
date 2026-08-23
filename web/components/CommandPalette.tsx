"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  LayoutDashboard,
  FileText,
  CheckSquare,
  CornerDownLeft,
  Kanban,
  Users,
  CreditCard,
  Settings,
  X,
} from "lucide-react";
import { api } from "@/lib/api";

interface CmdItem {
  id: string;
  title: string;
  kind: "task" | "nav" | "decision";
  href: string;
  icon: typeof FileText;
  hint?: string;
}

/** 搜索 API 返回的任务项 */
interface SearchTaskItem {
  id: string;
  title: string;
  status: string;
  priority: string;
  kind: "task";
}

/** 搜索 API 返回的决策项 */
interface SearchDecisionItem {
  id: string;
  kind: "decision";
  title: string;
  snippet: string;
  taskId: string;
  href: string;
}

interface SearchResults {
  tasks: SearchTaskItem[];
  decisions: SearchDecisionItem[];
}

/** 高亮匹配文本：在 text 中标记 query 命中的首段 */
function highlight(text: string, query: string) {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-[var(--accent-soft)] text-[var(--accent)] rounded px-0.5">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export default function CommandPalette({ wid, onClose }: { wid: string; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ tasks: CmdItem[]; decisions: CmdItem[] }>({
    tasks: [],
    decisions: [],
  });
  const [cursor, setCursor] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  // 持有 go 的最新引用，供键盘 useEffect 使用，避免 stale closure
  const goRef = useRef<(href: string) => void>(() => {});

  // query 变化：防抖 300ms 后调用全局搜索端点（任务标题 + 决策 markdown）
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults({ tasks: [], decisions: [] });
      setIsSearching(false);
      return;
    }
    // 防抖期间：尚未发出请求
    setIsSearching(false);
    const timer = setTimeout(() => {
      // 请求发出
      setIsSearching(true);
      api<SearchResults>(`/api/v1/workspaces/${wid}/search?q=${encodeURIComponent(q)}`)
        .then((data) => {
          setResults({
            tasks: (data?.tasks ?? []).map((t) => ({
              id: t.id,
              title: t.title,
              kind: "task" as const,
              href: `/w/${wid}/task/${t.id}`,
              icon: CheckSquare,
              hint: "任务",
            })),
            decisions: (data?.decisions ?? []).map((d) => ({
              id: d.id,
              title: d.title,
              kind: "decision" as const,
              href: d.href,
              icon: FileText,
              hint: "决策",
            })),
          });
        })
        .catch(() => setResults({ tasks: [], decisions: [] }));
    }, 300);
    return () => clearTimeout(timer);
  }, [query, wid]);

  const items = useMemo<CmdItem[]>(() => {
    const navItems: CmdItem[] = [
      { id: "nav-home", title: "概览", kind: "nav", href: `/w/${wid}`, icon: LayoutDashboard },
      { id: "nav-board", title: "看板", kind: "nav", href: `/w/${wid}/board`, icon: Kanban },
      { id: "nav-members", title: "成员", kind: "nav", href: `/w/${wid}/members`, icon: Users },
      {
        id: "nav-billing",
        title: "计费",
        kind: "nav",
        href: `/w/${wid}/billing`,
        icon: CreditCard,
      },
      {
        id: "nav-settings",
        title: "设置",
        kind: "nav",
        href: `/w/${wid}/settings`,
        icon: Settings,
      },
    ];

    const q = query.trim().toLowerCase();
    // query 为空：仅展示导航项（打开时不拉取所有任务，避免无谓请求）
    if (!q) return navItems;
    // query 非空：使用搜索端点返回的任务 + 决策结果（分组显示）
    return [...results.tasks, ...results.decisions];
  }, [query, results, wid]);

  // 是否展示分组标题（仅搜索态下）
  const showGroups = query.trim().length > 0;

  // 结果集变化后把游标收回首项，避免指向越界
  useEffect(() => {
    setCursor(0);
  }, [query, results.tasks.length, results.decisions.length]);

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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="命令面板"
      className="fixed inset-0 z-[var(--z-modal)] flex items-start justify-center pt-[var(--cmd-palette-top)] px-4"
      style={{ background: "var(--overlay)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[560px] bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-lg)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-4 h-12 border-b border-[var(--border-soft)]">
          <Search size={17} className="text-[var(--muted)] shrink-0" />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索任务 / 决策，或跳转页面"
            className="flex-1 bg-transparent outline-none text-[length:var(--text-md)] text-[var(--fg)] placeholder:text-[var(--meta)]"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              className="w-6 h-6 flex items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] shrink-0"
              aria-label="清除搜索"
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
            <li className="px-4 py-8 text-center text-[length:var(--text-sm)] text-[var(--muted)]">
              {query.trim() ? (isSearching ? "正在搜索…" : "输入以搜索…") : "没有可显示的项"}
            </li>
          )}
          {items.map((item, idx) => {
            const Icon = item.icon;
            const active = idx === cursor;
            const prev = items[idx - 1];
            const showTaskHeader = showGroups && item.kind === "task" && prev?.kind !== "task";
            const showDecisionHeader =
              showGroups && item.kind === "decision" && prev?.kind !== "decision";
            return (
              <Fragment key={item.id}>
                {showTaskHeader && (
                  <li className="px-4 pt-2 pb-1 text-[length:var(--text-xs)] text-[var(--meta)] uppercase tracking-wide">
                    任务
                  </li>
                )}
                {showDecisionHeader && (
                  <li className="px-4 pt-2 pb-1 text-[length:var(--text-xs)] text-[var(--meta)] uppercase tracking-wide">
                    决策
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
                    <span className="flex-1 text-left truncate">
                      {highlight(item.title, query.trim())}
                    </span>
                    {item.hint && (
                      <span className="text-[length:var(--text-xs)] text-[var(--meta)] shrink-0">
                        {item.hint}
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
          <span>↑↓ 选择</span>
          <span>Enter 打开</span>
          <span className="ml-auto tabular-nums">{items.length} 项</span>
        </div>
      </div>
    </div>
  );
}
