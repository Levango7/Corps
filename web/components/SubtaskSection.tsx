"use client";

/**
 * 子任务区组件 —— 任务详情页。
 *
 * 功能：
 *  - 列表展示父任务的全部子任务（复选框切换完成态）
 *  - 进度条（done/total）
 *  - 内联添加子任务（标题 + 回车提交）
 *  - 阻塞标记徽标（blocked 时红色角标 + 原因 tooltip）
 *
 * 数据来源：GET /v1/workspaces/{wid}/tasks/{id} 返回的 children 数组；
 * 变更后由父组件调用 onChanged() 重新拉取详情。
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/lib/i18n-navigation";
import { Plus, AlertTriangle, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import type { Subtask } from "@/lib/types";

interface SubtaskSectionProps {
  wid: string;
  taskId: string;
  subtasks: Subtask[];
  /** 变更（添加/勾选/删除）后回调，父组件重新拉详情 */
  onChanged: () => void;
}

export function SubtaskSection({ wid, taskId, subtasks, onChanged }: SubtaskSectionProps) {
  const t = useTranslations("task");
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const done = subtasks.filter((s) => s.status === "done").length;
  const total = subtasks.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  async function addSubtask() {
    const title = draft.trim();
    if (!title || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/v1/workspaces/${wid}/tasks`, {
        method: "POST",
        body: JSON.stringify({ title, parentId: taskId }),
      });
      setDraft("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("subtaskAddFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function toggleSubtask(st: Subtask) {
    const next = st.status === "done" ? "todo" : "done";
    try {
      await api(`/api/v1/workspaces/${wid}/tasks/${st.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      onChanged();
    } catch {
      /* 失败静默——父组件下次刷新会反映真实状态 */
    }
  }

  return (
    <section className="mt-[var(--space-6)]" aria-label={t("subtaskTitle")}>
      <div className="flex items-center justify-between mb-[var(--space-3)]">
        <h2 className="flex items-center gap-[var(--space-2)] text-[length:var(--text-md)] font-[var(--weight-semibold)] text-[var(--fg)]">
          {t("subtaskTitle")}
          {total > 0 && (
            <span className="text-[length:var(--text-sm)] font-[var(--weight-regular)] text-[var(--meta)]">
              {done}/{total}
            </span>
          )}
        </h2>
      </div>

      {/* 进度条 */}
      {total > 0 && (
        <div className="mb-[var(--space-3)] h-1.5 rounded-full bg-[var(--surface-3)] overflow-hidden">
          <div
            className="h-full rounded-full transition-[width] duration-[var(--motion-slow)]"
            style={{
              width: `${pct}%`,
              background: pct === 100 ? "var(--success)" : "var(--accent)",
            }}
          />
        </div>
      )}

      {/* 子任务列表 */}
      {total > 0 && (
        <ul className="mb-[var(--space-3)] divide-y divide-[var(--border-soft)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
          {subtasks.map((st) => {
            const isDone = st.status === "done";
            return (
              <li
                key={st.id}
                className="flex items-center gap-[var(--space-3)] px-[var(--space-3)] py-2"
              >
                <input
                  type="checkbox"
                  checked={isDone}
                  onChange={() => toggleSubtask(st)}
                  className="shrink-0 accent-[var(--accent)]"
                  aria-label={t("subtaskToggle", { title: st.title })}
                />
                <button
                  onClick={() => router.push(`/w/${wid}/task/${st.id}`)}
                  className={`flex-1 min-w-0 text-left text-[length:var(--text-sm)] truncate hover:text-[var(--accent)] transition-colors ${
                    isDone ? "text-[var(--meta)] line-through" : "text-[var(--fg)]"
                  }`}
                >
                  {st.title}
                </button>
                {st.blocked && (
                  <span
                    className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-xs)]"
                    title={st.blockedReason ?? undefined}
                  >
                    <AlertTriangle size={11} />
                    {t("blockedBadge")}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* 添加子任务 */}
      <div className="flex items-center gap-[var(--space-2)]">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addSubtask()}
          placeholder={t("subtaskPlaceholder")}
          maxLength={255}
          className="flex-1 h-9 px-[var(--space-3)] border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)]"
        />
        <button
          onClick={addSubtask}
          disabled={!draft.trim() || busy}
          className="inline-flex items-center gap-1.5 h-9 px-[var(--space-3)] bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          {t("subtaskAdd")}
        </button>
      </div>
      {error && (
        <p className="mt-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--danger)]">
          {error}
        </p>
      )}
    </section>
  );
}
