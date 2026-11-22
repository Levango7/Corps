"use client";

/**
 * AI 交付页 · /w/[wid]/deliverables
 *
 * 对接 nexusloom sidecar 交付运行时（DAG 藏内部）：
 *  - DeliveryPanel：提交文档生成任务 + 任务列表（阶段条）+ 交付内容查看
 * 收件进度由面板轮询 GET /api/v1/ai/deliverables 拉取（10s）。
 */

import { use } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { PackageCheck } from "lucide-react";
import AiNotConfiguredBanner from "@/components/ai/AiNotConfiguredBanner";

// P0-2: code splitting — DeliveryPanel dynamic import 懒加载
const DeliveryPanel = dynamic(
  () => import("@/components/ai/DeliveryPanel").then((m) => m.default),
  { loading: () => <div className="animate-pulse h-32 rounded-lg bg-[var(--surface-2)]" /> },
);

export default function DeliverablesPage({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = use(params);
  const t = useTranslations("nav");

  return (
    <main className="flex-1 min-w-0">
      <div className="mx-auto max-w-[var(--container-max)] px-[var(--space-4)] py-[var(--space-6)]">
        <div className="mb-[var(--space-5)] space-y-[var(--space-3)]">
          <h1 className="flex items-center gap-2 text-[length:var(--text-2xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tracking-[var(--tracking-tight)]">
            <PackageCheck size={20} className="text-[var(--accent)]" />
            {t("deliverables")}
          </h1>
          {/* AI 未配置提示（sidecar 依赖本仓 LLM key；未配置时横幅提示，面板保留） */}
          <AiNotConfiguredBanner />
        </div>

        <DeliveryPanel wid={wid} />
      </div>
    </main>
  );
}
