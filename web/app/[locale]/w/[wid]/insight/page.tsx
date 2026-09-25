import dynamic from "next/dynamic";

// P0-2: code splitting — ProjectInsightView 改为 dynamic import 懒加载
const ProjectInsightView = dynamic(
  () => import("@/components/ai/ProjectInsightView").then((m) => m.ProjectInsightView),
  { loading: () => <div className="animate-pulse h-32 rounded-lg bg-[var(--surface-2)]" /> },
);

/**
 * AI 项目经理洞察页面。
 *
 * 4 种分析维度：进度分析 / 风险识别 / 综合概览 / 周报。
 * 客户端组件 ProjectInsightView 负责 tab 切换、流式渲染与周报保存。
 */
export default async function InsightPage({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  return (
    <main className="flex-1 min-w-0">
      <ProjectInsightView wid={wid} />
    </main>
  );
}
