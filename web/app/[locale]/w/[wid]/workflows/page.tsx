import { WorkflowPageClient } from "@/components/workflow/WorkflowPageClient";

/**
 * 工作流管理页。
 *
 * 服务端组件：从 params 解析 wid，渲染 WorkflowPageClient。
 * WorkflowPageClient 负责列表 + 新建/编辑弹窗 + 执行历史。
 *
 * 参考 approvals/page.tsx 模式。
 */
export default async function WorkflowsPage({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  return (
    <main className="flex-1 min-w-0">
      <WorkflowPageClient wid={wid} />
    </main>
  );
}
