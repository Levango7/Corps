"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Sparkles, X, ChevronRight, Check, SkipForward, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/Toast";
import Markdown from "@/components/Markdown";
import { FeedbackButtons } from "./FeedbackButtons";

/**
 * AI 会议全流程面板（会后阶段）
 *
 * 交互流程：
 *  1. 输入转写文本
 *  2. AI 分析 → 生成会议纪要（可编辑）
 *  3. 决策列表（调用 /decisions/extract，可编辑/删除/新增）
 *  4. 行动项列表（调用 /action-items/generate，可编辑/指派/设截止日期）
 *  5. 确认执行 → 批量创建任务
 *
 * 每步可跳过，最后确认才执行。
 * 样式全走 design token，图标用 lucide-react（size 14）。
 */

interface MeetingFlowPanelProps {
  wid: string;
  meetingId?: string;
  onClose: () => void;
}

/** 决策类型（POST /decisions/extract 返回） */
interface Decision {
  /** 前端唯一 id，用于 React key（列表可编辑/删除/新增，不能用 idx） */
  id: string;
  title: string;
  markdown: string;
  suggestedTags: string[];
}

/** 行动项类型（POST /action-items/generate 返回） */
interface ActionItem {
  /** 前端唯一 id，用于 React key（列表可编辑/删除/新增，不能用 idx） */
  id: string;
  title: string;
  description: string;
  suggestedAssignee: string | null;
  suggestedDueDate: string | null;
}

/** 流程步骤 */
type Step = "input" | "minutes" | "decisions" | "actions" | "confirm" | "done";

/** 步骤序号映射（用于进度指示） */
const STEP_ORDER: Record<Step, number> = {
  input: 0,
  minutes: 1,
  decisions: 2,
  actions: 3,
  confirm: 4,
  done: 5,
};

/** 前端唯一 id 生成器（模块级递增 counter，避免 crypto.randomUUID() 依赖） */
let _localId = 0;
function nextLocalId(): string {
  _localId += 1;
  return `mf-${_localId}`;
}

export default function MeetingFlowPanel({ wid, meetingId, onClose }: MeetingFlowPanelProps) {
  const t = useTranslations("ai.meetingFlow");
  const { toast } = useToast();

  const [step, setStep] = useState<Step>("input");
  const [transcript, setTranscript] = useState("");
  const [summary, setSummary] = useState("");
  const [summaryEditing, setSummaryEditing] = useState(false);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [createdCount, setCreatedCount] = useState(0);

  // AbortController：组件卸载时中止进行中的请求
  // 来源：经验 2026-09-12-abortcontroller-timeout-cleartimeout-finally-block
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  /** Step 1→2：AI 分析转写文本，生成会议纪要 */
  async function handleAnalyze() {
    const text = transcript.trim();
    if (!text) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ summary: string; decisions: unknown[]; actionItems: unknown[] }>(
        "/api/v1/ai/meeting-flow",
        {
          method: "POST",
          body: JSON.stringify({ phase: "post", transcript: text, wid, meetingId }),
          signal: ac.signal,
        },
      );
      if (ac.signal.aborted) return;
      setSummary(data.summary ?? "");
      setStep("minutes");
    } catch (e) {
      if (ac.signal.aborted || (e instanceof Error && e.name === "AbortError")) return;
      if (process.env.NODE_ENV === "development") console.error("[MeetingFlowPanel] error:", e);
      setError(t("error"));
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }

  /** Step 2→3：从纪要提取决策 */
  async function handleExtractDecisions() {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      const data = await api<{
        title: string;
        markdown: string;
        suggestedTags: string[];
        provider: string;
      }>(`/api/v1/workspaces/${wid}/decisions/extract`, {
        method: "POST",
        body: JSON.stringify({ sourceText: summary }),
        signal: ac.signal,
      });
      if (ac.signal.aborted) return;
      setDecisions([
        {
          id: nextLocalId(),
          title: data.title,
          markdown: data.markdown,
          suggestedTags: data.suggestedTags,
        },
      ]);
      setStep("decisions");
    } catch (e) {
      if (ac.signal.aborted || (e instanceof Error && e.name === "AbortError")) return;
      if (process.env.NODE_ENV === "development") console.error("[MeetingFlowPanel] error:", e);
      setError(t("error"));
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }

  /** Step 3→4：从决策生成行动项 */
  async function handleGenerateActions() {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      const decisionMarkdown = decisions.map((d) => d.markdown).join("\n\n") || summary;
      const data = await api<{ actionItems: Omit<ActionItem, "id">[] }>(
        `/api/v1/workspaces/${wid}/action-items/generate`,
        { method: "POST", body: JSON.stringify({ decisionMarkdown }), signal: ac.signal },
      );
      if (ac.signal.aborted) return;
      setActionItems((data.actionItems ?? []).map((a) => ({ ...a, id: nextLocalId() })));
      setStep("actions");
    } catch (e) {
      if (ac.signal.aborted || (e instanceof Error && e.name === "AbortError")) return;
      if (process.env.NODE_ENV === "development") console.error("[MeetingFlowPanel] error:", e);
      setError(t("error"));
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }

  /** Step 4→5：进入确认 */
  function handleToConfirm() {
    setError(null);
    setStep("confirm");
  }

  /** Step 5：确认执行——批量创建任务（带部分失败提示） */
  async function handleExecute() {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setExecuting(true);
    setError(null);
    let count = 0;
    try {
      for (const item of actionItems) {
        if (ac.signal.aborted) break;
        await api(`/api/v1/workspaces/${wid}/tasks`, {
          method: "POST",
          body: JSON.stringify({
            title: item.title,
            description: item.description,
            status: "todo",
            priority: "medium",
            dueDate: item.suggestedDueDate ?? undefined,
          }),
          signal: ac.signal,
        });
        count++;
      }
      if (ac.signal.aborted) return;
      setCreatedCount(count);
      setStep("done");
    } catch (e) {
      if (ac.signal.aborted || (e instanceof Error && e.name === "AbortError")) return;
      // 部分失败：提示已创建数量
      if (count > 0) {
        toast("warning", t("partialCreateSuccess", { created: count, failed: 1 }));
        setCreatedCount(count);
        setStep("done");
      } else {
        if (process.env.NODE_ENV === "development") console.error("[MeetingFlowPanel] error:", e);
        setError(t("error"));
      }
    } finally {
      if (!ac.signal.aborted) setExecuting(false);
    }
  }

  /** 跳过当前步骤 */
  function handleSkip() {
    setError(null);
    if (step === "minutes") {
      setDecisions([]);
      setStep("decisions");
    } else if (step === "decisions") {
      setActionItems([]);
      setStep("actions");
    } else if (step === "actions") {
      setStep("confirm");
    }
  }

  /** 删除决策 */
  function removeDecision(id: string) {
    setDecisions(decisions.filter((d) => d.id !== id));
  }

  /** 编辑决策标题 */
  function updateDecisionTitle(id: string, title: string) {
    setDecisions(decisions.map((d) => (d.id === id ? { ...d, title } : d)));
  }

  /** 删除行动项 */
  function removeActionItem(id: string) {
    setActionItems(actionItems.filter((a) => a.id !== id));
  }

  /** 编辑行动项 */
  function updateActionItem(id: string, patch: Partial<ActionItem>) {
    setActionItems(actionItems.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }

  /** 新增空决策 */
  function addDecision() {
    setDecisions([...decisions, { id: nextLocalId(), title: "", markdown: "", suggestedTags: [] }]);
  }

  /** 新增空行动项 */
  function addActionItem() {
    setActionItems([
      ...actionItems,
      {
        id: nextLocalId(),
        title: "",
        description: "",
        suggestedAssignee: null,
        suggestedDueDate: null,
      },
    ]);
  }

  return (
    <aside
      className="flex h-full w-[480px] flex-col border-l border-[var(--border)] bg-[var(--surface)]"
      aria-label={t("title")}
    >
      {/* 标题栏 */}
      <header className="flex items-center justify-between border-b border-[var(--border)] px-[var(--space-4)] py-[var(--space-3)]">
        <div className="flex items-center gap-[var(--space-2)]">
          <Sparkles size={14} className="text-[var(--accent)]" />
          <h2 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
            {t("title")}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
          aria-label={t("close")}
        >
          <X size={14} />
        </button>
      </header>

      {/* 进度指示 */}
      {step !== "input" && step !== "done" && (
        <div className="flex items-center gap-[var(--space-1)] px-[var(--space-4)] py-[var(--space-2)]">
          {(["minutes", "decisions", "actions", "confirm"] as Step[]).map((s, i) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full transition-colors duration-[var(--motion-base)] ${
                STEP_ORDER[step] > STEP_ORDER[s]
                  ? "bg-[var(--accent)]"
                  : STEP_ORDER[step] === STEP_ORDER[s]
                    ? "bg-[var(--accent)]"
                    : "bg-[var(--surface-3)]"
              }`}
              aria-hidden
            >
              <span className="sr-only">{`${t("step")} ${i + 1}`}</span>
            </div>
          ))}
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="mx-[var(--space-4)] my-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--danger)] bg-[var(--danger-soft)] px-[var(--space-3)] py-[var(--space-2)]">
          <span className="text-[length:var(--text-sm)] text-[var(--danger)]">{error}</span>
        </div>
      )}

      {/* 主内容区 */}
      <div className="flex-1 overflow-y-auto px-[var(--space-4)] py-[var(--space-3)]">
        {/* Step 0: 输入转写文本 */}
        {step === "input" && (
          <div className="flex h-full flex-col gap-[var(--space-3)]">
            <p className="text-[length:var(--text-sm)] text-[var(--muted)]">{t("inputHint")}</p>
            <textarea
              value={transcript}
              onChange={(e) => setTranscript(e.currentTarget.value)}
              placeholder={t("transcriptPlaceholder")}
              rows={10}
              className="flex-1 resize-none rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--fg)] placeholder:text-[var(--meta)] transition-colors duration-[var(--motion-fast)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
              aria-label={t("transcriptPlaceholder")}
            />
          </div>
        )}

        {/* Step 1: 会议纪要（可编辑） */}
        {step === "minutes" && (
          <div className="flex flex-col gap-[var(--space-3)]">
            <div className="flex items-center justify-between">
              <h3 className="text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
                {t("minutesTitle")}
              </h3>
              <button
                type="button"
                onClick={() => setSummaryEditing(!summaryEditing)}
                className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-[length:var(--text-xs)] text-[var(--accent)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--accent-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
              >
                {summaryEditing ? t("preview") : t("edit")}
              </button>
            </div>
            {summaryEditing ? (
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.currentTarget.value)}
                rows={16}
                aria-label={t("summaryLabel")}
                className="resize-none rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--fg)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
              />
            ) : (
              <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--fg-2)] [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
                <Markdown source={summary} />
              </div>
            )}
          </div>
        )}

        {/* Step 2: 决策列表 */}
        {step === "decisions" && (
          <div className="flex flex-col gap-[var(--space-3)]">
            <div className="flex items-center justify-between">
              <h3 className="text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
                {t("decisionsTitle")}
              </h3>
              <button
                type="button"
                onClick={addDecision}
                className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-[length:var(--text-xs)] text-[var(--accent)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--accent-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
              >
                {t("add")}
              </button>
            </div>
            {decisions.length === 0 ? (
              <p className="text-[length:var(--text-sm)] text-[var(--meta)]">{t("noDecisions")}</p>
            ) : (
              decisions.map((d) => (
                <div
                  key={d.id}
                  className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] px-[var(--space-3)] py-[var(--space-2)]"
                >
                  <div className="flex items-center gap-[var(--space-2)]">
                    <input
                      value={d.title}
                      onChange={(e) => updateDecisionTitle(d.id, e.currentTarget.value)}
                      placeholder={t("decisionTitlePlaceholder")}
                      aria-label={t("decisionTitleLabel")}
                      className="flex-1 rounded-[var(--radius-sm)] border border-transparent bg-transparent px-2 py-1 text-[length:var(--text-sm)] text-[var(--fg)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
                    />
                    <button
                      type="button"
                      onClick={() => removeDecision(d.id)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                      aria-label={t("delete")}
                    >
                      <X size={14} />
                    </button>
                  </div>
                  {d.markdown && (
                    <div className="mt-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--fg-2)] [&_p]:my-1">
                      <Markdown source={d.markdown} />
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Step 3: 行动项列表 */}
        {step === "actions" && (
          <div className="flex flex-col gap-[var(--space-3)]">
            <div className="flex items-center justify-between">
              <h3 className="text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
                {t("actionItemsTitle")}
              </h3>
              <button
                type="button"
                onClick={addActionItem}
                className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-[length:var(--text-xs)] text-[var(--accent)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--accent-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
              >
                {t("add")}
              </button>
            </div>
            {actionItems.length === 0 ? (
              <p className="text-[length:var(--text-sm)] text-[var(--meta)]">
                {t("noActionItems")}
              </p>
            ) : (
              actionItems.map((a) => (
                <div
                  key={a.id}
                  className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] px-[var(--space-3)] py-[var(--space-2)]"
                >
                  <div className="flex items-start gap-[var(--space-2)]">
                    <div className="flex-1 flex flex-col gap-[var(--space-2)]">
                      <input
                        value={a.title}
                        onChange={(e) => updateActionItem(a.id, { title: e.currentTarget.value })}
                        placeholder={t("actionTitlePlaceholder")}
                        aria-label={t("actionTitleLabel")}
                        className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[length:var(--text-sm)] text-[var(--fg)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
                      />
                      <textarea
                        value={a.description}
                        onChange={(e) =>
                          updateActionItem(a.id, { description: e.currentTarget.value })
                        }
                        placeholder={t("actionDescPlaceholder")}
                        aria-label={t("actionDescLabel")}
                        rows={2}
                        className="resize-none rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[length:var(--text-xs)] text-[var(--fg-2)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
                      />
                      <div className="flex items-center gap-[var(--space-2)]">
                        <input
                          value={a.suggestedAssignee ?? ""}
                          onChange={(e) =>
                            updateActionItem(a.id, {
                              suggestedAssignee: e.currentTarget.value || null,
                            })
                          }
                          placeholder={t("assigneePlaceholder")}
                          aria-label={t("assigneeLabel")}
                          className="flex-1 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[length:var(--text-xs)] text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
                        />
                        <input
                          type="date"
                          value={a.suggestedDueDate ?? ""}
                          onChange={(e) =>
                            updateActionItem(a.id, {
                              suggestedDueDate: e.currentTarget.value || null,
                            })
                          }
                          aria-label={t("dueDateLabel")}
                          className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[length:var(--text-xs)] text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeActionItem(a.id)}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                      aria-label={t("delete")}
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Step 4: 确认执行 */}
        {step === "confirm" && (
          <div className="flex flex-col gap-[var(--space-3)]">
            <h3 className="text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
              {t("confirmTitle")}
            </h3>
            <p className="text-[length:var(--text-sm)] text-[var(--muted)]">{t("confirmHint")}</p>
            <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] px-[var(--space-3)] py-[var(--space-2)]">
              <p className="text-[length:var(--text-sm)] text-[var(--fg)]">
                {t("taskCount", { count: actionItems.length })}
              </p>
            </div>
          </div>
        )}

        {/* Step 5: 完成 */}
        {step === "done" && (
          <div className="flex h-full flex-col items-center justify-center gap-[var(--space-3)] text-center">
            <Check size={32} className="text-[var(--success)]" />
            <p className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
              {t("doneTitle")}
            </p>
            <p className="text-[length:var(--text-sm)] text-[var(--muted)]">
              {t("doneHint", { count: createdCount })}
            </p>

            {/* AI 结果反馈按钮 */}
            <FeedbackButtons capability="meeting-flow" workspaceId={wid} originalOutput={summary} />
          </div>
        )}
      </div>

      {/* 底部操作栏 */}
      {step !== "done" && (
        <footer className="flex items-center justify-between border-t border-[var(--border)] px-[var(--space-4)] py-[var(--space-3)]">
          {/* 左侧：跳过按钮（minutes/decisions/actions 步骤可跳过） */}
          <div>
            {(step === "minutes" || step === "decisions" || step === "actions") && (
              <button
                type="button"
                onClick={handleSkip}
                disabled={loading}
                className="inline-flex items-center gap-1 rounded-[var(--radius-md)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--muted)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
              >
                <SkipForward size={14} />
                {t("skip")}
              </button>
            )}
          </div>

          {/* 右侧：主操作按钮 */}
          <div className="flex items-center gap-[var(--space-2)]">
            {step === "input" && (
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={!transcript.trim() || loading}
                className="inline-flex items-center gap-1 rounded-[var(--radius-md)] bg-[var(--accent)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--on-accent)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {t("analyze")}
              </button>
            )}

            {step === "minutes" && (
              <button
                type="button"
                onClick={handleExtractDecisions}
                disabled={loading}
                className="inline-flex items-center gap-1 rounded-[var(--radius-md)] bg-[var(--accent)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--on-accent)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
              >
                {loading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <ChevronRight size={14} />
                )}
                {t("next")}
              </button>
            )}

            {step === "decisions" && (
              <button
                type="button"
                onClick={handleGenerateActions}
                disabled={loading}
                className="inline-flex items-center gap-1 rounded-[var(--radius-md)] bg-[var(--accent)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--on-accent)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
              >
                {loading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <ChevronRight size={14} />
                )}
                {t("next")}
              </button>
            )}

            {step === "actions" && (
              <button
                type="button"
                onClick={handleToConfirm}
                className="inline-flex items-center gap-1 rounded-[var(--radius-md)] bg-[var(--accent)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--on-accent)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
              >
                <ChevronRight size={14} />
                {t("next")}
              </button>
            )}

            {step === "confirm" && (
              <button
                type="button"
                onClick={handleExecute}
                disabled={executing || actionItems.length === 0}
                className="inline-flex items-center gap-1 rounded-[var(--radius-md)] bg-[var(--success)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--on-accent)] transition-colors duration-[var(--motion-fast)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
              >
                {executing ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {t("execute")}
              </button>
            )}
          </div>
        </footer>
      )}
    </aside>
  );
}
