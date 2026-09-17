"use client";

/**
 * AI 工具中心页面 · /w/[wid]/ai-tools
 *
 * 聚合 7 个 AI 能力组件，通过 Tab 导航切换：
 *  - 语义搜索（SemanticSearchPanel）
 *  - 邮件助手（MailAssistantPanel）
 *  - 待办提取（TodoExtractDialog，Dialog 模式，按钮触发）
 *  - 会议纪要（MeetingSummaryPanel）
 *  - 文档问答（DocQaPanel）
 *  - 决策辅助（DecisionAssistantPanel）
 *  - 工作流编排（WorkflowOrchestratorPanel）
 *
 * 样式：design token（var(--*)），无裸 hex；lucide-react 图标 size 16
 * i18n：useTranslations("ai.aiTools")，用 t.has() + 回退文本兜底
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
} from "lucide-react";
import { SemanticSearchPanel } from "@/components/ai/SemanticSearchPanel";
import { MailAssistantPanel } from "@/components/ai/MailAssistantPanel";
import TodoExtractDialog from "@/components/ai/TodoExtractDialog";
import MeetingSummaryPanel from "@/components/ai/MeetingSummaryPanel";
import { DocQaPanel } from "@/components/ai/DocQaPanel";
import DecisionAssistantPanel from "@/components/ai/DecisionAssistantPanel";
import WorkflowOrchestratorPanel from "@/components/ai/WorkflowOrchestratorPanel";
import { AiPushSettings } from "@/components/ai/AiPushSettings";
import { AiPushFeed } from "@/components/ai/AiPushFeed";

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
  | "aiPush";

/** Tab 配置项 */
interface TabConfig {
  id: TabId;
  /** i18n key（在 ai.aiTools 命名空间下） */
  labelKey: string;
  /** 中文回退文本 */
  fallbackZh: string;
  /** 英文回退文本 */
  fallbackEn: string;
  /** lucide-react 图标组件 */
  Icon: ComponentType<{ size?: number; className?: string }>;
}

/** 7 个 Tab 配置（顺序即展示顺序） */
const TABS: TabConfig[] = [
  {
    id: "semanticSearch",
    labelKey: "semanticSearch",
    fallbackZh: "语义搜索",
    fallbackEn: "Semantic Search",
    Icon: Search,
  },
  {
    id: "mailAssistant",
    labelKey: "mailAssistant",
    fallbackZh: "邮件助手",
    fallbackEn: "Mail Assistant",
    Icon: Mail,
  },
  {
    id: "todoExtract",
    labelKey: "todoExtract",
    fallbackZh: "待办提取",
    fallbackEn: "Todo Extract",
    Icon: ListTodo,
  },
  {
    id: "meetingSummary",
    labelKey: "meetingSummary",
    fallbackZh: "会议纪要",
    fallbackEn: "Meeting Summary",
    Icon: FileText,
  },
  {
    id: "docQa",
    labelKey: "docQa",
    fallbackZh: "文档问答",
    fallbackEn: "Document Q&A",
    Icon: MessageSquare,
  },
  {
    id: "decisionAssistant",
    labelKey: "decisionAssistant",
    fallbackZh: "决策辅助",
    fallbackEn: "Decision Assistant",
    Icon: Lightbulb,
  },
  {
    id: "workflowOrchestrator",
    labelKey: "workflowOrchestrator",
    fallbackZh: "工作流编排",
    fallbackEn: "Workflow Orchestrator",
    Icon: Workflow,
  },
  {
    id: "aiPush",
    labelKey: "aiPush",
    fallbackZh: "AI 推送",
    fallbackEn: "AI Push",
    Icon: Bell,
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

export default function AiToolsPage({
  params,
}: {
  params: Promise<{ wid: string }>;
}) {
  const { wid } = use(params);
  const t = useTranslations("ai.aiTools");
  const [activeTab, setActiveTab] = useState<TabId>("semanticSearch");
  // TodoExtractDialog 的打开状态（Dialog 模式，需按钮触发）
  const [todoDialogOpen, setTodoDialogOpen] = useState(false);

  /**
   * 带回退的翻译函数。
   *
   * next-intl v4 在 key 不存在时开发模式 console.error、生产模式抛 IntlError。
   * 用 t.has() 检测后回退到中文默认值，保证渲染不中断。
   */
  const tf = useCallback(
    (key: string, fallback: string): string => {
      try {
        if (t.has(key)) return t(key);
      } catch {
        // t.has 抛异常时走回退
      }
      return fallback;
    },
    [t],
  );

  /** 获取 Tab 标签（带回退） */
  const tabLabel = useCallback(
    (tab: TabConfig): string => tf(tab.labelKey, tab.fallbackZh),
    [tf],
  );

  return (
    <main className="flex-1 min-w-0">
      <div className="mx-auto flex w-full max-w-[var(--container-max)] flex-col gap-[var(--space-6)] px-[var(--space-5)] py-[var(--space-6)]">
        {/* ─── 页面标题 ─── */}
        <header>
          <h1 className="flex items-center gap-2 text-[length:var(--text-2xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tracking-[var(--tracking-tight)]">
            <Sparkles size={22} className="text-[var(--accent)]" />
            {tf("title", "AI 工具中心")}
          </h1>
        </header>

        {/* ─── Tab 导航栏 ─── */}
        <nav
          role="tablist"
          aria-label={tf("title", "AI 工具中心")}
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
          {activeTab === "semanticSearch" && <SemanticSearchPanel wid={wid} />}
          {activeTab === "mailAssistant" && <MailAssistantPanel wid={wid} />}
          {activeTab === "todoExtract" && (
            <TodoExtractTabContent
              wid={wid}
              open={todoDialogOpen}
              onOpen={() => setTodoDialogOpen(true)}
              onClose={() => setTodoDialogOpen(false)}
              label={tabLabel(TABS[2])}
            />
          )}
          {activeTab === "meetingSummary" && <MeetingSummaryPanel wid={wid} />}
          {activeTab === "docQa" && <DocQaPanel wid={wid} />}
          {activeTab === "decisionAssistant" && <DecisionAssistantPanel wid={wid} />}
          {activeTab === "workflowOrchestrator" && <WorkflowOrchestratorPanel wid={wid} />}
          {activeTab === "aiPush" && <AiPushTabContent wid={wid} />}
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
          从消息、文档或邮件内容中提取隐含的待办事项，AI 自动识别标题、负责人、截止日期与优先级，支持批量入库。
        </p>
      </div>
      <button
        onClick={onOpen}
        className="inline-flex items-center gap-[var(--space-2)] h-10 px-[var(--space-5)] rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
      >
        <ListTodo size={16} />
        打开 {label}
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
              aria-label="关闭"
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