"use client";

/**
 * SlashMenu — TipTap Slash 命令面板浮层 UI（Phase 1b）。
 *
 * 设计取舍：
 * - 纯受控组件：父级（slashMenuExtension 的 render）通过 props 注入
 *   items / query / selectedIndex / onSelect / onQueryChange，组件本身
 *   不持有 TipTap editor 引用，避免与 ProseMirror 生命周期耦合。
 * - 键盘导航由扩展的 onKeyDown 处理（ProseMirror plugin 拦截 ↑↓Enter Esc），
 *   本组件只渲染「选中态」高亮，不监听键盘事件，避免双份监听冲突。
 * - 浮层定位由 TipTap Suggestion 通过 mount + clientRect 注入 style，
 *   组件不写 fixed/absolute，仅给出视觉外壳。
 * - 所有样式走 design token（var(--*)），浮层用 --elev-lg + --z-dropdown。
 * - lucide-react 图标统一 size={16}（与 design 规范一致）。
 * - 尊重 prefers-reduced-motion：动画时长通过 --motion-* token，CSS 中
 *   @media (prefers-reduced-motion: reduce) 时 token 已收敛为 0ms。
 * - i18n：命令 label/description 由父级传入已翻译字符串，组件内不调
 *   useTranslations，保持纯展示组件可被 Suggestion render 直接挂载。
 */

import { useEffect, useRef } from "react";
import type { LucideIcon } from "lucide-react";

/** 单条命令定义（由 slashMenuExtension 构造，icon 为 lucide 图标组件） */
export interface SlashCommandItem {
  /** 命令唯一键（i18n key 后缀，如 "h1" / "bulletList" / "decision"） */
  key: string;
  /** 显示名称（已翻译） */
  label: string;
  /** 简短描述（已翻译，可选） */
  description?: string;
  /** 关键字（用于模糊搜索，含 key/label 的拼音/英文别名） */
  keywords: string;
  /** lucide 图标组件 */
  icon: LucideIcon;
  /** 执行命令（由扩展注入，调用 editor.chain()...run()） */
  command: () => void;
}

export interface SlashMenuProps {
  /** 当前过滤后的命令列表 */
  items: SlashCommandItem[];
  /** 当前选中的索引（键盘导航） */
  selectedIndex: number;
  /** 选中某条命令（点击或 Enter） */
  onSelect: (item: SlashCommandItem) => void;
  /** 悬停某条命令（更新 selectedIndex） */
  onHover: (index: number) => void;
  /** 当前查询字符串（用于无结果提示） */
  query: string;
  /** 无结果提示文案（已翻译） */
  emptyText: string;
}

/**
 * SlashMenu 浮层列表。
 *
 * 可访问性：
 * - role="listbox" + option 角色，aria-selected 标记选中态。
 * - 选中项滚动到可见区（scrollIntoView nearest），避免长列表键盘导航丢失。
 * - 点击触发 onSelect；鼠标移动触发 onHover 同步 selectedIndex。
 */
export function SlashMenu({
  items,
  selectedIndex,
  onSelect,
  onHover,
  query,
  emptyText,
}: SlashMenuProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const selectedRef = useRef<HTMLLIElement>(null);

  // 选中项滚动到可见区（键盘 ↑↓ 越界时自动归位）
  useEffect(() => {
    const el = selectedRef.current;
    if (!el) return;
    // nearest 避免强制居中破坏用户当前视窗
    el.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [selectedIndex]);

  // 空结果态
  if (items.length === 0) {
    return (
      <div
        className="slash-menu__empty rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--muted)] shadow-[var(--elev-lg)]"
        style={{ zIndex: "var(--z-dropdown)" }}
        role="status"
        aria-live="polite"
      >
        {emptyText.replace("{query}", query)}
      </div>
    );
  }

  return (
    <ul
      ref={listRef}
      className="slash-menu rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--surface)] py-1 shadow-[var(--elev-lg)] overflow-y-auto max-h-[min(320px,50dvh)] min-w-[240px]"
      style={{ zIndex: "var(--z-dropdown)" }}
      role="listbox"
      aria-label="Slash command menu"
    >
      {items.map((item, idx) => {
        const Icon = item.icon;
        const selected = idx === selectedIndex;
        return (
          <li
            key={item.key}
            ref={selected ? selectedRef : null}
            role="option"
            aria-selected={selected}
            tabIndex={-1}
            onMouseDown={(e) => {
              // 阻止 mousedown 让编辑器失焦——否则 Suggestion onExit 会先于 click 触发
              e.preventDefault();
            }}
            onMouseEnter={() => onHover(idx)}
            onClick={() => onSelect(item)}
            className={`flex items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] cursor-default outline-none transition-colors duration-[var(--motion-fast)] ${
              selected
                ? "bg-[var(--accent-soft)] text-[var(--fg)]"
                : "text-[var(--fg-2)] hover:bg-[var(--surface-2)]"
            }`}
          >
            <Icon
              size={16}
              className={selected ? "text-[var(--accent)]" : "text-[var(--muted)]"}
              aria-hidden="true"
            />
            <div className="flex-1 min-w-0 flex flex-col">
              <span className="text-[length:var(--text-sm)] font-[family-name:var(--font-body)] truncate">
                {item.label}
              </span>
              {item.description ? (
                <span className="text-[length:var(--text-xs)] text-[var(--meta)] truncate">
                  {item.description}
                </span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default SlashMenu;