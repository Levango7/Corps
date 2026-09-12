import { DocumentListView } from "@/components/DocumentListView";
import { KnowledgeBase } from "@/components/KnowledgeBase";

/**
 * 文档列表页（云文档 Phase 1）。
 *
 * 布局：左侧知识库目录树（KnowledgeBase，桌面端侧边栏 / 移动端抽屉）
 *      + 右侧文档列表（DocumentListView，保持现有功能）。
 *
 * 响应式：
 *  - md+（桌面端）：左 240px 目录树 + 右 flex-1 文档列表
 *  - <md（移动端）：仅文档列表；目录树通过浮动按钮唤起抽屉
 *
 * KnowledgeBase 自身管理移动端抽屉状态（内部 mobileOpen），
 * 本页面仅负责布局容器。
 */
export default async function DocumentsListPage({
  params,
}: {
  params: Promise<{ wid: string }>;
}) {
  const { wid } = await params;
  return (
    <div className="flex min-h-0">
      {/* 桌面端目录树侧边栏（移动端由 KnowledgeBase 内部抽屉处理） */}
      <aside className="hidden md:flex w-[var(--sidebar-w)] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--shell-sidebar)]">
        <KnowledgeBase wid={wid} />
      </aside>

      {/* 文档列表（保持现有功能） */}
      <main className="flex-1 min-w-0">
        <DocumentListView wid={wid} />
      </main>
    </div>
  );
}
