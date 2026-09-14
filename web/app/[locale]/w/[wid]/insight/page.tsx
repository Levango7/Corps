import { ProjectInsightView } from "@/components/ai/ProjectInsightView";

/**
 * AI 项目经理洞察页面。
 *
 * 4 种分析维度：进度分析 / 风险识别 / 综合概览 / 周报。
 * 客户端组件 ProjectInsightView 负责 tab 切换、流式渲染与周报保存。
 */
export default async function InsightPage({
  params,
}: {
  params: Promise<{ wid: string }>;
}) {
  const { wid } = await params;
  return (
    <main className="flex-1 min-w-0">
      <ProjectInsightView wid={wid} />
    </main>
  );
}