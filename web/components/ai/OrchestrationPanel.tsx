"use client";

/**
 * AI 跨能力联动编排面板。
 *
 * 交互流程：
 *  1. 用户可选输入关注点，点击「分析并建议联动」
 *  2. POST /api/v1/ai/orchestrate → 返回 OrchestrationPlan（summary + reasoning + actions）
 *  3. 展示方案，每个 action 前 checkbox 可勾选/取消（默认全选）
 *  4. 「执行选中操作」→ PATCH /api/v1/ai/orchestrate
 *  5. 展示每个操作执行结果（成功/失败+错误）
 *
 * 安全约束：方案仅"建议"，须用户勾选确认后才执行。
 *
 * Design token 样式 + lucide-react 图标（Workflow / Zap）size 14/16。
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Workflow, Zap, Loader2, CheckCircle2, XCircle, AlertCircle, X } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/Toast";
import { FeedbackButtons } from "./FeedbackButtons";

/** AiAction 前端简化类型——type 为判别字段，其余字段按 action 类型动态存在 */
interface AiAction {
  type: string;
  [key: string]: unknown;
}

/** 联动方案——与后端 OrchestrationPlan 一致 */
interface OrchestrationPlan {
  summary: string;
  reasoning: string;
  actions: AiAction[];
}

/** 单个操作执行结果——与后端 AiActionResult 一致 */
interface ActionResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

/** 输入框样式（design token） */
const fieldControl =
  "w-full px-2.5 py-2 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)]";

/** OrchestrationPanel Props */
interface OrchestrationPanelProps {
  /** 工作区 ID */
  wid: string;
}

/**
 * 获取 action 的显示描述（提取关键字段供用户识别操作内容）。
 *
 * 已知限制：updateTaskStatus/createDecision/linkToOkr 显示原始 taskId/keyResultId UUID，
 * 前端无法解析 UUID 为可读名称（需额外 API 查询，权衡后不做）。
 * 用户可结合 reasoning 文本理解操作意图。
 */
function actionDescription(action: AiAction): string {
  switch (action.type) {
    case "createTask":
      return String(action.title ?? "");
    case "notify":
      return String(action.message ?? "");
    case "createDocument":
      return String(action.title ?? "");
    case "scheduleMeeting":
      return String(action.title ?? "");
    case "sendAnnouncement":
      return String(action.title ?? "");
    case "updateTaskStatus":
      return `${String(action.taskId ?? "?")} → ${String(action.status ?? "?")}`;
    case "createDecision":
      return `task: ${String(action.taskId ?? "?")}`;
    case "linkToOkr":
      return `${String(action.taskId ?? "?")} → KR ${String(action.keyResultId ?? "?")}`;
    default:
      return "";
  }
}

export default function OrchestrationPanel({ wid }: OrchestrationPanelProps) {
  const t = useTranslations("ai.orchestration");
  const { toast } = useToast();

  const [userRequest, setUserRequest] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [plan, setPlan] = useState<OrchestrationPlan | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [executing, setExecuting] = useState(false);
  // results 映射: 全集 plan.actions 索引 → 执行结果。
  // 用 Map 而非数组，避免选中子集时索引错位（P0-1 修复）。
  const [results, setResults] = useState<Map<number, ActionResult> | null>(null);
  const [error, setError] = useState("");

  // AbortController：组件卸载时中止进行中的请求
  // 来源：经验 2026-09-12-abortcontroller-timeout-cleartimeout-finally-block
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  /** 分析并建议联动 */
  async function analyze() {
    if (analyzing) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setAnalyzing(true);
    setError("");
    setPlan(null);
    setResults(null);
    try {
      const result = await api<OrchestrationPlan>("/api/v1/ai/orchestrate", {
        method: "POST",
        body: JSON.stringify({
          wid,
          userRequest: userRequest.trim() || undefined,
        }),
        signal: ac.signal,
      });
      if (ac.signal.aborted) return;
      setPlan(result);
      // 默认全选所有 action
      setSelectedIndices(new Set(result.actions.map((_, i) => i)));
    } catch (e) {
      if (ac.signal.aborted || (e instanceof Error && e.name === "AbortError")) return;
      if (process.env.NODE_ENV === "development") console.error("[OrchestrationPanel] error:", e);
      setError(t("error"));
    } finally {
      if (!ac.signal.aborted) setAnalyzing(false);
    }
  }

  /** 切换 action 勾选状态 */
  function toggleAction(idx: number) {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  /** 执行选中的操作 */
  async function executeSelected() {
    if (executing || !plan) return;
    // 选中 action 的全集索引，按升序排列——用于建立"全集索引 → results 数组索引"映射
    const selectedIndexArray = Array.from(selectedIndices).sort((a, b) => a - b);
    const selectedActions = selectedIndexArray.map((i) => plan.actions[i]);
    if (selectedActions.length === 0) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setExecuting(true);
    setError("");
    setResults(null);
    try {
      const data = await api<{ success: boolean; results: ActionResult[] }>(
        "/api/v1/ai/orchestrate",
        {
          method: "PATCH",
          body: JSON.stringify({ wid, actions: selectedActions }),
          signal: ac.signal,
        },
      );
      if (ac.signal.aborted) return;
      // 建立映射: 全集索引 → results 中的位置
      // data.results 与 selectedActions 等长且顺序一致（executor 保证）
      const resultMap = new Map<number, ActionResult>();
      selectedIndexArray.forEach((fullIdx, resultIdx) => {
        resultMap.set(fullIdx, data.results[resultIdx]);
      });

      if (data.success) {
        toast("success", t("success"));
        // 执行成功后清空方案——执行后上下文已变化，旧方案可能不再适用（P1-6）
        setPlan(null);
        setSelectedIndices(new Set());
        setResults(null);
      } else {
        // 部分成功或全部失败：保留 plan + results 让用户查看执行详情
        setResults(resultMap);
        if (data.results.some((r) => r.success)) {
          toast("warning", t("partialSuccess"));
        } else {
          toast("error", t("failure"));
        }
      }
    } catch (e) {
      if (ac.signal.aborted || (e instanceof Error && e.name === "AbortError")) return;
      if (process.env.NODE_ENV === "development") console.error("[OrchestrationPanel] error:", e);
      setError(t("error"));
    } finally {
      if (!ac.signal.aborted) setExecuting(false);
    }
  }

  return (
    <div
      className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-sm)]"
      aria-label={t("title")}
    >
      {/* ── 头部 ── */}
      <header className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-soft)]">
        <h2 className="flex items-center gap-2 text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
          <Workflow size={16} className="text-[var(--accent)]" />
          {t("title")}
        </h2>
        <button
          type="button"
          onClick={analyze}
          disabled={analyzing || executing}
          className="inline-flex items-center gap-1.5 h-8 px-3 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
        >
          {analyzing ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              {t("analyzing")}
            </>
          ) : (
            <>
              <Zap size={14} />
              {t("analyze")}
            </>
          )}
        </button>
      </header>

      {/* ── 正文 ── */}
      <div className="px-5 py-4 space-y-[var(--space-3)]">
        {/* 关注点输入框（可选） */}
        <div>
          <label
            className="block text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)] mb-1.5"
            htmlFor="orchestration-user-request"
          >
            {t("userRequest")}
          </label>
          <input
            id="orchestration-user-request"
            type="text"
            value={userRequest}
            onChange={(e) => setUserRequest(e.target.value)}
            maxLength={500}
            placeholder={t("userRequestPlaceholder")}
            disabled={analyzing || executing}
            className={fieldControl}
          />
        </div>

        {/* 错误态 */}
        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-sm)]">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={() => setError("")}
              className="shrink-0 opacity-60 hover:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] rounded-[var(--radius-sm)]"
              aria-label={t("cancel")}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* 方案展示 */}
        {plan && (
          <div className="space-y-[var(--space-3)]">
            {/* summary */}
            <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-3)]">
              <span className="text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--muted)]">
                {t("summary")}
              </span>
              <p className="text-[length:var(--text-sm)] text-[var(--fg)] mt-0.5">{plan.summary}</p>
            </div>

            {/* reasoning */}
            <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-3)]">
              <span className="text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--muted)]">
                {t("reasoning")}
              </span>
              <p className="text-[length:var(--text-sm)] text-[var(--muted)] mt-0.5 whitespace-pre-wrap">
                {plan.reasoning}
              </p>
            </div>

            {/* actions 列表 */}
            <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-3)]">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-[length:var(--text-xs)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
                  {t("actions")}
                </span>
              </div>
              {plan.actions.length === 0 ? (
                <p className="text-[length:var(--text-sm)] text-[var(--muted)]">{t("noActions")}</p>
              ) : (
                <ul className="space-y-2">
                  {plan.actions.map((action, idx) => {
                    const checked = selectedIndices.has(idx);
                    const result = results?.get(idx);
                    return (
                      <li key={idx} className="flex items-start gap-2 text-[length:var(--text-sm)]">
                        {/* checkbox */}
                        <button
                          type="button"
                          role="checkbox"
                          onClick={() => toggleAction(idx)}
                          disabled={executing}
                          className="shrink-0 mt-0.5 w-4 h-4 flex items-center justify-center rounded border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg)] disabled:opacity-50"
                          style={{
                            borderColor: checked ? "var(--accent)" : "var(--border)",
                            backgroundColor: checked ? "var(--accent)" : "transparent",
                          }}
                          aria-label={`${t("selectActions")} ${action.type}`}
                          aria-checked={checked}
                        >
                          {checked && (
                            <svg
                              width="10"
                              height="10"
                              viewBox="0 0 12 12"
                              fill="none"
                              className="text-[var(--accent-fg)]"
                            >
                              <path
                                d="M2 6L5 9L10 3"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                        </button>
                        <div className="flex-1 min-w-0">
                          <code className="text-[var(--accent)] font-mono text-[length:var(--text-xs)]">
                            {action.type}
                          </code>
                          {actionDescription(action) && (
                            <span className="block mt-0.5 text-[var(--fg-2)] text-[length:var(--text-xs)] break-all">
                              {actionDescription(action)}
                            </span>
                          )}
                          {/* 执行结果 */}
                          {result && (
                            <span
                              className="flex items-center gap-1 mt-1 text-[length:var(--text-xs)]"
                              style={{
                                color: result.success ? "var(--success-fg)" : "var(--danger-fg)",
                              }}
                            >
                              {result.success ? (
                                <CheckCircle2 size={14} className="shrink-0" />
                              ) : (
                                <XCircle size={14} className="shrink-0" />
                              )}
                              {result.success ? t("success") : t("failure")}
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* 执行按钮 */}
            {plan.actions.length > 0 && (
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={executeSelected}
                  disabled={executing || selectedIndices.size === 0}
                  className="inline-flex items-center gap-1.5 h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
                >
                  {executing ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      {t("executing")}
                    </>
                  ) : (
                    <>
                      <Zap size={14} />
                      {t("execute")}
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        {/* AI 结果反馈按钮 */}
        {plan && (
          <div className="px-5 py-3.5 border-t border-[var(--border-soft)]">
            <FeedbackButtons capability="orchestrate" workspaceId={wid} originalOutput={plan} />
          </div>
        )}
      </div>
    </div>
  );
}
