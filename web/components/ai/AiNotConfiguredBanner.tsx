"use client";

/**
 * AI 未配置横幅（页面级提示）。
 *
 * 挂载时探测 /api/v1/ai/configured；未配置时显示一条「管理员未启用 AI」的提示条，
 * 面板本体保留渲染——深链与无 Provider 的自动化环境不破，用户点击动作时
 * 仍会收到服务端统一的 503 文案。探测中与已配置时渲染 null。
 */

import { useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";
import { useAiConfigured } from "@/lib/ai/use-ai-configured";

export default function AiNotConfiguredBanner() {
  const { configured, loading } = useAiConfigured();
  const t = useTranslations("ai");

  if (loading || configured) return null;

  return (
    <div
      data-testid="ai-not-configured-banner"
      aria-live="polite"
      className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--surface-2)] px-3 py-2 text-[length:var(--text-sm)] text-[var(--muted)]"
    >
      <Sparkles size={14} className="shrink-0 text-[var(--accent)]" />
      <span>{t("notConfigured")}</span>
    </div>
  );
}
