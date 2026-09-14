import { AnnouncementList } from "@/components/announcement/AnnouncementList";

/**
 * 公告管理页面：列表 + 编辑器弹窗。
 *
 * 布局：全宽公告列表（AnnouncementList 内含新建/编辑/删除/置顶/类型过滤）。
 */
export default async function AnnouncementsPage({
  params,
}: {
  params: Promise<{ wid: string }>;
}) {
  const { wid } = await params;
  return (
    <main className="flex-1 min-w-0">
      <AnnouncementList wid={wid} />
    </main>
  );
}