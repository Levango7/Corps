"use client";

/**
 * AI 工具中心页面 · /w/[wid]/ai-tools
 *
 * 聚合 12 个 AI 能力组件，通过 Tab 导航切换（P1「AI 五页并一」：后 4 个原本是独立页面，
 * 现收进本中枢；旧路由保留不删，深链不碎）：
 *  - 语义搜索（SemanticSearchPanel）
 *  - 邮件助手（MailAssistantPanel）
 *  - 待办提取（TodoExtractDialog，Dialog 模式，按钮触发）
 *  - 会议纪要（MeetingSummaryPanel）
 *  - 文档问答（DocQaPanel）
 *  - 决策辅助（DecisionAssistantPanel）
 *  - 工作流编排（WorkflowOrchestratorPanel）
 *  - 智能推送（AiPushTabContent）
 *  - 项目洞察（ProjectInsightView，原 /insight 页）
 *  - 知识问答（KnowledgeQaPanel，原 /knowledge-qa 页）
 *  - 智能日报（DailyReportView，原 /daily-report 页）
 *  - 公告起草（AnnouncementDraftPanel，原 /announcement-draft 页）
 *
 * 样式：design token（var(--*)），无裸 hex；lucide-react 图标 size 16
 * i18n：useTranslations("ai.aiTools")，全部文案（含 Tab 标签）均走词条，
 *   不再保留任何中文兜底——词条两侧齐备，缺键即红（tests/unit/i18n-usage.test.ts）
 * 响应式：断点 900px / 640px，Tab 栏移动端横向滚动
 *
 * 参考：app/[locale]/w/[wid]/ai-usage/page.tsx（use client + use(params) 模式）
 */

import { use, useState, useCallback, type ComponentType } from "react";
import { useTranslations } from "next-intl";
import {
  Search,
  Mail,
  ListTodo,
  FileText,
  MessageSquare,
  Lightbulb,
  Workflow,
  Sparkles,
  Bell,
  X,
  LineChart,
  BookOpen,
  Newspaper,
  Megaphone,
} from "lucide-react";
import dynamic from "next/dynamic";
import { SafeComponent } from "@/components/SafeComponent";

// P0-2: code splitting — 重型 AI 面板组件改为 dynamic import 懒加载
const SemanticSearchPanel = dynamic(
  () => import("@/components/ai/SemanticSearchPanel").then((m) => m.SemanticSearchPanel),
  {
    ssr: false,
    loading: () => <div className="animate-pulse h-32 rounded-lg bg-[var(--surface-2)]" />,
  },
);
const MailAssistantPanel = dynamic(
  () => import("@/components/ai/MailAssistantPanel").then((m) => m.MailAssistantPanel),
  {
    ssr: false,
    loading: () => <div className="animate-pulse h-32 rounded-lg bg-[var(--surface-2)]" />,
  },
);
const TodoExtractDialog = dynamic(() => import("@/components/ai/TodoExtractDialog"), {
  ssr: false,
  loading: () => <div className="animate-pulse h-32 rounded-lg bg-[var(--surface-2)]" />,
});
const MeetingSummaryPanel = dynamic(() => import("@/components/ai/MeetingSummaryPanel"), {
  ssr: false,
  loading: () => <div className="animate-pulse h-32 rounded-lg bg-[var(--surface-2)]" />,
});
const DocQaPanel = dynamic(() => import("@/components/ai/DocQaPanel").then((m) => m.DocQaPanel), {
  ssr: false,
  loading: () => <div className="animate-pulse h-32 rounded-lg bg-[var(--surface-2)]" />,
});
const DecisionAssistantPanel = dynamic(() => import("@/components/ai/DecisionAssistantPanel"), {
  ssr: false,
  loading: () => <div className="animate-pulse h-32 rounded-lg bg-[var(--surface-2)]" />,
});
const WorkflowOrchestratorPanel = dynamic(
  () => import("@/components/ai/WorkflowOrchestratorPanel"),
  {
    ssr: false,
    loading: () => <div className="animate-pulse h-32 rounded-lg bg-[var(--surface-2)]" />,
  },
);
const AiPushSettings = dynamic(
  () => import("@/components/ai/AiPushSettings").then((m) => m.AiPushSettings),
  {
    ssr: false,
    loading: () => <div className="animate-pulse h-32 rounded-lg bg-[var(--surface-2)]" />,
  },
);
const AiPushFeed = dynamic(() => import("@/components/ai/AiPushFeed").then((m) => m.AiPushFeed), {
  ssr: false,
  loading: () => <div className="animate-pulse h-32 rounded-lg bg-[var(--surface-2)]" />,
});

// P1「AI 五页并一」：这 4 个 view 原本各自挂在一个独立路由下（/insight 等），
// 组件本身不变、只是把入口收进中枢；旧路由继续可访问，避免深链失效。
const ProjectInsightView = dynamic(
  () => import("@/components/ai/ProjectInsightView").then((m) => m.ProjectInsightView),
  {
    ssr: false,
    loading: () => <div className="animate-pulse h-32 rounded-lg bg-[var(--surface-2)]" />,
  },
);
const KnowledgeQaPanel = dynamic(
  () => import("@/components/ai/KnowledgeQaPanel").then((m) => m.KnowledgeQaPanel),
  {
    ssr: false,
    loading: () => <div className="animate-pulse h-32 rounded-lg bg-[var(--surface-2)]" />,
  },
);
const DailyReportView = dynamic(
  () => import("@/components/ai/DailyReportView").then((m) => m.DailyReportView),
  {
    ssr: false,
    loading: () => <div className="animate-pulse h-32 rounded-lg bg-[var(--surface-2)]" />,
  },
);
const AnnouncementDraftPanel = dynamic(
  () => import("@/components/ai/AnnouncementDraftPanel").then((m) => m.AnnouncementDraftPanel),
  {
    ssr: false,
    loading: () => <div className="animate-pulse h-32 rounded-lg bg-[var(--surface-2)]" />,
  },
);

// ─── Tab 定义 ──────────────────────────────────────────────────────────────────

/** Tab 标识 */
type TabId =
  | "semanticSearch"
  | "mailAssistant"
  | "todoExtract"
  | "meetingSummary"
  | "docQa"
  | "decisionAssistant"
  | "workflowOrchestrator"
  | "aiPush"
  // P1 并一：原本四个独立路由的 AI 能力
  | "insight"
  | "knowledgeQa"
  | "dailyReport"
  | "announcementDraft";

/** Tab 配置项 */
interface TabConfig {
  id: TabId;
  /** i18n key（在 ai.aiTools 命名空间下） */
  labelKey: string;
  /** lucide-react 图标组件 */
  Icon: ComponentType<{ size?: number; className?: string }>;
}

/** 12 个 Tab 配置（前 8 个是原有能力，后 4 个由独立页面并入；顺序即展示顺序） */
const TABS: TabConfig[] = [
  {
    id: "semanticSearch",
    labelKey: "semanticSearch",
    Icon: Search,
  },
  {
    id: "mailAssistant",
    labelKey: "mailAssistant",
    Icon: Mail,
  },
  {
    id: "todoExtract",
    labelKey: "todoExtract",
    Icon: ListTodo,
  },
  {
    id: "meetingSummary",
    labelKey: "meetingSummary",
    Icon: FileText,
  },
  {
    id: "docQa",
    labelKey: "docQa",
    Icon: MessageSquare,
  },
  {
    id: "decisionAssistant",
    labelKey: "decisionAssistant",
    Icon: Lightbulb,
  },
  {
    id: "workflowOrchestrator",
    labelKey: "workflowOrchestrator",
    Icon: Workflow,
  },
  {
    id: "aiPush",
    labelKey: "aiPush",
    Icon: Bell,
  },
  {
    id: "insight",
    labelKey: "insight",
    Icon: LineChart,
  },
  {
    id: "knowledgeQa",
    labelKey: "knowledgeQa",
    Icon: BookOpen,
  },
  {
    id: "dailyReport",
    labelKey: "dailyReport",
    Icon: Newspaper,
  },
  {
    id: "announcementDraft",
    labelKey: "announcementDraft",
    Icon: Megaphone,
  },
];

// ─── 样式常量 ──────────────────────────────────────────────────────────────────

/** Tab 按钮基础样式 */
const TAB_BASE =
  "inline-flex items-center gap-[var(--space-2)] whitespace-nowrap px-[var(--space-4)] h-10 rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]";

/** Tab 选中态样式 */
const TAB_ACTIVE =
  "bg-[var(--accent-soft)] text-[var(--accent)] border border-[color-mix(in_srgb,var(--accent)_30%,transparent)]";

/** Tab 未选中态样式 */
const TAB_IDLE =
  "bg-transparent text-[var(--muted)] border border-transparent hover:bg-[var(--surface-2)] hover:text-[var(--fg-2)]";

// ─── 页面组件 ──────────────────────────────────────────────────────────────────

export default function AiToolsPage({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = use(params);
  const t = useTranslations("ai.aiTools");
  const [activeTab, setActiveTab] = useState<TabId>("semanticSearch");
  // TodoExtractDialog 的打开状态（Dialog 模式，需按钮触发）
  const [todoDialogOpen, setTodoDialogOpen] = useState(false);

  /** 获取 Tab 标签（词条两侧齐备，缺键由 i18n-usage 门禁兜底） */
  const tabLabel = useCallback((tab: TabConfig): string => t(tab.labelKey), [t]);

  return (
    <main className="flex-1 min-w-0">
      <div className="mx-auto flex w-full max-w-[var(--container-max)] flex-col gap-[var(--space-6)] px-[var(--space-5)] py-[var(--space-6)]">
        {/* ─── 页面标题 ─── */}
        <header>
          <h1 className="flex items-center gap-2 text-[length:var(--text-2xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tracking-[var(--tracking-tight)]">
            <Sparkles size={22} className="text-[var(--accent)]" />
            {t("title")}
          </h1>
        </header>

        {/* ─── Tab 导航栏 ─── */}
        <nav
          role="tablist"
          aria-label={t("title")}
          className="flex items-center gap-[var(--space-2)] overflow-x-auto rounded-[var(--radius-md)] bg-[var(--surface-2)] p-[var(--space-1)] border border-[var(--border-soft)]"
        >
          {TABS.map((tab) => {
            const active = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(tab.id)}
                className={`${TAB_BASE} ${active ? TAB_ACTIVE : TAB_IDLE}`}
              >
                <tab.Icon size={16} />
                {tabLabel(tab)}
              </button>
            );
          })}
        </nav>

        {/* ─── 内容区 ─── */}
        <section
          role="tabpanel"
          className="min-h-0 flex-1 rounded-[var(--radius-md)] bg-[var(--surface)] border border-[var(--border-soft)] p-[var(--space-5)]"
        >
          {activeTab === "semanticSearch" && (
            <SafeComponent
              name={tabLabel(TABS[0])}
              fallback={<AiFallback name={tabLabel(TABS[0])} />}
            >
              <SemanticSearchPanel wid={wid} />
            </SafeComponent>
          )}
          {activeTab === "mailAssistant" && (
            <SafeComponent
              name={tabLabel(TABS[1])}
              fallback={<AiFallback name={tabLabel(TABS[1])} />}
            >
              <MailAssistantPanel wid={wid} />
            </SafeComponent>
          )}
          {activeTab === "todoExtract" && (
            <SafeComponent
              name={tabLabel(TABS[2])}
              fallback={<AiFallback name={tabLabel(TABS[2])} />}
            >
              <TodoExtractTabContent
                wid={wid}
                open={todoDialogOpen}
                onOpen={() => setTodoDialogOpen(true)}
                onClose={() => setTodoDialogOpen(false)}
                label={tabLabel(TABS[2])}
              />
            </SafeComponent>
          )}
          {activeTab === "meetingSummary" && (
            <SafeComponent
              name={tabLabel(TABS[3])}
              fallback={<AiFallback name={tabLabel(TABS[3])} />}
            >
              <MeetingSummaryPanel wid={wid} />
            </SafeComponent>
          )}
          {activeTab === "docQa" && (
            <SafeComponent
              name={tabLabel(TABS[4])}
              fallback={<AiFallback name={tabLabel(TABS[4])} />}
            >
              <DocQaPanel wid={wid} />
            </SafeComponent>
          )}
          {activeTab === "decisionAssistant" && (
            <SafeComponent
              name={tabLabel(TABS[5])}
              fallback={<AiFallback name={tabLabel(TABS[5])} />}
            >
              <DecisionAssistantPanel wid={wid} />
            </SafeComponent>
          )}
          {activeTab === "workflowOrchestrator" && (
            <SafeComponent
              name={tabLabel(TABS[6])}
              fallback={<AiFallback name={tabLabel(TABS[6])} />}
            >
              <WorkflowOrchestratorPanel wid={wid} />
            </SafeComponent>
          )}
          {activeTab === "aiPush" && (
            <SafeComponent
              name={tabLabel(TABS[7])}
              fallback={<AiFallback name={tabLabel(TABS[7])} />}
            >
              <AiPushTabContent wid={wid} />
            </SafeComponent>
          )}
          {activeTab === "insight" && (
            <SafeComponent
              name={tabLabel(TABS[8])}
              fallback={<AiFallback name={tabLabel(TABS[8])} />}
            >
              <ProjectInsightView wid={wid} />
            </SafeComponent>
          )}
          {activeTab === "knowledgeQa" && (
            <SafeComponent
              name={tabLabel(TABS[9])}
              fallback={<AiFallback name={tabLabel(TABS[9])} />}
            >
              <KnowledgeQaPanel wid={wid} />
            </SafeComponent>
          )}
          {activeTab === "dailyReport" && (
            <SafeComponent
              name={tabLabel(TABS[10])}
              fallback={<AiFallback name={tabLabel(TABS[10])} />}
            >
              <DailyReportView wid={wid} />
            </SafeComponent>
          )}
          {activeTab === "announcementDraft" && (
            <SafeComponent
              name={tabLabel(TABS[11])}
              fallback={<AiFallback name={tabLabel(TABS[11])} />}
            >
              <AnnouncementDraftPanel wid={wid} />
            </SafeComponent>
          )}
        </section>
      </div>
    </main>
  );
}

// ─── 待办提取 Tab 内容（Dialog 触发器 + Dialog） ────────────────────────────────

/**
 * TodoExtractDialog 的 Tab 容器。
 *
 * TodoExtractDialog 是一个 Modal/Dialog 组件（props: wid + onClose + onCreated?），
 * 不能直接内联渲染，需要先展示一个触发按钮，点击后弹出 Dialog。
 */
function TodoExtractTabContent({
  wid,
  open,
  onOpen,
  onClose,
  label,
}: {
  wid: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  label: string;
}) {
  const t = useTranslations("ai.aiTools");
  return (
    <div className="flex flex-col items-center justify-center gap-[var(--space-6)] py-[var(--space-12)]">
      <div className="flex flex-col items-center gap-[var(--space-3)] text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--accent-soft)]">
          <ListTodo size={28} className="text-[var(--accent)]" />
        </div>
        <h2 className="text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
          {label}
        </h2>
        <p className="max-w-md text-[length:var(--text-sm)] text-[var(--muted)]">
          {t("todoExtractDesc")}
        </p>
      </div>
      <button
        onClick={onOpen}
        className="inline-flex items-center gap-[var(--space-2)] h-10 px-[var(--space-5)] rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
      >
        <ListTodo size={16} />
        {t("openTab", { name: label })}
      </button>

      {/* Dialog 遮罩 + 内容 */}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={label}
          className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-[color-mix(in_srgb,var(--bg)_60%,transparent)] backdrop-blur-sm"
          onClick={onClose}
        >
          <div
            className="relative max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-[var(--radius-lg)] bg-[var(--surface)] border border-[var(--border)] shadow-[var(--elev-lg)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 关闭按钮 */}
            <button
              onClick={onClose}
              className="absolute right-[var(--space-3)] top-[var(--space-3)] z-10 flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
              aria-label={t("close")}
            >
              <X size={16} />
            </button>
            {/* Dialog 主体 */}
            <TodoExtractDialog wid={wid} onClose={onClose} />
          </div>
        </div>
      )}
    </div>
  );
}
// ─── AI 推送 Tab 内容（左设置 + 右消息流） ──────────────────────────────────────

/**
 * AI 推送 Tab 容器：左右分栏布局。
 * 左侧 AiPushSettings 管理推送计划，右侧 AiPushFeed 展示推送消息流。
 * 响应式：lg 以上两栏，以下单栏堆叠。
 */
function AiPushTabContent({ wid }: { wid: string }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2" style={{ gap: "var(--space-4)" }}>
      <AiPushSettings wid={wid} />
      <AiPushFeed wid={wid} />
    </div>
  );
}
// ─── AI 面板统一降级 UI ──────────────────────────────────────────────────────────

/** AI 面板崩溃时的统一 fallback：显示"服务暂时不可用"提示 */
function AiFallback({ name }: { name: string }) {
  const t = useTranslations("ai.aiTools");
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-8 rounded-[var(--radius-md)] bg-[var(--surface-2)]">
      <p className="text-sm text-[var(--text-secondary)]">{t("serviceUnavailable", { name })}</p>
      <button
        onClick={() => window.location.reload()}
        className="text-xs text-[var(--accent-fg)] hover:underline"
      >
        {t("retry")}
      </button>
    </div>
  );
}
