"use client";

/**
 * AI 助理对话页面 · /w/[wid]/assistant
 *
 * 直接渲染 AssistantPanel（消息列表 + 输入框 + 建议卡片）。
 * params 解构模式参考 app/[locale]/w/[wid]/ai-tools/page.tsx（use client + use(params)）。
 */

import { use } from "react";
import dynamic from "next/dynamic";

// P0-2: code splitting — AssistantPanel 改为 dynamic import 懒加载
const AssistantPanel = dynamic(
  () => import("@/components/ai/AssistantPanel").then((m) => m.AssistantPanel),
  { ssr: false, loading: () => <div className="animate-pulse h-32 rounded-lg bg-[var(--surface-2)]" /> },
);

export default function AssistantPage({
  params,
}: {
  params: Promise<{ wid: string }>;
}) {
  const { wid } = use(params);
  return <AssistantPanel wid={wid} />;
}