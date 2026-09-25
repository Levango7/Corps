import { RecycleBin } from "@/components/RecycleBin";

/**
 * 回收站页面（阶段 6 任务 223）
 *
 * 渲染 RecycleBin 组件，展示当前工作区已软删除的任务与文档，
 * 支持恢复与永久删除操作。
 *
 * 布局与 /documents 页面一致：服务端页面壳 + 客户端组件。
 * 标题、筛选、列表、分页均在 RecycleBin 组件内。
 * 面包屑由工作区 layout 的工作区切换器承担（与 documents 页同模式）。
 */
export default async function RecycleBinPage({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  return (
    <main className="flex-1 min-w-0">
      <RecycleBin workspaceId={wid} />
    </main>
  );
}
