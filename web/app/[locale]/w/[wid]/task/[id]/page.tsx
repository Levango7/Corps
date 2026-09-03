"use client";

import {
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  MessageSquare,
  FileText,
  Send,
  Calendar,
  Flag,
  Trash2,
  Loader2,
  Plus,
  X,
  History,
  AtSign,
  AlertTriangle,
} from "lucide-react";
import { api } from "@/lib/api";
import { toLocalDateString, localDateToISOString } from "@/lib/date";
import { relTime as sharedRelTime } from "@/lib/format";
import { STATUS_META } from "@/lib/task-meta";
import Markdown from "@/components/Markdown";
import ChatPanel from "@/components/ChatPanel";
import CalendarSyncBadge from "@/components/CalendarSyncBadge";
import { SubtaskSection } from "@/components/SubtaskSection";
import { useTranslations } from "next-intl";

type Status = "todo" | "in_progress" | "review" | "done";
type Priority = "low" | "medium" | "high" | "urgent";

interface Person {
  id: string;
  name: string | null;
  email: string;
  image?: string | null;
}

interface Task {
  id: string;
  title: string;
  description: string | null;
  status: Status;
  priority: Priority;
  dueDate: string | null;
  assignee: Person | null;
  creator: Person | null;
  createdAt: string;
  updatedAt: string;
  blocked: boolean;
  blockedReason: string | null;
  children: SubtaskItem[];
}

interface SubtaskItem {
  id: string;
  title: string;
  status: Status;
  priority: Priority;
  blocked: boolean;
  blockedReason: string | null;
  assigneeId: string | null;
  dueDate: string | null;
  createdAt: string;
}

interface Comment {
  id: string;
  body: string;
  createdAt: string;
  author: Person;
}

interface Decision {
  id: string;
  markdown: string;
  version: number;
  createdAt: string;
  author: Person;
}

interface DecisionVersion {
  id: string;
  decisionId: string;
  markdown: string;
  version: number;
  createdAt: string;
  author: Person;
}

const PRIORITY_META: Record<Priority, { labelKey: string; color: string }> = {
  low: { labelKey: "low", color: "var(--meta)" },
  medium: { labelKey: "medium", color: "var(--muted)" },
  high: { labelKey: "high", color: "var(--warn)" },
  urgent: { labelKey: "urgent", color: "var(--danger)" },
};

// relTime：走共享 lib/format.ts（tTime 注入渲染当前语言，见组件内适配）

export default function TaskDetailPage({
  params,
}: {
  params: Promise<{ wid: string; id: string }>;
}) {
  const { wid, id } = use(params);
  const router = useRouter();
  const t = useTranslations("task");
  const tButton = useTranslations("button");
  const tStatus = useTranslations("status");
  const tErr = useTranslations("error");
  const tPriority = useTranslations("priority");
  const tTime = useTranslations("time");
  const relTime = (iso: string) => sharedRelTime(iso, tTime);

  const [task, setTask] = useState<Task | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [members, setMembers] = useState<Person[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [decisionDraft, setDecisionDraft] = useState("");
  const [decisionOpen, setDecisionOpen] = useState(false);
  // 决策编辑/预览切换：edit=编辑 textarea，preview=渲染 markdown
  const [decisionMode, setDecisionMode] = useState<"edit" | "preview">("edit");

  const [titleDraft, setTitleDraft] = useState("");
  const [descDraft, setDescDraft] = useState("");
  const [dirty, setDirty] = useState(false);

  // ── 自定义确认弹窗（替代 window.confirm）──
  // 待执行操作以 ref 持有（函数引用不应放进 useState，避免 React 反模式）
  const [confirmOpen, setConfirmOpen] = useState(false);
  const confirmActionRef = useRef<() => void>(() => {});

  // ── 评论 @提及自动补全 ──
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionStart, setMentionStart] = useState(-1);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  // ── 视口尺寸（< sm 视为移动端，用于评论 placeholder 缩短）──
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // ── 标题 textarea 自动高度 ──
  useEffect(() => {
    const el = titleRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
    }
  }, [titleDraft]);

  // ── 评论 textarea 自动高度 ──
  useEffect(() => {
    const el = draftRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
    }
  }, [draft]);

  // ── 决策版本历史 ──
  const [historyFor, setHistoryFor] = useState<Decision | null>(null);
  const [versions, setVersions] = useState<DecisionVersion[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // ── 版本历史弹窗：Escape 关闭 ──
  useEffect(() => {
    if (!historyFor) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setHistoryFor(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [historyFor]);

  const base = `/api/v1/workspaces/${wid}`;

  // @提及候选列表（按 name/email 过滤）
  const mentionCandidates = useMemo(() => {
    if (!mentionOpen) return [];
    const q = mentionQuery.toLowerCase();
    return members.filter((m) => {
      const name = (m.name ?? "").toLowerCase();
      const email = m.email.toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [mentionOpen, mentionQuery, members]);

  const load = useCallback(async () => {
    try {
      const [t, c, d, m] = await Promise.all([
        api<Task>(`${base}/tasks/${id}`),
        api<Comment[]>(`${base}/tasks/${id}/comments`),
        api<Decision[]>(`${base}/tasks/${id}/decisions`),
        api<Person[]>(`${base}/members`),
      ]);
      setTask(t);
      setTitleDraft(t.title);
      setDescDraft(t.description ?? "");
      setComments(c);
      setDecisions(d);
      setMembers(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : tErr("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [base, id]);

  useEffect(() => {
    load();
  }, [load]);

  async function patch(data: Partial<Record<string, unknown>>) {
    if (!task) return;
    setTask({ ...task, ...(data as object) } as Task);
    try {
      const updated = await api<Task>(`${base}/tasks/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
      setTask((prev) => (prev ? { ...prev, ...updated } : updated));
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : tErr("saveFailed"));
      await load();
    }
  }

  async function addComment() {
    if (!draft.trim() || sending) return;
    setSending(true);
    try {
      // 解析 @username 提取 mentions 数组传给 API（用于通知记录）
      const mentions = Array.from(draft.matchAll(/@(\S+)/g)).map((m) => m[1]);
      const created = await api<Comment>(`${base}/tasks/${id}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: draft.trim(), mentions }),
      });
      setComments((prev) => [...prev, created]);
      setDraft("");
      setMentionOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : tErr("sendFailed"));
    } finally {
      setSending(false);
    }
  }

  // 评论输入：检测光标前的 @ 触发自动补全
  function handleDraftChange(e: ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setDraft(val);

    const el = e.target;
    const caret = el.selectionStart ?? val.length;
    const before = val.slice(0, caret);
    const atIdx = before.lastIndexOf("@");
    if (atIdx === -1) {
      setMentionOpen(false);
      return;
    }
    // @ 前必须是空格/行首（避免邮箱地址里的 @ 误触发）
    const charBefore = atIdx === 0 ? "" : before[atIdx - 1];
    if (charBefore && !/\s/.test(charBefore)) {
      setMentionOpen(false);
      return;
    }
    // @ 后到光标的文本作为查询词（遇空格即终止）
    const query = before.slice(atIdx + 1);
    if (/\s/.test(query)) {
      setMentionOpen(false);
      return;
    }
    setMentionQuery(query);
    setMentionStart(atIdx);
    setMentionIndex(0);
    setMentionOpen(true);
  }

  // 评论键盘：↑↓ 选择候选，Enter/Tab 确认，Esc 关闭，⌘/Ctrl+Enter 发送
  function handleDraftKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      addComment();
      return;
    }
    if (!mentionOpen || mentionCandidates.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setMentionIndex((i) => (i + 1) % mentionCandidates.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setMentionIndex((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      insertMention(mentionCandidates[mentionIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setMentionOpen(false);
    }
  }

  // 插入选中的提及：将 @query 替换为 @handle 并在后面补一个空格
  function insertMention(person: Person) {
    const handle = person.name || person.email.split("@")[0];
    const before = draft.slice(0, mentionStart);
    const after = draft.slice(mentionStart + 1 + mentionQuery.length);
    const newText = `${before}@${handle} ${after}`;
    setDraft(newText);
    setMentionOpen(false);
    // 恢复光标到 @handle 后的空格之后
    requestAnimationFrame(() => {
      const el = draftRef.current;
      if (el) {
        const pos = before.length + handle.length + 2; // '@' + handle + ' '
        el.focus();
        el.setSelectionRange(pos, pos);
      }
    });
  }

  async function addDecision() {
    if (!decisionDraft.trim()) return;
    try {
      const created = await api<Decision>(`${base}/tasks/${id}/decisions`, {
        method: "POST",
        body: JSON.stringify({ markdown: decisionDraft.trim() }),
      });
      setDecisions((prev) => [created, ...prev]);
      setDecisionDraft("");
      setDecisionOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : tErr("saveFailed"));
    }
  }

  // 打开某条决策的版本历史
  async function showHistory(d: Decision) {
    setHistoryFor(d);
    setHistoryLoading(true);
    try {
      const v = await api<DecisionVersion[]>(`${base}/tasks/${id}/decisions/${d.id}/versions`);
      setVersions(v);
    } catch {
      setVersions([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function actuallyRemoveTask() {
    if (!task) return;
    try {
      await api(`${base}/tasks/${id}`, { method: "DELETE" });
      router.push(`/w/${wid}/board`);
    } catch (e) {
      setError(e instanceof Error ? e.message : tErr("deleteFailed"));
    }
  }

  function removeTask() {
    if (!task) return;
    confirmActionRef.current = actuallyRemoveTask;
    setConfirmOpen(true);
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto">
        {/* 返回栏骨架 */}
        <div className="mb-[var(--space-5)] h-8 w-24 rounded-[var(--radius-md)] bg-[var(--surface-2)] animate-pulse" />
        {/* 标题 + 描述骨架 */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] p-[var(--space-5)]">
          <div className="h-8 w-3/4 rounded-[var(--radius-sm)] bg-[var(--surface-2)] animate-pulse" />
          <div className="mt-[var(--space-4)] space-y-2.5">
            <div className="h-4 w-full rounded-[var(--radius-sm)] bg-[var(--surface-2)] animate-pulse" />
            <div className="h-4 w-full rounded-[var(--radius-sm)] bg-[var(--surface-2)] animate-pulse" />
            <div className="h-4 w-full rounded-[var(--radius-sm)] bg-[var(--surface-2)] animate-pulse" />
          </div>
        </div>
        {/* 评论区骨架 */}
        <div className="mt-[var(--space-8)] space-y-[var(--space-4)]">
          <div className="h-12 w-full rounded-[var(--radius-md)] bg-[var(--surface-2)] animate-pulse" />
          <div className="h-12 w-full rounded-[var(--radius-md)] bg-[var(--surface-2)] animate-pulse" />
        </div>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="max-w-2xl mx-auto py-[var(--space-16)] text-center">
        <p className="text-[var(--fg-2)]">{error || t("notFound")}</p>
        <Link
          href={`/w/${wid}/board`}
          className="inline-flex items-center gap-1.5 mt-[var(--space-4)] text-[length:var(--text-sm)] text-[var(--accent)] hover:underline underline-offset-2"
        >
          <ArrowLeft size={14} />
          {t("backToBoard")}
        </Link>
      </div>
    );
  }

  const StatusIcon = STATUS_META[task.status].icon;
  const fieldLabel =
    "flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--meta)] mb-1.5";
  const fieldControl =
    "w-full h-8 px-[var(--space-2)] border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:border-[var(--accent)] transition-colors duration-[var(--motion-fast)]";

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-[var(--space-5)]">
        <Link
          href={`/w/${wid}/board`}
          className="inline-flex items-center gap-1.5 text-[length:var(--text-sm)] text-[var(--muted)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
        >
          <ArrowLeft size={16} />
          {t("boardLink")}
        </Link>
        <button
          onClick={removeTask}
          className="inline-flex items-center justify-center gap-1.5 min-w-[32px] px-2.5 h-8 rounded-[var(--radius-md)] text-[length:var(--text-sm)] text-[var(--muted)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] transition-colors duration-[var(--motion-fast)]"
        >
          <Trash2 size={15} />
          {tButton("delete")}
        </button>
      </div>

      {error && (
        <div className="mb-[var(--space-4)] px-[var(--space-4)] py-[var(--space-3)] rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-sm)]">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_var(--task-aside-w)] gap-[var(--space-6)] items-start">
        {/* ── 主列 ── */}
        <div className="min-w-0">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] p-[var(--space-5)]">
            <textarea
              ref={titleRef}
              value={titleDraft}
              onChange={(e) => {
                setTitleDraft(e.target.value);
                setDirty(true);
              }}
              onBlur={() => {
                if (dirty && titleDraft.trim() && titleDraft !== task.title) {
                  patch({ title: titleDraft.trim() });
                }
              }}
              rows={1}
              className="w-full overflow-hidden resize-none bg-transparent text-[length:var(--text-xl)] font-[var(--weight-semibold)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] rounded-[var(--radius-sm)] tracking-[-0.01em] leading-snug transition-shadow duration-[var(--motion-fast)]"
            />

            <textarea
              value={descDraft}
              onChange={(e) => {
                setDescDraft(e.target.value);
                setDirty(true);
              }}
              onBlur={() => {
                if (descDraft !== (task.description ?? "")) patch({ description: descDraft });
              }}
              rows={4}
              placeholder={t("detailDescriptionPlaceholder")}
              className="mt-[var(--space-3)] w-full resize-y bg-transparent text-[length:var(--text-base)] text-[var(--fg-2)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] rounded-[var(--radius-sm)] leading-[1.7] placeholder:text-[var(--meta)] transition-shadow duration-[var(--motion-fast)]"
            />

            <div className="mt-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--meta)]">
              {t("autosave")}
            </div>
          </div>

          {/* 子任务（v0.4.0 队列第 1 项） */}
          <SubtaskSection wid={wid} taskId={id} subtasks={task.children ?? []} onChanged={load} />

          {/* 决策记录 */}
          <section id="decisions" className="mt-[var(--space-6)] scroll-mt-[var(--topbar-h)]">
            <div className="flex items-center justify-between mb-[var(--space-3)]">
              <h2 className="flex items-center gap-[var(--space-2)] text-[length:var(--text-md)] font-[var(--weight-semibold)] text-[var(--fg)]">
                <FileText size={16} className="text-[var(--muted)]" />
                {t("decisionsTitle")}
                {decisions.length > 0 && (
                  <span className="text-[length:var(--text-sm)] font-[var(--weight-regular)] text-[var(--meta)]">
                    {decisions.length}
                  </span>
                )}
              </h2>
              <button
                onClick={() => setDecisionOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-[var(--radius-md)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] active:bg-[var(--surface-3)] transition-colors duration-[var(--motion-fast)]"
              >
                {decisionOpen ? <X size={15} /> : <Plus size={15} />}
                {decisionOpen ? tButton("cancel") : t("addDecision")}
              </button>
            </div>

            {decisionOpen && (
              <div className="mb-[var(--space-4)] bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] p-[var(--space-4)]">
                {/* 编辑/预览切换 tab */}
                <div className="inline-flex items-center gap-[var(--space-1)] mb-[var(--space-3)] p-[var(--space-1)] rounded-[var(--radius-md)] bg-[var(--surface-2)]">
                  <button
                    type="button"
                    onClick={() => setDecisionMode("edit")}
                    aria-pressed={decisionMode === "edit"}
                    className={`px-[var(--space-3)] h-7 rounded-[var(--radius-sm)] text-[length:var(--text-sm)] transition-colors duration-[var(--motion-fast)] ${
                      decisionMode === "edit"
                        ? "bg-[var(--surface)] text-[var(--fg)] shadow-[var(--elev-sm)]"
                        : "text-[var(--muted)] hover:text-[var(--fg-2)]"
                    }`}
                  >
                    {t("editTab")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDecisionMode("preview")}
                    aria-pressed={decisionMode === "preview"}
                    className={`px-[var(--space-3)] h-7 rounded-[var(--radius-sm)] text-[length:var(--text-sm)] transition-colors duration-[var(--motion-fast)] ${
                      decisionMode === "preview"
                        ? "bg-[var(--surface)] text-[var(--fg)] shadow-[var(--elev-sm)]"
                        : "text-[var(--muted)] hover:text-[var(--fg-2)]"
                    }`}
                  >
                    {t("previewTab")}
                  </button>
                </div>

                {decisionMode === "edit" ? (
                  <textarea
                    value={decisionDraft}
                    onChange={(e) => setDecisionDraft(e.target.value)}
                    rows={6}
                    placeholder={t("decisionTemplate")}
                    className="w-full resize-y bg-transparent font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] text-[var(--fg-2)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:border-[var(--accent)] border border-transparent rounded-[var(--radius-sm)] leading-[1.7] placeholder:text-[var(--meta)] transition-shadow duration-[var(--motion-fast)]"
                  />
                ) : (
                  <div className="min-h-[120px] px-[var(--space-3)] py-[var(--space-2)] border border-[var(--border-soft)] rounded-[var(--radius-sm)] bg-[var(--surface-2)] text-[length:var(--text-sm)] text-[var(--fg-2)] leading-[1.7] overflow-y-auto">
                    {decisionDraft.trim() ? (
                      <Markdown source={decisionDraft} />
                    ) : (
                      <span className="text-[var(--meta)]">{t("noPreviewContent")}</span>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between mt-[var(--space-3)] pt-[var(--space-3)] border-t border-[var(--border-soft)]">
                  <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
                    {t("decisionHint")}
                  </span>
                  <button
                    onClick={addDecision}
                    disabled={!decisionDraft.trim()}
                    className="h-8 px-[var(--space-3)] bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)]"
                  >
                    {t("saveAsVersion", { version: (decisions[0]?.version ?? 0) + 1 })}
                  </button>
                </div>
              </div>
            )}

            {decisions.length === 0 && !decisionOpen ? (
              <div className="px-[var(--space-4)] py-[var(--space-8)] rounded-[var(--radius-lg)] border border-dashed border-[var(--border)] text-center">
                <p className="text-[length:var(--text-sm)] text-[var(--muted)]">
                  {t("decisionsEmpty")}
                </p>
              </div>
            ) : (
              <div className="space-y-[var(--space-3)]">
                {decisions.map((d) => (
                  <article
                    key={d.id}
                    className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] hover:shadow-[var(--elev-hover)] transition-shadow duration-[var(--motion-fast)] overflow-hidden"
                  >
                    <header className="flex items-center gap-[var(--space-2)] px-[var(--space-4)] py-2.5 bg-[var(--surface-2)] border-b border-[var(--border-soft)]">
                      <span className="px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--surface)] border border-[var(--border)] text-[length:var(--text-xs)] font-[family-name:var(--font-mono)] text-[var(--fg-2)]">
                        v{d.version}
                      </span>
                      <span className="text-[length:var(--text-xs)] text-[var(--muted)]">
                        {d.author ? d.author.name || d.author.email : t("deletedUser")} ·{" "}
                        {relTime(d.createdAt)}
                      </span>
                      <button
                        onClick={() => showHistory(d)}
                        aria-label={t("versionHistory")}
                        className="ml-auto inline-flex items-center justify-center w-8 h-8 rounded-[var(--radius-sm)] text-[var(--meta)] hover:bg-[var(--surface)] hover:text-[var(--fg-2)] active:bg-[var(--surface-3)] transition-colors duration-[var(--motion-fast)]"
                      >
                        <History size={14} />
                      </button>
                    </header>
                    <div className="px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--text-base)]">
                      <Markdown source={d.markdown} />
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* 聊天（v2 F1：IM 轻沟通 MVP）*/}
          <ChatPanel wid={wid} taskId={id} />

          {/* 评论 */}
          <section className="mt-[var(--space-8)]">
            <h2 className="flex items-center gap-[var(--space-2)] mb-[var(--space-3)] text-[length:var(--text-md)] font-[var(--weight-semibold)] text-[var(--fg)]">
              <MessageSquare size={16} className="text-[var(--muted)]" />
              {t("discussionTitle")}
              {comments.length > 0 && (
                <span className="text-[length:var(--text-sm)] font-[var(--weight-regular)] text-[var(--meta)]">
                  {comments.length}
                </span>
              )}
            </h2>

            <div className="divide-y divide-[var(--border-soft)]">
              {comments.map((c) => (
                <div
                  key={c.id}
                  className="flex gap-[var(--space-3)] px-[var(--space-2)] py-1.5 rounded-[var(--radius-md)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
                >
                  <div className="w-7 h-7 sm:w-8 sm:h-8 shrink-0 rounded-full bg-[var(--surface-3)] text-[var(--fg-2)] flex items-center justify-center text-[length:var(--text-xs)] font-[var(--weight-medium)]">
                    {(c.author
                      ? c.author.name || c.author.email
                      : t("deletedUser"))[0]?.toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-[var(--space-2)]">
                      <span className="text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--fg)]">
                        {c.author
                          ? c.author.name || c.author.email.split("@")[0]
                          : t("deletedUser")}
                      </span>
                      <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
                        {relTime(c.createdAt)}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[length:var(--text-base)] text-[var(--fg-2)] leading-[1.7] whitespace-pre-wrap break-words">
                      {c.body}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-[var(--space-4)] flex items-start gap-[var(--space-2)]">
              <div className="relative flex-1">
                <textarea
                  ref={draftRef}
                  value={draft}
                  onChange={handleDraftChange}
                  onKeyDown={handleDraftKeyDown}
                  onBlur={() => {
                    // 延迟关闭，让浮层 mousedown 有机会触发
                    setTimeout(() => setMentionOpen(false), 150);
                  }}
                  rows={2}
                  placeholder={isMobile ? t("commentPlaceholderMobile") : t("commentPlaceholder")}
                  className="w-full px-[var(--space-3)] py-[var(--space-2)] overflow-hidden resize-none border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-base)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:border-[var(--accent)] placeholder:text-[var(--meta)] transition-colors duration-[var(--motion-fast)]"
                />
                {mentionOpen && mentionCandidates.length > 0 && (
                  <div className="absolute top-full left-0 mt-[var(--space-1)] z-[var(--z-dropdown)] bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-md)] shadow-[var(--elev-md)] py-[var(--space-1)] min-w-[200px] max-h-60 overflow-y-auto">
                    {mentionCandidates.map((m, i) => (
                      <button
                        key={m.id}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          insertMention(m);
                        }}
                        className={`h-9 px-[var(--space-3)] w-full flex items-center gap-[var(--space-2)] text-left ${i === mentionIndex ? "bg-[var(--surface-2)]" : ""}`}
                      >
                        <AtSign size={14} className="text-[var(--meta)] shrink-0" />
                        <span className="truncate text-[length:var(--text-sm)] text-[var(--fg)]">
                          {m.name || m.email}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={addComment}
                disabled={!draft.trim() || sending}
                className="h-9 px-[var(--space-3)] shrink-0 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] font-[var(--weight-medium)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] flex items-center gap-1.5"
              >
                {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                {t("send")}
              </button>
            </div>
          </section>
        </div>

        {/* ── 属性栏 ──
            < lg：单栏，置顶，字段水平排列（标签在上、选择器在下）
            ≥ lg：右侧 260px 栏，垂直表单，sticky */}
        <aside className="order-first lg:order-last lg:sticky lg:top-[var(--space-4)] bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] p-[var(--space-3)] lg:p-[var(--space-4)] grid grid-cols-2 md:flex md:flex-wrap gap-x-[var(--space-5)] gap-y-[var(--space-3)] lg:block lg:space-y-[var(--space-4)] lg:gap-0">
          <div className="min-w-[130px] flex-1 lg:flex-none lg:w-full">
            <div className={fieldLabel}>
              <StatusIcon size={13} style={{ color: STATUS_META[task.status].color }} />
              {t("fieldStatus")}
            </div>
            <select
              value={task.status}
              onChange={(e) => patch({ status: e.target.value as Status })}
              className={fieldControl}
            >
              {(Object.keys(STATUS_META) as Status[]).map((s) => (
                <option key={s} value={s}>
                  {tStatus(STATUS_META[s].labelKey)}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-[130px] flex-1 lg:flex-none lg:w-full">
            <div className={fieldLabel}>
              <Flag size={13} style={{ color: PRIORITY_META[task.priority].color }} />
              {t("fieldPriority")}
            </div>
            <select
              value={task.priority}
              onChange={(e) => patch({ priority: e.target.value as Priority })}
              className={fieldControl}
            >
              {(Object.keys(PRIORITY_META) as Priority[]).map((p) => (
                <option key={p} value={p}>
                  {tPriority(PRIORITY_META[p].labelKey)}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-[130px] flex-1 lg:flex-none lg:w-full">
            <div className={fieldLabel}>{t("assignee")}</div>
            <select
              value={task.assignee?.id ?? ""}
              onChange={(e) => patch({ assigneeId: e.target.value || null })}
              className={fieldControl}
            >
              <option value="">{t("unassigned")}</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name || m.email}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-[130px] flex-1 lg:flex-none lg:w-full">
            <div className={fieldLabel}>
              <Calendar size={13} />
              {t("fieldDueDate")}
              {task.dueDate && <CalendarSyncBadge wid={wid} taskId={id} />}
            </div>
            <input
              type="date"
              value={task.dueDate ? toLocalDateString(new Date(task.dueDate)) : ""}
              onChange={(e) =>
                patch({
                  dueDate: e.target.value ? localDateToISOString(e.target.value) : null,
                })
              }
              className={fieldControl}
            />
          </div>

          {/* 阻塞标记（v0.4.0：问题/依赖卡住时标记，附原因） */}
          <div className="col-span-2 md:col-span-auto w-full">
            <div className={fieldLabel}>
              <AlertTriangle size={13} />
              {t("blockedLabel")}
            </div>
            {task.blocked ? (
              <div className="space-y-1.5">
                <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-[var(--radius-sm)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-xs)]">
                  <AlertTriangle size={12} />
                  {t("blockedBadge")}
                </div>
                <input
                  type="text"
                  defaultValue={task.blockedReason ?? ""}
                  placeholder={t("blockedReasonPlaceholder")}
                  maxLength={500}
                  onBlur={(e) => {
                    const reason = e.target.value.trim() || null;
                    if (reason !== (task.blockedReason ?? null)) {
                      patch({ blockedReason: reason });
                    }
                  }}
                  className={fieldControl}
                />
                <button
                  onClick={() => patch({ blocked: false, blockedReason: null })}
                  className="text-[length:var(--text-xs)] text-[var(--muted)] hover:text-[var(--fg)] hover:underline underline-offset-2"
                >
                  {t("blockedClear")}
                </button>
              </div>
            ) : (
              <button
                onClick={() => patch({ blocked: true })}
                className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-[var(--radius-md)] border border-[var(--border)] text-[length:var(--text-xs)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
              >
                <AlertTriangle size={13} />
                {t("blockedMark")}
              </button>
            )}
          </div>

          <div className="col-span-2 md:col-span-auto w-full basis-full lg:basis-auto pt-[var(--space-3)] border-t border-[var(--border-soft)] space-y-1.5 text-[length:var(--text-xs)] text-[var(--meta)]">
            <div>{t("creator", { name: task.creator?.name || task.creator?.email || "—" })}</div>
            <div>{t("createdAt", { date: new Date(task.createdAt).toLocaleString() })}</div>
            <div>
              {t("updatedAt")} {relTime(task.updatedAt)}
            </div>
          </div>
        </aside>
      </div>

      {/* ── 决策版本历史弹窗 ──
          < sm：全屏弹窗（底部贴边、无圆角、100dvh）
          ≥ sm：居中弹窗（max-w-lg、80dvh、圆角） */}
      {historyFor && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("versionHistory")}
          className="fixed inset-0 z-[var(--z-modal)] flex items-end sm:items-center justify-center bg-[var(--overlay)]"
          onClick={() => setHistoryFor(null)}
        >
          <div
            className="w-full sm:max-w-lg max-h-[100dvh] sm:max-h-[80dvh] overflow-y-auto bg-[var(--surface)] sm:rounded-[var(--radius-lg)] sm:border sm:border-[var(--border)] shadow-[var(--elev-lg)]"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between px-[var(--space-4)] py-[var(--space-3)] border-b border-[var(--border-soft)] sticky top-0 bg-[var(--surface)]">
              <h3 className="flex items-center gap-[var(--space-2)] text-[length:var(--text-md)] font-[var(--weight-semibold)] text-[var(--fg)]">
                <History size={16} className="text-[var(--muted)]" />
                {t("versionHistoryTitle", { version: historyFor.version })}
              </h3>
              <button
                onClick={() => setHistoryFor(null)}
                aria-label={tButton("close")}
                className="inline-flex items-center justify-center w-8 h-8 rounded-[var(--radius-sm)] text-[var(--meta)] hover:bg-[var(--surface-2)] active:bg-[var(--surface-3)] transition-colors duration-[var(--motion-fast)]"
              >
                <X size={15} />
              </button>
            </header>
            <div className="p-[var(--space-4)] space-y-[var(--space-4)]">
              {historyLoading ? (
                <div className="space-y-[var(--space-3)]">
                  <div className="h-20 w-full rounded-[var(--radius-md)] bg-[var(--surface-2)] animate-pulse" />
                  <div className="h-20 w-full rounded-[var(--radius-md)] bg-[var(--surface-2)] animate-pulse" />
                </div>
              ) : versions.length === 0 ? (
                <p className="text-[length:var(--text-sm)] text-[var(--muted)]">{t("noHistory")}</p>
              ) : (
                versions.map((v) => (
                  <article
                    key={v.id}
                    className="border border-[var(--border)] rounded-[var(--radius-md)] overflow-hidden hover:shadow-[var(--elev-hover)] transition-shadow duration-[var(--motion-fast)]"
                  >
                    <header className="flex items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] bg-[var(--surface-2)] border-b border-[var(--border-soft)]">
                      <span className="px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--surface)] border border-[var(--border)] text-[length:var(--text-xs)] font-[family-name:var(--font-mono)] text-[var(--fg-2)]">
                        v{v.version}
                      </span>
                      <span className="text-[length:var(--text-xs)] text-[var(--muted)]">
                        {v.author ? v.author.name || v.author.email : t("deletedUser")} ·{" "}
                        {relTime(v.createdAt)}
                      </span>
                    </header>
                    <div className="px-[var(--space-3)] py-2.5 text-[length:var(--text-sm)]">
                      <Markdown source={v.markdown} />
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 自定义确认弹窗（替代 window.confirm）── */}
      {confirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("confirmAria")}
          className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-[var(--overlay)] p-[var(--space-4)]"
          onClick={() => setConfirmOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-[var(--radius-lg)] bg-[var(--surface)] border border-[var(--border)] shadow-[var(--elev-lg)] p-[var(--space-5)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[length:var(--text-md)] font-[var(--weight-semibold)] text-[var(--fg)] mb-[var(--space-2)]">
              {t("confirmDeleteTitle")}
            </h3>
            <p className="text-[length:var(--text-sm)] text-[var(--fg-2)] leading-[1.6] mb-[var(--space-5)]">
              {t("confirmDeleteTask", { title: task.title })}
            </p>
            <div className="flex items-center justify-end gap-[var(--space-2)]">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="h-8 px-[var(--space-3)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] active:bg-[var(--surface-3)] transition-colors duration-[var(--motion-fast)]"
              >
                {tButton("cancel")}
              </button>
              <button
                type="button"
                onClick={() => {
                  confirmActionRef.current();
                  setConfirmOpen(false);
                }}
                className="h-8 px-[var(--space-3)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] bg-[var(--danger)] text-[var(--danger-fg)] hover:opacity-90 active:opacity-80 transition-opacity duration-[var(--motion-fast)]"
              >
                {t("confirmDelete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
