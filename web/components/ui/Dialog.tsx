"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { FocusTrap } from "./FocusTrap";
import { cn } from "./cn";

/**
 * Dialog —— 模态弹窗原语（设计方案 §7.2 第 2 步的落点）。
 *
 * 现状：全仓 64 处 `role="dialog"`（57 个文件）各自手写，只有 1 个真正接了焦点圈闭
 * （`calendar/CalendarEventDialog.tsx`）。本原语把这四件事一次做对：
 *
 *  1. **焦点**：复用现有 `FocusTrap`（Tab/Shift+Tab 循环、关闭后焦点还给触发者）；
 *  2. **语义**：`role="dialog"` + `aria-modal="true"` + `aria-labelledby`（标题必填）
 *     + 可选 `aria-describedby`；
 *  3. **键盘**：Escape 关闭（`FocusTrap` 只管 Tab，不管 Esc——这是原语要补的）；
 *  4. **挂载点**：portal 到 `document.body`。仓库有先例：`fixed-overlay-portal.spec.ts`
 *     断言浮层必须"挂在 body 下"，否则会被祖先的 `transform` / `perspective` 劫持
 *     （症状是遮罩只盖住父容器而不是整个视口）。
 *
 * 不做的事：动画、拖拽、嵌套多层的 z-index 协商、body 滚动锁定。
 * 这些在迁移批次里按站点需要补，避免现在就把一个"猜需求"的复杂实现固化下来。
 */
export interface DialogProps {
  open: boolean;
  /** 关闭回调（Esc / 点遮罩 / 关闭按钮都走这里——单一出口，避免状态分裂） */
  onClose: () => void;
  /** 标题（必填：它是 aria-labelledby 的来源，也是唯一可靠的读屏名称） */
  title: string;
  /** 可选描述（读屏会在打开时播报） */
  description?: string;
  /** 右上角是否显示关闭按钮（默认 true） */
  closable?: boolean;
  /**
   * 关闭按钮的无障碍名称——**必填**且要求调用方传 `t("close")` 之类的译文。
   * 不在这里给默认中文：仓库有 i18n 门禁（英文界面不得出现中文硬编码），
   * 而一个共享原语里的默认文案会成为最隐蔽的泄漏点。
   */
  closeLabel: string;
  /** 面板的布局类（宽度/内边距等）；颜色与阴影不要在这里覆盖 */
  panelClassName?: string;
  /** 面板在遮罩里的位置（center 居中；right 贴右满高，供 Sheet 复用同一实现） */
  align?: "center" | "right";
  children: ReactNode;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  closable = true,
  closeLabel,
  panelClassName,
  align = "center",
  children,
}: DialogProps) {
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descId = `${baseId}-desc`;
  const panelRef = useRef<HTMLDivElement>(null);
  /** portal 只能在客户端挂；SSR 期间返回 null（与 next 的 hydration 约定一致） */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-[var(--z-modal)] flex bg-[var(--overlay)]",
        align === "center"
          ? "items-center justify-center p-[var(--space-4)]"
          : "items-stretch justify-end",
      )}
      data-testid="dialog-overlay"
    >
      {/*
        点遮罩关闭做成一个**真正的按钮**（满铺、tabIndex=-1 不进 Tab 序），
        而不是给容器 div 挂 onClick：后者会触发 jsx-a11y 的
        click-events-have-key-events / no-static-element-interactions，
        而且"给静态元素挂点击"本来就是语义错误。键盘等价物是 Esc。
      */}
      <button
        type="button"
        aria-label={closeLabel}
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={cn(
          "relative w-full max-w-lg bg-surface text-fg rounded-[var(--radius-lg)] shadow-md",
          "p-[var(--space-4)] outline-none",
          panelClassName,
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <h2
            id={titleId}
            className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)]"
          >
            {title}
          </h2>
          {closable && (
            <button
              type="button"
              onClick={onClose}
              aria-label={closeLabel}
              className="relative -mr-1 -mt-1 inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--hover-soft)] hover:text-[var(--fg)] after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>
        {description && (
          <p id={descId} className="mt-1 text-[length:var(--text-xs)] text-[var(--meta)]">
            {description}
          </p>
        )}
        <div className="mt-[var(--space-3)]">
          <FocusTrap>{children}</FocusTrap>
        </div>
      </div>
    </div>,
    document.body,
  );
}
