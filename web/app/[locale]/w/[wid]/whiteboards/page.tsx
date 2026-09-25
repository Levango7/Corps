import { WhiteboardList } from "@/components/whiteboard/WhiteboardList";

/**
 * 白板列表页。
 *
 * 布局：直接渲染 WhiteboardList（卡片式列表 + 新建/删除）。
 */
export default async function WhiteboardsListPage({
  params,
}: {
  params: Promise<{ wid: string }>;
}) {
  const { wid } = await params;
  return (
    <main className="flex-1 min-w-0">
      <WhiteboardList wid={wid} />
    </main>
  );
}
