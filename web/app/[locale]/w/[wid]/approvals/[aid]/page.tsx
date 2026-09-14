import { ApprovalDetail } from "@/components/approval/ApprovalDetail";

/**
 * 审批详情页。
 *
 * 从 URL params 获取 wid 和 aid，渲染 ApprovalDetail 客户端组件。
 * ApprovalDetail 负责拉取详情、展示流程图、操作记录、审批操作。
 */
export default async function ApprovalDetailPage({
  params,
}: {
  params: Promise<{ wid: string; aid: string }>;
}) {
  const { wid, aid } = await params;
  return (
    <main className="flex-1 min-w-0">
      <ApprovalDetail approvalId={aid} workspaceId={wid} />
    </main>
  );
}