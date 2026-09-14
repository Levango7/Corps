import { MinutesList } from "@/components/minutes/MinutesList";

/**
 * 会议纪要列表页 · app/[locale]/w/[wid]/meeting-minutes/page.tsx
 *
 * 服务端组件，渲染 MinutesList（客户端组件，内部管理列表拉取 + 新建 + 删除）。
 * 参考 meetings/page.tsx 模式。
 */
export default async function MinutesListPage({
  params,
}: {
  params: Promise<{ wid: string }>;
}) {
  const { wid } = await params;
  return (
    <main className="flex-1 min-w-0">
      <MinutesList wid={wid} />
    </main>
  );
}