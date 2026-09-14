import { DailyReportView } from "@/components/ai/DailyReportView";

/**
 * AI 智能日报页面：聚合当日工作数据，流式生成结构化日报，
 * 支持编辑与保存为文档。
 */
export default async function DailyReportPage({
  params,
}: {
  params: Promise<{ wid: string }>;
}) {
  const { wid } = await params;
  return (
    <main className="flex-1 min-w-0">
      <DailyReportView wid={wid} />
    </main>
  );
}