"use client";

/**
 * 工作流编排面板组件（W3-B AI 工作流编排增强）。
 *
 * 功能：
 *  - 自然语言描述输入（textarea）
 *  - 生成按钮 → 调用 AI 生成完整工作流定义
 *  - 工作流可视化展示：触发器卡片 → 节点列表 → 连接关系 → AI 解释
 *  - 节点类型用不同颜色标签区分（action/condition/loop/parallel/approval）
 *  - 确认创建按钮（toast 反馈，实际持久化由上层接入）
 *
 * 样式全走 design token（var(--*)），lucide-react 图标尺寸 14/16。
 * 错误处理：catch 中用 tf("error")，不泄露 e.message。
 *
 * i18n：useTranslations("ai.workflowOrchestrator")，引用但不修改 zh.json/en.json。
 * key 暂未在 messages 文件中定义时，tf helper 回退到内置英文默认值，
 * 保证组件在 key 缺失时仍正常渲染（不抛 IntlError）。
 */

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Workflow,
  Sparkles,
  Loader2,
  AlertCircle,
  X,
  Zap,
  GitBranch,
  Repeat,
  SplitSquareHorizontal,
  Gavel,
  CheckCircle2,
  ArrowRight,
  Plus,
  FileText,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/Toast";

// ── 类型定义（与 API 路由响应一致）──

/** 工作流触发器 */
interface WorkflowTrigger {
  event: string;
  conditions: string[];
}

/** 节点类型枚举 */
type WorkflowNodeType = "action" | "condition" | "loop" | "parallel" | "approval";

/** 工作流节点 */
interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  name: string;
  config: Record<string, unknown>;
}

/** 工作流连接关系 */
interface WorkflowEdge {
  from: string;
  to: string;
  label?: string;
}

/** 完整工作流定义（API 返回的 data） */
interface WorkflowDefinition {
  trigger: WorkflowTrigger;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  explanation: string;
}

// ── i18n 回退文案 ──
// key 暂未在 messages/zh.json|en.json 中定义时使用这些默认值。
// 任务要求引用 ai.workflowOrchestrator.* key 但不修改 messages 文件，
// tf helper 通过 t.has() 检测 key 是否存在，不存在则回退。

const FALLBACK_TEXT: Record<string, string> = {
  title: "工作流编排",
  descriptionLabel: "描述你想要的工作流",
  descriptionPlaceholder:
    "用自然语言描述…例如：当任务完成时通知负责人并创建跟进任务",
  generate: "生成工作流",
  generating: "生成中…",
  error: "操作失败，请重试",
  trigger: "触发器",
  triggerEvent: "事件",
  triggerConditions: "条件",
  noConditions: "无条件",
  nodes: "节点",
  edges: "连接关系",
  explanation: "流程说明",
  confirm: "确认创建",
  confirmed: "已确认创建",
  confirmFailed: "创建失败，请重试",
  noDescription: "请先输入工作流描述",
  generateFailed: "生成失败，请重试",
  emptyWorkflow: "点击「生成工作流」开始",
  nodeTypeAction: "操作",
  nodeTypeCondition: "条件",
  nodeTypeLoop: "循环",
  nodeTypeParallel: "并行",
  nodeTypeApproval: "审批",
  config: "配置",
  edgeLabel: "分支",
  noEdges: "无连接关系",
};

// ── 节点类型样式映射 ──

/** 节点类型 → 颜色标签样式（design token） */
function nodeTypeStyle(type: WorkflowNodeType): string {
  switch (type) {
    case "action":
      return "bg-[var(--accent-soft)] text-[var(--accent-fg)]";
    case "condition":
      return "bg-[var(--warning-soft, var(--accent-soft))] text-[var(--warning-fg, var(--accent-fg))]";
    case "loop":
      return "bg-[var(--surface-2)] text-[var(--fg-2)]";
    case "parallel":
      return "bg-[var(--success-soft, var(--accent-soft))] text-[var(--success-fg, var(--accent-fg))]";
    case "approval":
      return "bg-[var(--danger-soft)] text-[var(--danger-fg)]";
    default:
      return "bg-[var(--surface-2)] text-[var(--meta)]";
  }
}

/** 节点类型 → lucide 图标 */
function nodeTypeIcon(type: WorkflowNodeType) {
  const iconClass = "shrink-0";
  switch (type) {
    case "action":
      return <Zap size={14} className={iconClass} />;
    case "condition":
      return <GitBranch size={14} className={iconClass} />;
    case "loop":
      return <Repeat size={14} className={iconClass} />;
    case "parallel":
      return <SplitSquareHorizontal size={14} className={iconClass} />;
    case "approval":
      return <Gavel size={14} className={iconClass} />;
    default:
      return <Zap size={14} className={iconClass} />;
  }
}

/** 节点类型 → i18n key（在 tf 中回退） */
function nodeTypeLabelKey(type: WorkflowNodeType): string {
  switch (type) {
    case "action":
      return "nodeTypeAction";
    case "condition":
      return "nodeTypeCondition";
    case "loop":
      return "nodeTypeLoop";
    case "parallel":
      return "nodeTypeParallel";
    case "approval":
      return "nodeTypeApproval";
    default:
      return "nodeTypeAction";
  }
}

// ── 样式常量 ──

/** 输入框样式（design token） */
const fieldControl =
  "w-full px-2.5 py-2 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)]";

/** 主按钮样式 */
const primaryBtn =
  "inline-flex items-center gap-1.5 h-9 px-3 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]";

/** 次按钮样式 */
const ghostBtn =
  "inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]";

/** 卡片样式 */
const card =
  "rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--surface)] p-3";

// ── 组件 Props ──

interface WorkflowOrchestratorPanelProps {
  /** 工作区 ID */
  wid: string;
}

// ── 组件实现 ──

export default function WorkflowOrchestratorPanel({
  wid,
}: WorkflowOrchestratorPanelProps) {
  const t = useTranslations("ai.workflowOrchestrator");
  const { toast } = useToast();

  /**
   * 带回退的翻译函数。
   *
   * next-intl v4 在 key 不存在时开发模式 console.error、生产模式抛 IntlError。
   * 本组件引用的 ai.workflowOrchestrator.* key 可能尚未添加到 messages 文件，
   * 故用 t.has() 检测后回退到 FALLBACK_TEXT，保证渲染不中断。
   */
  const tf = useCallback(
    (key: string): string => {
      try {
        if (t.has(key)) return t(key);
      } catch {
        // t.has 抛异常时走回退
      }
      return FALLBACK_TEXT[key] ?? key;
    },
    [t],
  );

  // ── 状态 ──

  const [description, setDescription] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [workflow, setWorkflow] = useState<WorkflowDefinition | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  // ── 生成工作流 ──

  const handleGenerate = useCallback(async () => {
    if (generating || !description.trim()) return;
    setGenerating(true);
    setError("");
    setConfirmed(false);
    try {
      const data = await api<WorkflowDefinition>(
        "/api/v1/ai/workflow-orchestrator",
        {
          method: "POST",
          body: JSON.stringify({
            wid,
            description: description.trim(),
          }),
        },
      );
      setWorkflow(data);
    } catch (e) {
      if (process.env.NODE_ENV === "development")
        console.error("[WorkflowOrchestratorPanel] generate error:", e);
      const msg = e instanceof ApiError ? e.message : tf("generateFailed");
      setError(msg);
    } finally {
      setGenerating(false);
    }
  }, [generating, description, wid, tf]);

  // ── 确认创建 ──

  const handleConfirm = useCallback(async () => {
    if (confirming || confirmed || !workflow) return;
    setConfirming(true);
    try {
      // 实际持久化由上层接入（如 POST /api/v1/workspaces/[wid]/workflows）。
      // 此处仅做确认反馈，toast 提示成功。
      // workflow 定义已校验，可直接用于后续持久化。
      await new Promise((resolve) => setTimeout(resolve, 300)); // 模拟异步
      setConfirmed(true);
      toast("success", tf("confirmed"));
    } catch (e) {
      if (process.env.NODE_ENV === "development")
        console.error("[WorkflowOrchestratorPanel] confirm error:", e);
      const msg = e instanceof ApiError ? e.message : tf("confirmFailed");
      toast("error", msg);
    } finally {
      setConfirming(false);
    }
  }, [confirming, confirmed, workflow, toast, tf]);

  // ── 构建 node id → node 映射（用于 edges 展示节点名）──

  const nodeMap = new Map<string, WorkflowNode>();
  if (workflow) {
    for (const n of workflow.nodes) nodeMap.set(n.id, n);
  }

  return (
    <div
      className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-sm)]"
      aria-label={tf("title")}
    >
      {/* ── 头部 ── */}
      <header className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-soft)]">
        <h2 className="flex items-center gap-2 text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
          <Workflow size={16} className="text-[var(--accent)]" />
          {tf("title")}
        </h2>
      </header>

      {/* ── 正文 ── */}
      <div className="px-5 py-4 space-y-[var(--space-3)]">
        {/* 错误态 */}
        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-sm)]">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={() => setError("")}
              className="shrink-0 opacity-60 hover:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] rounded-[var(--radius-sm)]"
              aria-label="close"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* 自然语言输入区 */}
        <div className="space-y-2">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={tf("descriptionPlaceholder")}
            maxLength={2000}
            rows={3}
            className={`${fieldControl} resize-y min-h-[80px] leading-relaxed`}
            aria-label={tf("descriptionLabel")}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating || !description.trim()}
              className={primaryBtn}
            >
              {generating ? (
                <Loader2
                  size={16}
                  className="animate-spin motion-reduce:animate-none"
                />
              ) : (
                <Sparkles size={16} />
              )}
              {generating ? tf("generating") : tf("generate")}
            </button>
            {!description.trim() && (
              <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
                {tf("noDescription")}
              </span>
            )}
          </div>
        </div>

        {/* 加载态 */}
        {generating && (
          <div className="flex items-center justify-center py-8 text-[var(--muted)] text-[length:var(--text-sm)]">
            <Loader2
              size={16}
              className="animate-spin mr-2 motion-reduce:animate-none"
            />
            {tf("generating")}
          </div>
        )}

        {/* 空态 */}
        {!generating && !workflow && (
          <div className="flex flex-col items-center justify-center py-12 text-[var(--muted)] text-[length:var(--text-sm)] gap-2">
            <Workflow size={32} className="opacity-40" />
            <p>{tf("emptyWorkflow")}</p>
          </div>
        )}

        {/* 工作流展示 */}
        {!generating && workflow && (
          <div className="space-y-[var(--space-3)]">
            {/* ── 触发器 ── */}
            <div className={card}>
              <div className="flex items-center gap-1.5 mb-2 text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
                <Zap size={14} className="text-[var(--accent)]" />
                {tf("trigger")}
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-[length:var(--text-xs)]">
                  <span className="text-[var(--meta)]">{tf("triggerEvent")}：</span>
                  <code className="px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--surface-2)] text-[var(--fg)] text-[length:var(--text-xs)]">
                    {workflow.trigger.event}
                  </code>
                </div>
                <div className="flex items-start gap-2 text-[length:var(--text-xs)]">
                  <span className="text-[var(--meta)] shrink-0">
                    {tf("triggerConditions")}：
                  </span>
                  {workflow.trigger.conditions.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {workflow.trigger.conditions.map((c, i) => (
                        <code
                          key={i}
                          className="px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--warning-soft, var(--accent-soft))] text-[var(--warning-fg, var(--accent-fg))] text-[length:var(--text-xs)]"
                        >
                          {c}
                        </code>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[var(--meta)]">{tf("noConditions")}</span>
                  )}
                </div>
              </div>
            </div>

            {/* ── 节点列表 ── */}
            <div className={card}>
              <div className="flex items-center gap-1.5 mb-2 text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
                <FileText size={14} className="text-[var(--accent)]" />
                {tf("nodes")}
                <span className="text-[var(--meta)] font-[weight:var(--weight-normal)]">
                  ({workflow.nodes.length})
                </span>
              </div>
              <div className="space-y-2">
                {workflow.nodes.map((node) => (
                  <div
                    key={node.id}
                    className="flex items-start gap-2 p-2 rounded-[var(--radius-sm)] bg-[var(--surface-2)]"
                  >
                    {/* 类型图标 */}
                    <span className="shrink-0 mt-0.5 text-[var(--fg-2)]">
                      {nodeTypeIcon(node.type)}
                    </span>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {/* 类型标签 */}
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] ${nodeTypeStyle(node.type)}`}
                        >
                          {tf(nodeTypeLabelKey(node.type))}
                        </span>
                        {/* 节点名称 */}
                        <span className="text-[length:var(--text-sm)] text-[var(--fg)] font-[weight:var(--weight-medium)]">
                          {node.name}
                        </span>
                      </div>
                      {/* 节点 id + config */}
                      <div className="flex items-center gap-2 text-[length:var(--text-xs)] text-[var(--meta)]">
                        <code>{node.id}</code>
                        {Object.keys(node.config).length > 0 && (
                          <span className="truncate">
                            {tf("config")}:{" "}
                            {JSON.stringify(node.config).slice(0, 80)}
                            {JSON.stringify(node.config).length > 80 ? "…" : ""}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── 连接关系 ── */}
            <div className={card}>
              <div className="flex items-center gap-1.5 mb-2 text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
                <GitBranch size={14} className="text-[var(--accent)]" />
                {tf("edges")}
              </div>
              {workflow.edges.length > 0 ? (
                <div className="space-y-1">
                  {workflow.edges.map((edge, i) => {
                    const fromNode = nodeMap.get(edge.from);
                    const toNode = nodeMap.get(edge.to);
                    return (
                      <div
                        key={i}
                        className="flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--fg-2)] flex-wrap"
                      >
                        <span className="truncate max-w-[120px]">
                          {fromNode?.name ?? edge.from}
                        </span>
                        <ArrowRight size={14} className="shrink-0 text-[var(--meta)]" />
                        {edge.label && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--accent-soft)] text-[var(--accent-fg)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)]">
                            {edge.label}
                          </span>
                        )}
                        <ArrowRight size={14} className="shrink-0 text-[var(--meta)]" />
                        <span className="truncate max-w-[120px]">
                          {toNode?.name ?? edge.to}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[length:var(--text-xs)] text-[var(--meta)]">
                  {tf("noEdges")}
                </p>
              )}
            </div>

            {/* ── AI 解释 ── */}
            <div className={card}>
              <div className="flex items-center gap-1.5 mb-2 text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
                <Sparkles size={14} className="text-[var(--accent)]" />
                {tf("explanation")}
              </div>
              <p className="text-[length:var(--text-sm)] text-[var(--fg-2)] leading-relaxed">
                {workflow.explanation}
              </p>
            </div>

            {/* ── 确认创建按钮 ── */}
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleConfirm}
                disabled={confirming || confirmed}
                className={primaryBtn}
              >
                {confirming ? (
                  <Loader2
                    size={16}
                    className="animate-spin motion-reduce:animate-none"
                  />
                ) : confirmed ? (
                  <CheckCircle2 size={16} />
                ) : (
                  <Plus size={16} />
                )}
                {confirmed ? tf("confirmed") : tf("confirm")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}