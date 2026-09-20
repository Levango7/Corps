import dynamic from "next/dynamic";

// P0-2: code splitting — KnowledgeQaPanel 改为 dynamic import 懒加载
const KnowledgeQaPanel = dynamic(
  () => import("@/components/ai/KnowledgeQaPanel").then((m) => m.KnowledgeQaPanel),
  { loading: () => <div className="animate-pulse h-32 rounded-lg bg-[var(--surface-2)]" /> },
);

/**
 * 跨模块 AI 知识问答页面。
 *
 * 用户输入自然语言问题，AI 基于工作区跨模块上下文（任务/文档/会议/审批/
 * 工时/Wiki/决策/OKR/消息）流式生成回答。客户端组件 KnowledgeQaPanel
 * 负责输入交互、流式渲染与请求中止。
 */
export default async function KnowledgeQaPage({
  params,
}: {
  params: Promise<{ wid: string }>;
}) {
  const { wid } = await params;
  return (
    <main className="flex-1 min-w-0">
      <KnowledgeQaPanel wid={wid} />
    </main>
  );
}