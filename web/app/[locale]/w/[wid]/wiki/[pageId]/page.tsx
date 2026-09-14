import { WikiPageView } from "@/components/wiki/WikiPageView";

/**
 * Wiki 编辑页面：左侧 WikiSidebar + 右侧 WikiEditor/WikiViewer。
 * 路由参数：wid（工作区）、pageId（Wiki 页面 ID）。
 */
export default async function WikiEditPage({
  params,
}: {
  params: Promise<{ wid: string; pageId: string }>;
}) {
  const { wid, pageId } = await params;
  return (
    <main className="flex-1 min-w-0">
      <WikiPageView wid={wid} pageId={pageId} />
    </main>
  );
}