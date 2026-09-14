import { MeetingList } from "@/components/meeting/MeetingList";

/**
 * 会议列表页 · app/[locale]/w/[wid]/meetings/page.tsx
 *
 * 服务端组件，渲染 MeetingList（客户端组件，内部管理列表拉取 + 创建弹窗）。
 * 参考 documents/page.tsx 模式。
 */
export default async function MeetingsListPage({
  params,
}: {
  params: Promise<{ wid: string }>;
}) {
  const { wid } = await params;
  return (
    <main className="flex-1 min-w-0">
      <MeetingList workspaceId={wid} />
    </main>
  );
}