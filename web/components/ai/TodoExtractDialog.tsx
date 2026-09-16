"use client";

/**
 * AI 待办提取弹窗 —— 从消息 / 文档 / 邮件内容中提取隐含的待办事项。
 *
 * 交互流程：
 *  1. 选择源类型（消息 / 文档 / 邮件）+ 粘贴/输入内容
 *  2. 点击"提取"调用 /api/v1/ai/todo-extract，显示 loading
 *  3. 返回后展示可编辑待办列表（标题/负责人/截止日期/优先级）+ 勾选框
 *  4. AI 推理过程可折叠查看
 *  5. "批量入库" → 对勾选待办逐条 POST /api/v1/workspaces/{wid}/tasks
 *  6. 成功后 Toast + onCreated + onClose
 *
 * Design token 样式 + lucide-react 图标 size 14/16。
 * Props: { wid, onClose, onCreated? }
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ListTodo,
  X,
  MessageSquare,
  FileText,
  Mail,
  Plus,
  Check,
  Loader2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/Toast";

// ─── 类型定义 ──────────────────────────────────────────────────────────────────

type Source = "message" | "document" | "email";
type Priority = "low" | "medium" | "high" | "urgent";

interface TodoItem {
  title: string;
  description?: string;
  assignee?: string | null;
  dueDate?: string | null;
  priority: Priority;
  confidence: number;
}

interface TodoExtractResult {
  todos: TodoItem[];
  reasoning: string;
}

/** 可编辑待办项（前端临时 id + 选中状态） */
interface EditableTodo extends TodoItem {
  localId: string;
  selected: boolean;
}

// ─── 常量 ──────────────────────────────────────────────────────────────────────

/** 源类型选项配置 */
const SOURCE_OPTS: {
  value: Source;
  labelKey: string;
  Icon: typeof MessageSquare;
}[] = [
  { value: "message", labelKey: "sourceMessage", Icon: MessageSquare },
  { value: "document", labelKey: "sourceDocument", Icon: FileText },
  { value: "email", labelKey: "sourceEmail", Icon: Mail },
];

/** 优先级选项配置 */
const PRIORITY_OPTS: { value: Priority; labelKey: string }[] = [
  { value: "low", labelKey: "priorityLow" },
  { value: "medium", labelKey: "priorityMedium" },
  { value: "high", labelKey: "priorityHigh" },
  { value: "urgent", labelKey: "priorityUrgent" },
];

/** 优先级 → 颜色 token 映射 */
const PRIORITY_COLOR: Record<Priority, string> = {
  urgent: "var(--danger)",
  high: "var(--prio-high-fg)",
  medium: "var(--prio-med-fg)",
  low: "var(--prio-low-fg)",
};

let _localId = 0;
function nextLocalId(): string {
  _localId += 1;
  return `todo-local-${_localId}`;
}

// ─── 样式常量 ──────────────────────────────────────────────────────────────────

const fieldControl =
  "w-full h-9 px-2.5 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)]";

const sourceBtnBase =
  "flex-1 inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]";

// ─── 组件 ──────────────────────────────────────────────────────────────────────

export default function TodoExtractDialog({
  wid,
  onClose,
  onCreated,
}: {
  wid: string;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const t = useTranslations("ai.todoExtract");
  const tButton = useTranslations("button");
  const { toast } = useToast();

  const [source, setSource] = useState<Source>("message");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [todos, setTodos] = useState<EditableTodo[]>([]);
  const [reasoning, setReasoning] = useState("");
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [hasExtracted, setHasExtracted] = useState(false);

  // AbortController：组件卸载时中止进行中的请求
  // 来源：经验 2026-09-12-abortcontroller-timeout-cleartimeout-finally-block
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // ── Escape 关闭 ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting && !loading) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting, loading]);

  // ── 提取待办 ──
  async function handleExtract() {
    if (loading) return;
    if (!content.trim()) {
      toast("error", t("contentLabel"));
      return;
    }
    setLoading(true);
    setError("");
    setHasExtracted(false);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const result = await api<TodoExtractResult>("/api/v1/ai/todo-extract", {
        method: "POST",
        body: JSON.stringify({ wid, source, content }),
        signal: ac.signal,
      });
      if (ac.signal.aborted) return;
      setTodos(
        result.todos.map((todo) => ({
          ...todo,
          localId: nextLocalId(),
          selected: true,
        })),
      );
      setReasoning(result.reasoning);
      setHasExtracted(true);
    } catch (e) {
      if (ac.signal.aborted) return;
      if (e instanceof Error && e.name === "AbortError") return;
      // 不直接显示后端 error.message，用 i18n 错误提示
      setError(
        e instanceof ApiError ? e.message : t("extractFailed"),
      );
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }

  // ── 更新单条待办 ──
  function updateTodo(localId: string, patch: Partial<EditableTodo>) {
    setTodos((prev) =>
      prev.map((todo) => (todo.localId === localId ? { ...todo, ...patch } : todo)),
    );
  }

  // ── 切换单条选中 ──
  function toggleSelect(localId: string) {
    setTodos((prev) =>
      prev.map((todo) =>
        todo.localId === localId ? { ...todo, selected: !todo.selected } : todo,
      ),
    );
  }

  // ── 全选 / 全不选 ──
  function toggleSelectAll(selectAll: boolean) {
    setTodos((prev) => prev.map((todo) => ({ ...todo, selected: selectAll })));
  }

  // ── 批量入库 ──
  async function handleAddToTodos() {
    if (submitting) return;
    const valid = todos.filter((todo) => todo.selected && todo.title.trim());
    if (valid.length === 0) {
      toast("error", t("noTodos"));
      return;
    }
    setSubmitting(true);
    let created = 0;
    let failed = 0;
    try {
      // 逐条创建任务（部分失败时继续，最后汇总提示）
      for (const todo of valid) {
        try {
          await api(`/api/v1/workspaces/${wid}/tasks`, {
            method: "POST",
            body: JSON.stringify({
              title: todo.title.trim(),
              description: todo.description?.trim() || undefined,
              priority: todo.priority,
              dueDate: todo.dueDate || undefined,
            }),
          });
          created++;
        } catch {
          failed++;
        }
      }
      if (failed === 0) {
        toast("success", t("added", { count: created }));
        onCreated?.();
        onClose();
      } else if (created > 0) {
        toast("warning", t("partialAdded", { created, failed }));
        onCreated?.();
        onClose();
      } else {
        toast("error", t("addFailed"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const selectedCount = todos.filter((todo) => todo.selected).length;
  const allSelected = todos.length > 0 && selectedCount === todos.length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-todo-extract-title"
      className="fixed inset-0 z-[var(--z-modal)] flex items-start justify-center p-4 sm:p-8 overflow-y-auto bg-[var(--overlay)]"
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        if (!submitting && !loading) onClose();
      }}
    >
      <div className="w-full max-w-2xl my-auto bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-lg)]">
        {/* ── 头部 ── */}
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-soft)]">
          <h2
            id="ai-todo-extract-title"
            className="flex items-center gap-2 text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]"
          >
            <ListTodo size={16} className="text-[var(--accent)]" />
            {t("title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting || loading}
            className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] disabled:opacity-50"
            aria-label={tButton("close")}
          >
            <X size={16} />
          </button>
        </header>

        {/* ── 正文 ── */}
        <div className="px-5 py-4 space-y-[var(--space-3)]">
          {/* 源类型选择 */}
          <div>
            <label className="block text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--muted)] mb-1.5">
              {t("sourceLabel")}
            </label>
            <div className="flex gap-2">
              {SOURCE_OPTS.map(({ value, labelKey, Icon }) => {
                const active = source === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setSource(value)}
                    disabled={loading || submitting}
                    className={`${sourceBtnBase} ${
                      active
                        ? "bg-[var(--accent)] text-[var(--accent-fg)] border border-transparent"
                        : "bg-[var(--surface-2)] text-[var(--fg-2)] border border-[var(--border)] hover:bg-[var(--surface-3)]"
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                    aria-pressed={active}
                  >
                    <Icon size={14} />
                    {t(labelKey)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 内容输入 */}
          <div>
            <label
              className="block text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)] mb-1.5"
              htmlFor="ai-todo-extract-content"
            >
              {t("contentLabel")}
            </label>
            <textarea
              id="ai-todo-extract-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={5}
              maxLength={10_000}
              placeholder={t("contentPlaceholder")}
              disabled={loading || submitting}
              aria-label={t("contentLabel")}
              className="w-full px-2.5 py-2 resize-y border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)] disabled:opacity-60"
            />
            <div className="mt-1 text-right text-[length:var(--text-xs)] text-[var(--meta)]">
              {content.length}/10000
            </div>
          </div>

          {/* 提取按钮 */}
          <button
            type="button"
            onClick={handleExtract}
            disabled={loading || submitting || !content.trim()}
            className="inline-flex items-center gap-1.5 h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
          >
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                {t("extracting")}
              </>
            ) : (
              <>
                <Plus size={14} />
                {t("extract")}
              </>
            )}
          </button>

          {/* 错误态 */}
          {error && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-sm)]">
              <span className="flex-1">{error}</span>
              <button
                type="button"
                onClick={() => setError("")}
                className="shrink-0 opacity-60 hover:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] rounded-[var(--radius-sm)]"
                aria-label={tButton("close")}
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* Loading 态（提取中）*/}
          {loading && (
            <div className="flex flex-col items-center justify-center py-8 gap-3">
              <Loader2
                size={28}
                className="animate-spin text-[var(--accent)]"
                aria-label={t("extracting")}
              />
              <p className="text-[length:var(--text-sm)] text-[var(--muted)]">
                {t("extracting")}
              </p>
            </div>
          )}

          {/* 提取结果 */}
          {!loading && hasExtracted && (
            <>
              {todos.length === 0 ? (
                <p className="text-[length:var(--text-sm)] text-[var(--muted)] py-6 text-center">
                  {t("noTodos")}
                </p>
              ) : (
                <>
                  {/* 全选 + 待办列表 */}
                  <div className="flex items-center justify-between">
                    <label className="inline-flex items-center gap-2 text-[length:var(--text-sm)] text-[var(--fg-2)] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={(e) => toggleSelectAll(e.target.checked)}
                        disabled={submitting}
                        className="w-4 h-4 rounded-[var(--radius-sm)] border-[var(--border)] text-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                      />
                      {allSelected ? t("deselectAll") : t("selectAll")}
                    </label>
                    <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
                      {selectedCount}/{todos.length}
                    </span>
                  </div>

                  <ul className="space-y-[var(--space-3)]">
                    {todos.map((todo, idx) => (
                      <li
                        key={todo.localId}
                        className={`rounded-[var(--radius-md)] border bg-[var(--surface)] p-[var(--space-3)] transition-colors duration-[var(--motion-fast)] ${
                          todo.selected
                            ? "border-[var(--accent)]"
                            : "border-[var(--border)]"
                        }`}
                      >
                        <div className="flex items-start gap-[var(--space-3)]">
                          {/* 勾选框 */}
                          <input
                            type="checkbox"
                            checked={todo.selected}
                            onChange={() => toggleSelect(todo.localId)}
                            disabled={submitting}
                            className="mt-1.5 w-4 h-4 shrink-0 rounded-[var(--radius-sm)] border-[var(--border)] text-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                            aria-label={t("selectTodo")}
                          />
                          <span className="shrink-0 mt-1.5 text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--muted)]">
                            {idx + 1}.
                          </span>
                          <div className="flex-1 min-w-0 space-y-2">
                            {/* 标题 */}
                            <input
                              type="text"
                              value={todo.title}
                              onChange={(e) =>
                                updateTodo(todo.localId, { title: e.target.value })
                              }
                              maxLength={255}
                              placeholder={t("todoTitle")}
                              aria-label={t("todoTitle")}
                              disabled={submitting}
                              className={`${fieldControl} font-[weight:var(--weight-medium)] disabled:opacity-60`}
                            />
                            {/* 负责人 + 截止日期 */}
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label
                                  className="block text-[length:var(--text-xs)] text-[var(--muted)] mb-1"
                                  htmlFor={`assignee-${todo.localId}`}
                                >
                                  {t("todoAssignee")}
                                </label>
                                <input
                                  id={`assignee-${todo.localId}`}
                                  type="text"
                                  value={todo.assignee ?? ""}
                                  onChange={(e) =>
                                    updateTodo(todo.localId, {
                                      assignee: e.target.value || null,
                                    })
                                  }
                                  maxLength={100}
                                  disabled={submitting}
                                  className={`${fieldControl} disabled:opacity-60`}
                                />
                              </div>
                              <div>
                                <label
                                  className="block text-[length:var(--text-xs)] text-[var(--muted)] mb-1"
                                  htmlFor={`due-${todo.localId}`}
                                >
                                  {t("todoDueDate")}
                                </label>
                                <input
                                  id={`due-${todo.localId}`}
                                  type="date"
                                  value={
                                    todo.dueDate
                                      ? todo.dueDate.slice(0, 10)
                                      : ""
                                  }
                                  onChange={(e) =>
                                    updateTodo(todo.localId, {
                                      dueDate: e.target.value || null,
                                    })
                                  }
                                  disabled={submitting}
                                  className={`${fieldControl} disabled:opacity-60`}
                                />
                              </div>
                            </div>
                            {/* 优先级 + 置信度 */}
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label
                                  className="block text-[length:var(--text-xs)] text-[var(--muted)] mb-1"
                                  htmlFor={`prio-${todo.localId}`}
                                >
                                  {t("todoPriority")}
                                </label>
                                <select
                                  id={`prio-${todo.localId}`}
                                  value={todo.priority}
                                  onChange={(e) =>
                                    updateTodo(todo.localId, {
                                      priority: e.target.value as Priority,
                                    })
                                  }
                                  disabled={submitting}
                                  className={`${fieldControl} disabled:opacity-60`}
                                >
                                  {PRIORITY_OPTS.map((o) => (
                                    <option key={o.value} value={o.value}>
                                      {t(o.labelKey)}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="block text-[length:var(--text-xs)] text-[var(--muted)] mb-1">
                                  {t("todoConfidence")}
                                </label>
                                <div className="h-9 px-2.5 flex items-center border border-[var(--border-soft)] rounded-[var(--radius-md)] bg-[var(--surface-2)] text-[length:var(--text-sm)]">
                                  <span
                                    className="inline-flex items-center gap-1.5"
                                    style={{ color: PRIORITY_COLOR[todo.priority] }}
                                  >
                                    <Check size={14} />
                                    {Math.round(todo.confidence * 100)}%
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>

                  {/* AI 推理过程（可折叠）*/}
                  {reasoning && (
                    <div className="rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--surface-2)]">
                      <button
                        type="button"
                        onClick={() => setReasoningOpen((v) => !v)}
                        className="w-full flex items-center gap-2 px-[var(--space-3)] py-2 text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] rounded-[var(--radius-md)]"
                        aria-expanded={reasoningOpen}
                      >
                        {reasoningOpen ? (
                          <ChevronDown size={14} />
                        ) : (
                          <ChevronRight size={14} />
                        )}
                        {t("reasoning")}
                      </button>
                      {reasoningOpen && (
                        <p className="px-[var(--space-3)] pb-2 text-[length:var(--text-sm)] text-[var(--muted)] whitespace-pre-wrap">
                          {reasoning}
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>

        {/* ── 底部操作栏 ── */}
        {!loading && hasExtracted && todos.length > 0 && (
          <footer className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-[var(--border-soft)]">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="h-9 px-4 rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] disabled:opacity-50"
            >
              {tButton("cancel")}
            </button>
            <button
              type="button"
              onClick={handleAddToTodos}
              disabled={submitting || selectedCount === 0}
              className="inline-flex items-center gap-1.5 h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              <Check size={14} />
              {t("addToTodos")}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}