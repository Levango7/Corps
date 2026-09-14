import { CalendarView } from "@/components/calendar/CalendarView";

/**
 * 日历主页面：服务端组件，提取 wid 后渲染客户端组件。
 * 客户端组件包含视图切换（月/周/日）+ 当前日期 + 新建事件按钮 + 对应视图组件。
 */
export default async function CalendarPage({
  params,
}: {
  params: Promise<{ wid: string }>;
}) {
  const { wid } = await params;
  return (
    <main className="flex-1 min-w-0">
      <CalendarView wid={wid} />
    </main>
  );
}