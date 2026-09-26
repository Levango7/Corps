"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";

/**
 * Ripple — 按钮点击涟漪扩散效果。
 *
 * 纯 CSS + useRef 实现，无额外依赖。包裹在按钮内，点击时在点击位置生成
 * 涟漪圆点，经 `@keyframes ripple-expand`（.ripple-dot）扩散淡出，animationend
 * 后自动从 DOM 移除。
 *
 * **实现细节（2026-09-27 修复 actionability 超时）**：
 * 外层 span 设为 `pointer-events-none`，不再拦截按钮点击事件。
 * 涟漪触发改为在父按钮上监听 `pointerdown` 事件（通过 useEffect + closest），
 * 这样 Playwright 的 `document.elementFromPoint` 能直接命中按钮而非 Ripple span，
 * 解决 actionability check 持续超时问题。
 *
 * 涟漪色用 `var(--ripple)`（accent 极淡派生，在 globals.css 补充定义），扩散
 * 时长用 `var(--motion-base)` + `var(--ease-out)`（.ripple-dot 类）。
 *
 * prefers-reduced-motion：全局降级块（globals.css）已将 animation-duration
 * 设为 0.01ms、iteration-count 设为 1，涟漪闪现即逝仅保留点击反馈，无需
 * 组件内额外处理。
 *
 * 用法：`<button><Ripple>确定</Ripple></button>`（Ripple 作为按钮内容层，
 * span 自带 `relative overflow-hidden` 裁剪涟漪扩散范围）。
 *
 * @see design/FEATURE-DESIGN-ui-polish.md §3.2 按钮 ripple effect（L479-524）
 * @see经验 2026-09-11-prefers-reduced-motion-global-block-and-max-duration
 */
export interface RippleProps {
  children: ReactNode;
  className?: string;
}

interface RippleItem {
  id: number;
  x: number;
  y: number;
}

export function Ripple({ children, className }: RippleProps) {
  const [ripples, setRipples] = useState<RippleItem[]>([]);
  // 涟漪 id 计数器（useRef 避免多实例间 id 冲突，且不触发重渲染）
  const idRef = useRef(0);
  const containerRef = useRef<HTMLSpanElement>(null);

  // 在父按钮上监听 pointerdown 事件来触发涟漪。
  // 外层 span 设为 pointer-events-none，不拦截点击事件，
  // 确保 Playwright actionability check 能直接命中按钮。
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const button = container.closest("button");
    if (!button) return;

    const handlePointerDown = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const id = idRef.current++;
      setRipples((prev) => [...prev, { id, x, y }]);
    };

    button.addEventListener("pointerdown", handlePointerDown);
    return () => button.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  // animationend 后移除涟漪，避免 DOM 堆积。
  const removeRipple = (id: number) => {
    setRipples((prev) => prev.filter((r) => r.id !== id));
  };

  return (
    <span
      ref={containerRef}
      className={`relative overflow-hidden pointer-events-none ${className ?? ""}`}
    >
      {children}
      {ripples.map((r) => (
        <span
          key={r.id}
          // .ripple-dot 提供 width/height/margin/animation；
          // absolute + left/top 定位到点击点，rounded-full + bg-[var(--ripple)] 上色。
          className="ripple-dot pointer-events-none absolute rounded-full bg-[var(--ripple)]"
          style={{ left: r.x, top: r.y }}
          onAnimationEnd={() => removeRipple(r.id)}
        />
      ))}
    </span>
  );
}
