"use client";

/**
 * AI 助理对话页面 · /w/[wid]/assistant
 *
 * 直接渲染 AssistantPanel（消息列表 + 输入框 + 建议卡片）。
 * params 解构模式参考 app/[locale]/w/[wid]/ai-tools/page.tsx（use client + use(params)）。
 */

import { use } from "react";
import { AssistantPanel } from "@/components/ai/AssistantPanel";

export default function AssistantPage({
  params,
}: {
  params: Promise<{ wid: string }>;
}) {
  const { wid } = use(params);
  return <AssistantPanel wid={wid} />;
}