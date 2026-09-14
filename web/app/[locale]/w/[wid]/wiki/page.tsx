import { WikiHome } from "@/components/wiki/WikiHome";

/**
 * Wiki 主页面：左侧页面树侧边栏 + 右侧欢迎提示。
 * 选中页面后跳转到 /w/{wid}/wiki/{pageId} 编辑页。
 */
export default async function WikiPage({
  params,
}: {
  params: Promise<{ wid: string }>;
}) {
  const { wid } = await params;
  return (
    <main className="flex-1 min-w-0">
      <WikiHome wid={wid} />
    </main>
  );
}
