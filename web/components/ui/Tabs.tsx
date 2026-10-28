"use client";

import { useCallback, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "./cn";

/**
 * Tabs —— 受控标签页（WAI-ARIA tabs 模式）。
 *
 * 本仓原来没有标签页原语，各处用一排 `<button>` 自拼，语义与键盘行为不一致。
 * 这里按 ARIA 规范做**唯一正确的一套**：
 *  - 容器 `role="tablist"`，按钮 `role="tab"` + `aria-selected` + `aria-controls`，
 *    面板 `role="tabpanel"` + `aria-labelledby`；
 *  - 键盘：← → 切换、Home/End 到首尾、被禁用的项跳过；roving tabindex
 *    （只有选中项 `tabIndex=0`，Tab 键只落一次）；
 *  - 切换时焦点跟随选中项（ARIA 要求），用同步 focus 而不是 rAF——
 *    本仓 jsdom 没开 pretendToBeVisual，rAF 不触发会让这条逻辑失去覆盖。
 *
 * 为什么必须传 `label`：`tablist` 没有可访问名称时读屏只念"标签列表"，
 * 用户不知道这组标签是干什么的。
 *
 * 为什么必须传 `baseId`：tab 与 panel 的 `aria-controls` / `aria-labelledby`
 * 必须指向同一对 id。由调用方 `useId()` 生成一次传给两边，比在组件内部藏一个
 * 调用方拿不到的 id 再要求它去猜，可靠得多。
 */
export interface TabItem {
  id: string;
  label: string;
  disabled?: boolean;
}

export interface TabsProps {
  /** tablist 的可访问名称（必填） */
  label: string;
  /** id 前缀（调用方 useId() 生成，TabPanel 用同一个） */
  baseId: string;
  items: readonly TabItem[];
  /** 当前选中项 id（受控） */
  value: string;
  onChange: (id: string) => void;
  className?: string;
}

export function tabIds(baseId: string, itemId: string) {
  return { tabId: `${baseId}-tab-${itemId}`, panelId: `${baseId}-panel-${itemId}` };
}

export function Tabs({ label, baseId, items, value, onChange, className }: TabsProps) {
  const btnRefs = useRef(new Map<string, HTMLButtonElement>());
  const enabled = items.filter((t) => !t.disabled);

  const select = useCallback(
    (id: string) => {
      onChange(id);
      btnRefs.current.get(id)?.focus();
    },
    [onChange],
  );

  const move = useCallback(
    (dir: 1 | -1) => {
      if (enabled.length === 0) return;
      const cur = enabled.findIndex((t) => t.id === value);
      select(enabled[(cur + dir + enabled.length) % enabled.length].id);
    },
    [enabled, select, value],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        move(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        move(-1);
      } else if (e.key === "Home" && enabled[0]) {
        e.preventDefault();
        select(enabled[0].id);
      } else if (e.key === "End" && enabled.length > 0) {
        e.preventDefault();
        select(enabled[enabled.length - 1].id);
      }
    },
    [enabled, move, select],
  );

  return (
    <div
      role="tablist"
      aria-label={label}
      aria-orientation="horizontal"
      className={cn("flex items-center gap-1 border-b border-[var(--border)]", className)}
    >
      {items.map((item) => {
        const selected = item.id === value;
        const { tabId, panelId } = tabIds(baseId, item.id);
        return (
          <button
            key={item.id}
            ref={(el) => {
              if (el) btnRefs.current.set(item.id, el);
              else btnRefs.current.delete(item.id);
            }}
            id={tabId}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            onClick={() => !item.disabled && select(item.id)}
            // 方向键处理挂在每个 tab 上（而不是 tablist 容器）：
            // 容器是静态元素，给它挂交互会触发 jsx-a11y/interactive-supports-focus，
            // 而且 ARIA tabs 模式本来就要求焦点在 tab 之间移动。
            onKeyDown={onKeyDown}
            className={cn(
              "relative h-9 px-[var(--space-3)] text-[length:var(--text-sm)] transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
              "disabled:opacity-40 disabled:cursor-not-allowed",
              selected
                ? "text-[var(--accent)] font-[weight:var(--weight-medium)] after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-[var(--accent)] after:content-['']"
                : "text-[var(--muted)] hover:text-[var(--fg)]",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

/** tabpanel 包装：把 `aria-labelledby` 接到对应 tab 上（baseId 与 Tabs 用同一个） */
export function TabPanel({
  baseId,
  itemId,
  children,
  className,
}: {
  baseId: string;
  itemId: string;
  children: ReactNode;
  className?: string;
}) {
  const { tabId, panelId } = tabIds(baseId, itemId);
  return (
    <div role="tabpanel" id={panelId} aria-labelledby={tabId} className={className}>
      {children}
    </div>
  );
}
