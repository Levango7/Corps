"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * 焦点圈闭（focus trap）：模态弹窗打开时把键盘焦点移入弹窗内，Tab / Shift+Tab
 * 在弹窗内循环，弹窗卸载后把焦点还给打开它的那个元素。
 *
 * ## 为什么需要
 *
 * 2026-10-17 QA 实测发现「日历新建事件」弹窗打开后 `activeElement` 仍是页面上的
 * 触发按钮（`activeInDialog: false`）—— 焦点从未进入弹窗。后果：
 *   - 键盘/读屏用户打开弹窗后焦点留在背景页上，完全够不到弹窗内容；
 *   - Tab 会继续在背景页往下走，走出老远才绕回弹窗；
 *   - `aria-modal="true"` 对读屏宣布了「这是模态」，但焦点没跟上，语义与现实脱节。
 *
 * 全仓当时零焦点管理：`grep -c "\.focus\|autoFocus"` 在 CalendarEventDialog 里
 * 返回 0，也不存在任何既有的 FocusTrap 实现可复用 —— 本组件从零建。
 *
 * ## 用法
 *
 * ```tsx
 * <div role="dialog" aria-modal="true" aria-label={...}>
 *   <FocusTrap>{/* 弹窗内容 *\/}</FocusTrap>
 * </div>
 * ```
 *
 * 需要指定初始焦点时（例如表单弹窗想直接聚焦标题输入框），给目标元素加
 * `data-autofocus` 属性，本组件会优先聚焦它而不是第一个可聚焦元素。
 *
 * ## 实现要点
 *
 * - 可聚焦元素判定用 `TABBABLE` 选择器而非逐个 try：`tabindex="-1"` 的容器
 *   （本组件的 wrapper div 就是）没有 tabindex，天然不在 Tab 序列里，不会被误判。
 * - 首尾循环：Tab 在最后一个元素上 → 聚焦第一个；Shift+Tab 在第一个上 → 聚焦最后一个。
 * - 焦点还原：mount 时记住 `document.activeElement`，unmount 时还回去。
 *   弹窗被「点遮罩关闭」时同样生效（组件卸载即还原）。
 * - 容器内**暂时没有**可聚焦元素时不抢焦点（等异步内容渲染完再由浏览器自然落点），
 *   避免把焦点打到 body 上导致读屏丢失上下文。
 */

/** 可聚焦元素选择器（对应 TABBABLE 常规集合，disabled 由 :disabled 排除）。 */
const TABBABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function FocusTrap({ children }: { children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  /** mount 时已在弹窗外的焦点持有者，卸载时还原。 */
  const restoreRef = useRef<HTMLElement | null>(null);

  /** 安全聚焦：focus() 在个别元素/浏览器上会抛，不能让一个元素毁掉整个弹窗。 */
  const safeFocus = (el: HTMLElement | null | undefined) => {
    if (!el) return;
    try {
      el.focus();
    } catch {
      /* 聚焦失败时静默降级：焦点留在原处，弹窗其余功能不受影响 */
    }
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    restoreRef.current = document.activeElement as HTMLElement | null;

    // 初始焦点：优先 data-autofocus，否则第一个可聚焦元素。
    // 刻意同步执行而不用 requestAnimationFrame：本仓的 jsdom 单测环境没有开
    // pretendToBeVisual，rAF 回调不触发会直接让「焦点进弹窗」这条逻辑失去覆盖；
    // 同步聚焦也更好——打开弹窗到焦点落定的间隙越短，键盘用户越不容易把按键
    // 打到背景页上。真需要等异步内容再聚焦的调用方，应自己控制初始焦点。
    const target =
      container.querySelector<HTMLElement>("[data-autofocus]") ??
      container.querySelector<HTMLElement>(TABBABLE);
    safeFocus(target);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const root = containerRef.current;
      if (!root) return;

      const items = [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter(
        (el) => !el.closest("[hidden]") && getComputedStyle(el).visibility !== "hidden",
      );
      if (items.length === 0) return;

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;

      // 焦点不在本容器内（例如刚打开、还没落到任何一项）→ 拉回第一个，
      // 不让 Tab 从背景页继续往下走。
      if (!active || !root.contains(active)) {
        e.preventDefault();
        safeFocus(first);
        return;
      }

      if (e.shiftKey && active === first) {
        e.preventDefault();
        safeFocus(last);
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        safeFocus(first);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // 焦点还原：触发按钮此时应仍在（关闭弹窗不会卸载它）。
      safeFocus(restoreRef.current);
    };
  }, []);

  // 不加 tabindex：容器本身不该进 Tab 序列，只做焦点定位的坐标系。
  return (
    <div ref={containerRef} style={{ display: "contents" }}>
      {children}
    </div>
  );
}
