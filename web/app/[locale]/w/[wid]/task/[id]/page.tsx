"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { Link, useRouter } from "@/lib/i18n-navigation";
import { ArrowLeft, Trash2, Loader2, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { relTime as sharedRelTime } from "@/lib/format";
import { isFavorite, toggleFavorite } from "@/lib/favorites";
import ChatPanel from "@/components/ChatPanel";
import { SubtaskSection } from "@/components/SubtaskSection";
import TaskBreakdownDialog from "@/components/ai/TaskBreakdownDialog";
import { useTranslations } from "next-intl";
import { TaskDetailHeader } from "@/components/task/TaskDetailHeader";
import { TaskDecisions } from "@/components/task/TaskDecisions";
import { TaskComments } from "@/components/task/TaskComments";
import { TaskPropertyAside } from "@/components/task/TaskPropertyAside";
import { ConfirmDialog } from "@/components/task/ConfirmDialog";
import type { Task, Comment, Decision, Person, TaskPatch } from "@/components/task/types";

export default function TaskDetailPage({
  params,
}: {
  params: Promise<{ wid: string; id: string }>;
}) {
  const { wid, id } = use(params);
  const router = useRouter();
  const t = useTranslations("task");
  const tButton = useTranslations("button");
  const tErr = useTranslations("error");
  const tTime = useTranslations("time");
  const relTime = (iso: string) => sharedRelTime(iso, tTime);

  const [task, setTask] = useState<Task | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  // F1 决策驱动执行：保存决策后 +1，触发 ActionItemPanel 重新拉取行动项
  const [decisionRefreshSignal, setDecisionRefreshSignal] = useState(0);
  const [members, setMembers] = useState<Person[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  // LI-6：字段保存中指示（标题/描述/属性 onBlur 触发 patch 时显示）
  const [saving, setSaving] = useState(false);
  // LI-8：删除任务进行中（按钮 loading + 禁用）
  const [deleting, setDeleting] = useState(false);

  const [titleDraft, setTitleDraft] = useState("");
  const [descDraft, setDescDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  // 星标（本地 localStorage，便携收藏） — 初次挂载 + task 加载完成后同步
  const [starred, setStarred] = useState(false);
  useEffect(() => {
    if (task) setStarred(isFavorite(task.id));
  }, [task]);

  // AI 拆解弹窗开关 + AI 服务是否已配置（挂载时探测一次，未配置时按钮置灰）
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false);
  useEffect(() => {
    api<{ configured: boolean }>("/api/v1/ai/configured")
      .then((data) => setAiConfigured(data?.configured ?? false))
      .catch(() => setAiConfigured(false));
  }, []);

  function onToggleFavorite() {
    if (!task) return;
    const now = toggleFavorite({
      taskId: task.id,
      workspaceId: wid,
      title: task.title,
    });
    setStarred(now);
  }

  // ── 自定义确认弹窗（替代 window.confirm）──
  // 待执行操作以 ref 持有（函数引用不应放进 useState，避免 React 反模式）
  const [confirmOpen, setConfirmOpen] = useState(false);
  const confirmActionRef = useRef<() => void>(() => {});

  const base = `/api/v1/workspaces/${wid}`;

  const load = useCallback(async () => {
    try {
      const [taskData, c, d, m] = await Promise.all([
        api<Task>(`${base}/tasks/${id}`),
        api<Comment[]>(`${base}/tasks/${id}/comments`),
        api<{ items: Decision[]; total: number; hasMore: boolean }>(`${base}/tasks/${id}/decisions`),
        api<{ items: Person[]; total: number; hasMore: boolean }>(`${base}/members`),
      ]);
      setTask(taskData);
      setTitleDraft(taskData.title);
      setDescDraft(taskData.description ?? "");
      setComments(c);
      setDecisions(d.items);
      setMembers(m.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : tErr("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [base, id, tErr]);

  useEffect(() => {
    load();
  }, [load]);

  async function patch(data: TaskPatch) {
    if (!task) return;
    setTask({ ...task, ...data });
    setSaving(true);
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
    } finally {
      setSaving(false);
    }
  }

  // 评论发送回调（供 TaskComments 子组件调用）：返回是否成功
  async function handleSendComment(body: string, mentions: string[]): Promise<boolean> {
    try {
      const created = await api<Comment>(`${base}/tasks/${id}/comments`, {
        method: "POST",
        body: JSON.stringify({ body, mentions }),
      });
      setComments((prev) => [...prev, created]);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : tErr("sendFailed"));
      return false;
    }
  }

  async function actuallyRemoveTask() {
    if (!task || deleting) return;
    setDeleting(true);
    try {
      await api(`${base}/tasks/${id}`, { method: "DELETE" });
      router.push(`/w/${wid}/board`);
    } catch (e) {
      setError(e instanceof Error ? e.message : tErr("deleteFailed"));
      setDeleting(false);
    }
  }

  function removeTask() {
    if (!task) return;
    confirmActionRef.current = actuallyRemoveTask;
    setConfirmOpen(true);
  }

  if (loading) {
    return (
      <div className="max-w-[var(--container-max)] mx-auto">
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

  return (
    <div className="max-w-[var(--container-max)] mx-auto">
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
          disabled={deleting}
          className="inline-flex items-center justify-center gap-1.5 min-w-[44px] sm:min-w-[32px] px-2.5 min-h-[44px] sm:h-8 rounded-[var(--radius-md)] text-[length:var(--text-sm)] text-[var(--muted)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
        >
          {deleting ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Trash2 size={15} />
          )}
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
          <TaskDetailHeader
            task={task}
            titleDraft={titleDraft}
            setTitleDraft={setTitleDraft}
            descDraft={descDraft}
            setDescDraft={setDescDraft}
            dirty={dirty}
            setDirty={setDirty}
            onPatch={patch}
            saving={saving}
            starred={starred}
            onToggleFavorite={onToggleFavorite}
            titleRef={titleRef}
          />

          {/* 子任务（v0.4.0 队列第 1 项） */}
          <SubtaskSection wid={wid} taskId={id} subtasks={task.children ?? []} onChanged={load} />

          {/* AI 拆分子任务按钮（P3）—— 位于子任务区下方，点击打开 TaskBreakdownDialog */}
          <div className="mt-[var(--space-3)]">
            <button
              type="button"
              onClick={() => setBreakdownOpen(true)}
              disabled={!aiConfigured}
              title={!aiConfigured ? t("aiBreakdownDisabled") : undefined}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
            >
              <Sparkles size={14} className="text-[var(--accent)]" />
              {t("aiBreakdown")}
            </button>
          </div>

          {/* 决策记录 */}
          <TaskDecisions
            task={task}
            decisions={decisions}
            wid={wid}
            id={id}
            base={base}
            decisionRefreshSignal={decisionRefreshSignal}
            onDecisionsChange={setDecisions}
            onDecisionRefresh={() => setDecisionRefreshSignal((s) => s + 1)}
            onError={setError}
            relTime={relTime}
          />

          {/* 聊天（v2 F1：IM 转沟通 MVP）*/}
          <ChatPanel wid={wid} taskId={id} />

          {/* 评论 */}
          <TaskComments
            comments={comments}
            members={members}
            onSend={handleSendComment}
            relTime={relTime}
          />
        </div>

        {/* ── 属性栏 ──
            < lg：单栏，置顶，字段水平排列（标签在上、选择器在下）
            ≥ lg：右侧 260px 栏，垂直表单，sticky */}
        <TaskPropertyAside
          task={task}
          members={members}
          onPatch={patch}
          wid={wid}
          id={id}
          relTime={relTime}
        />
      </div>

      {/* ── 自定义确认弹窗（替代 window.confirm）── */}
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => confirmActionRef.current()}
        deleting={deleting}
        taskTitle={task.title}
      />

      {/* ── AI 任务拆解弹窗（P3）── */}
      {breakdownOpen && (
        <TaskBreakdownDialog
          wid={wid}
          taskId={id}
          taskTitle={task.title}
          onClose={() => setBreakdownOpen(false)}
          onCreated={load}
        />
      )}
    </div>
  );
}
