"use client";

/**
 * AI 使用统计页面 · /w/[wid]/ai-usage
 *
 * 聚合展示 AI 使用仪表盘（调用次数 / Token 消耗 / 成本 / 热门能力 /
 * 最近日志 / 限额进度）与限额设置（日/月 Token 与调用次数限额编辑保存）。
 *
 * 组合两个客户端组件：
 *  - UsageDashboard      —— 只读仪表盘（GET /api/v1/ai/usage/dashboard）
 *  - UsageLimitSettings  —— 限额编辑保存（GET/PUT /api/v1/ai/usage/limits）
 *
 * 样式：design token（var(--*)），无裸 hex；lucide-react 图标 size 20
 * i18n：useTranslations("ai.usage")，页面标题取 ai.usage.pageTitle
 *
 * 参考：app/[locale]/w/[wid]/analytics/page.tsx（use client + use(params) 模式）
 *       经验 2026-09-10-nextjs-global-error-zero-dependency-inline-token（token 策略）
 */

import { use } from "react";
import { BarChart3 } from "lucide-react";
import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";

// P0-2: code splitting — AI 使用统计组件改为 dynamic import 懒加载
const UsageDashboard = dynamic(
  () => import("@/components/ai/UsageDashboard").then((m) => m.UsageDashboard),
  { ssr: false, loading: () => <div className="animate-pulse h-32 rounded-lg bg-[var(--surface-2)]" /> },
);
const UsageLimitSettings = dynamic(
  () => import("@/components/ai/UsageLimitSettings").then((m) => m.UsageLimitSettings),
  { ssr: false, loading: () => <div className="animate-pulse h-32 rounded-lg bg-[var(--surface-2)]" /> },
);

export default function AiUsagePage({
  params,
}: {
  params: Promise<{ wid: string }>;
}) {
  const { wid } = use(params);
  const t = useTranslations("ai.usage");

  return (
    <main className="flex-1 min-w-0">
      <div className="mx-auto flex w-full max-w-[var(--container-max)] flex-col gap-[var(--space-6)] px-[var(--space-5)] py-[var(--space-6)]">
        {/* 页面标题 */}
        <header>
          <h1 className="flex items-center gap-2 text-[length:var(--text-2xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
            <BarChart3 size={20} className="text-[var(--muted)]" />
            {t("pageTitle")}
          </h1>
        </header>

        {/* AI 使用仪表盘 */}
        <section className="min-h-0 flex-1">
          <UsageDashboard wid={wid} />
        </section>

        {/* 限额设置 */}
        <section className="min-h-0 flex-1">
          <UsageLimitSettings wid={wid} />
        </section>
      </div>
    </main>
  );
}