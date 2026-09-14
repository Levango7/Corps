"use client";

/**
 * 正在输入指示器
 *
 * - 三个跳动的点（用 Tailwind 内置 animate-pulse + 错位 delay 实现波浪效果）
 * - 单人："XXX 正在输入..."
 * - 多人："XXX、YYY 正在输入..."
 * - 超过 3 人："多人正在输入..."
 *
 * 所有样式走 design token（var(--*)），无裸 hex。
 */

import { useTranslations } from "next-intl";

interface TypingIndicatorProps {
  /** 正在输入的用户列表 */
  users: { userId: string; userName: string }[];
}

/** 最多显示的用户名数量，超过则显示"多人正在输入..." */
const MAX_NAMES = 3;

/** 三个点的错位延迟（毫秒），制造波浪式跳动 */
const DOT_DELAYS = [0, 200, 400];

export function TypingIndicator({ users }: TypingIndicatorProps) {
  const t = useTranslations("chat");

  // 无人在输入：不渲染
  if (users.length === 0) return null;

  /** 拼接正在输入的用户名描述 */
  const getTypingText = (): string => {
    if (users.length > MAX_NAMES) {
      return t("typingMany");
    }
    const names = users.map((u) => u.userName).join("、");
    return t("typing", { names });
  };

  return (
    <div
      className="flex items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--meta)]"
      aria-live="polite"
    >
      {/* 三个跳动点：用 animate-pulse + 错位 animation-delay 实现波浪效果 */}
      <span className="flex items-center gap-0.5" aria-hidden="true">
        {DOT_DELAYS.map((delay, i) => (
          <span
            key={i}
            className="w-1 h-1 rounded-full bg-[var(--meta)] animate-pulse"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
      {/* 描述文本 */}
      <span className="truncate">{getTypingText()}</span>
    </div>
  );
}
