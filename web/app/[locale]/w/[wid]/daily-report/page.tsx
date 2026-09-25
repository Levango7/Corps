import dynamic from "next/dynamic";

// P0-2: code splitting — DailyReportView 改为 dynamic import 懒加载
const DailyReportView = dynamic(
  () => import("@/components/ai/DailyReportView").then((m) => m.DailyReportView),
  { loading: () => <div className="animate-pulse h-32 rounded-lg bg-[var(--surface-2)]" /> },
);

/**
 * AI 智能日报页面：聚合当日工作数据，流式生成结构化日报，
 * 支持编辑与保存为文档。
 */
export default async function DailyReportPage({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  return (
    <main className="flex-1 min-w-0">
      <DailyReportView wid={wid} />
    </main>
  );
}
