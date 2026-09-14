import { ApprovalListPageClient } from "@/components/approval/ApprovalListPageClient";

/**
 * 审批列表页。
 *
 * 服务端组件：从 params 解析 wid，渲染 ApprovalListPageClient。
 * ApprovalListPageClient 负责审批列表 + 发起审批按钮 + 模板管理入口。
 *
 * 参考 documents/page.tsx 模式。
 */
export default async function ApprovalsListPage({
  params,
}: {
  params: Promise<{ wid: string }>;
}) {
  const { wid } = await params;
  return (
    <main className="flex-1 min-w-0">
      <ApprovalListPageClient workspaceId={wid} />
    </main>
  );
}