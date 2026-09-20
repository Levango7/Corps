import dynamic from "next/dynamic";

// P0-2: code splitting — AnnouncementDraftPanel 改为 dynamic import 懒加载
const AnnouncementDraftPanel = dynamic(
  () => import("@/components/ai/AnnouncementDraftPanel").then((m) => m.AnnouncementDraftPanel),
  { loading: () => <div className="animate-pulse h-32 rounded-lg bg-[var(--surface-2)]" /> },
);

/**
 * AI 公告智能起草页面：聚合工作区近期进展，流式生成公告草稿，
 * 支持编辑与一键发布为工作区公告。
 */
export default async function AnnouncementDraftPage({
  params,
}: {
  params: Promise<{ wid: string }>;
}) {
  const { wid } = await params;
  return (
    <main className="flex-1 min-w-0">
      <AnnouncementDraftPanel wid={wid} />
    </main>
  );
}