"use client";

/**
 * @提及自动补全弹窗
 *
 * - 接收 @ 后的搜索文本，过滤成员列表（name 包含 query，不区分大小写）
 * - 显示成员列表：头像 + 名称 + email
 * - 键盘导航：上下箭头选择，Enter 确认，Escape 关闭
 * - 定位在光标附近（由 position 属性指定）
 *
 * 所有样式走 design token（var(--*)），无裸 hex。
 * lucide-react 图标尺寸用 14/16（项目约定）。
 */

import { useEffect, useMemo, useRef, useState } from "react";

/** 可提及的成员项 */
interface MentionableMember {
  userId: string;
  user: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
  };
}

interface MentionPopoverProps {
  /** @ 后的搜索文本 */
  query: string;
  /** 可提及的成员列表 */
  members: MentionableMember[];
  /** 选中成员回调 */
  onSelect: (userId: string, userName: string) => void;
  /** 关闭弹窗回调 */
  onClose: () => void;
  /** 弹窗定位（光标附近坐标，像素） */
  position: { top: number; left: number };
}

/** 弹窗最大显示条数 */
const MAX_VISIBLE = 8;

export function MentionPopover({
  query,
  members,
  onSelect,
  onClose,
  position,
}: MentionPopoverProps) {
  // 当前高亮索引
  const [activeIdx, setActiveIdx] = useState(0);
  // 列表容器引用（用于滚动到高亮项）
  const listRef = useRef<HTMLUListElement>(null);

  // 过滤成员：name 或 email 包含 query（不区分大小写）
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members.slice(0, MAX_VISIBLE);
    return members
      .filter((m) => {
        const name = m.user.name?.toLowerCase() ?? "";
        const email = m.user.email?.toLowerCase() ?? "";
        return name.includes(q) || email.includes(q);
      })
      .slice(0, MAX_VISIBLE);
  }, [query, members]);

  // query 变化时重置高亮
  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  // 高亮项变化时滚动到可见区域
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[activeIdx] as HTMLElement | undefined;
    if (item) {
      item.scrollIntoView({ block: "nearest" });
    }
  }, [activeIdx]);

  // 键盘导航：在弹窗挂载期间监听全局 keydown（capture 阶段，先于 textarea 处理）
  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (filtered.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setActiveIdx((prev) => (prev + 1) % filtered.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setActiveIdx((prev) => (prev - 1 + filtered.length) % filtered.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const selected = filtered[activeIdx];
        if (selected) {
          const name = selected.user.name ?? selected.user.email ?? selected.user.id;
          onSelect(selected.userId, name);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [filtered, activeIdx, onSelect, onClose]);

  // 空结果：不渲染
  if (filtered.length === 0) return null;

  /** 获取成员显示名 */
  const getDisplayName = (m: MentionableMember): string => m.user.name ?? m.user.email ?? m.user.id;

  /** 获取头像首字母 */
  const getInitial = (m: MentionableMember): string =>
    (m.user.name ?? m.user.email ?? "?")[0]?.toUpperCase() ?? "?";

  return (
    <ul
      ref={listRef}
      role="listbox"
      aria-label="mention-suggestions"
      style={{ top: position.top, left: position.left }}
      className="fixed z-[var(--z-dropdown)] w-64 max-h-64 overflow-y-auto py-1 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-md)]"
    >
      {filtered.map((m, idx) => {
        const name = getDisplayName(m);
        const isActive = idx === activeIdx;
        return (
          <li
            key={m.userId}
            role="option"
            aria-selected={isActive}
            onMouseEnter={() => setActiveIdx(idx)}
            onMouseDown={(e) => {
              // mousedown 阻止失焦，点击即选中
              e.preventDefault();
              onSelect(m.userId, name);
            }}
            className={`flex items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] cursor-pointer transition-colors duration-[var(--motion-fast)] ${
              isActive ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--surface-2)]"
            }`}
          >
            {/* 头像 */}
            <div className="shrink-0 w-6 h-6 rounded-full bg-[var(--surface-3)] text-[var(--muted)] flex items-center justify-center text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] overflow-hidden">
              {m.user.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.user.image} alt={name} className="w-full h-full object-cover" />
              ) : (
                getInitial(m)
              )}
            </div>
            {/* 名称 + email */}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[length:var(--text-sm)] text-[var(--fg)] font-[weight:var(--weight-medium)]">
                {name}
              </div>
              {m.user.email && (
                <div className="truncate text-[length:var(--text-xs)] text-[var(--meta)]">
                  {m.user.email}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
