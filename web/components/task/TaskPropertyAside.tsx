"use client";

// 任务属性栏：状态 / 优先级 / 指派人 / 截止日期 / 阻塞标记 / 公开分享 / 创建信息。
// 拆分自 task/[id]/page.tsx 第 929-1101 行。
// < lg：单栏，置顶，字段水平排列；≥ lg：右侧 260px 栏，垂直表单，sticky。

import { useEffect, useState } from "react";
import { Calendar, Flag, AlertTriangle, Share2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toLocalDateString, localDateToISOString } from "@/lib/date";
import { STATUS_META } from "@/lib/task-meta";
import CalendarSyncBadge from "@/components/CalendarSyncBadge";
import { useToast } from "@/components/Toast";
import { PRIORITY_META, type Person, type Status, type Priority, type Task, type TaskPatch } from "./types";

interface TaskPropertyAsideProps {
  task: Task;
  members: Person[];
  onPatch: (data: TaskPatch) => void;
  wid: string;
  id: string;
  relTime: (iso: string) => string;
}

export function TaskPropertyAside({
  task,
  members,
  onPatch,
  wid,
  id,
  relTime,
}: TaskPropertyAsideProps) {
  const t = useTranslations("task");
  const tStatus = useTranslations("status");
  const tPriority = useTranslations("priority");
  const tErr = useTranslations("error");
  const { toast } = useToast();

  // 任务公开分享 URL（本地推导，shareToken 由 GET 详情返回）
  const [taskShareUrl, setTaskShareUrl] = useState<string | null>(null);
  useEffect(() => {
    setTaskShareUrl(
      task?.shareToken ? `${window.location.origin}/tasks/share/${task.shareToken}` : null,
    );
  }, [task?.shareToken]);

  // 分享链接复制成功反馈
  const [shareCopied, setShareCopied] = useState(false);

  const StatusIcon = STATUS_META[task.status].icon;
  const fieldLabel =
    "flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--meta)] mb-1.5";
  const fieldControl =
    "w-full h-8 px-[var(--space-2)] border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:border-[var(--accent)] transition-colors duration-[var(--motion-fast)]";

  return (
    <aside className="order-first lg:order-last lg:sticky lg:top-[var(--space-4)] bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] p-[var(--space-3)] lg:p-[var(--space-4)] grid grid-cols-2 md:flex md:flex-wrap gap-x-[var(--space-3)] md:gap-x-[var(--space-5)] gap-y-[var(--space-3)] lg:block lg:space-y-[var(--space-4)] lg:gap-0">
      <div className="min-w-[130px] flex-1 lg:flex-none lg:w-full">
        <div className={fieldLabel}>
          <StatusIcon size={13} style={{ color: STATUS_META[task.status].color }} />
          {t("fieldStatus")}
        </div>
        <select
          value={task.status}
          onChange={(e) => onPatch({ status: e.target.value as Status })}
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
          onChange={(e) => onPatch({ priority: e.target.value as Priority })}
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
          onChange={(e) => onPatch({ assigneeId: e.target.value || null })}
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
            onPatch({
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
                  onPatch({ blockedReason: reason });
                }
              }}
              className={fieldControl}
            />
            <button
              onClick={() => onPatch({ blocked: false, blockedReason: null })}
              className="text-[length:var(--text-xs)] text-[var(--muted)] hover:text-[var(--fg)] hover:underline underline-offset-2"
            >
              {t("blockedClear")}
            </button>
          </div>
        ) : (
          <button
            onClick={() => onPatch({ blocked: true })}
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-[var(--radius-md)] border border-[var(--border)] text-[length:var(--text-xs)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
          >
            <AlertTriangle size={13} />
            {t("blockedMark")}
          </button>
        )}
      </div>

      {/* 公开分享（v0.4 队列第 6 项）：只读外链给工作区外的人看 */}
      <div className="col-span-2 md:col-span-auto w-full">
        <div className={fieldLabel}>
          <Share2 size={13} />
          {t("shareLabel")}
        </div>
        {taskShareUrl ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={taskShareUrl}
              onFocus={(e) => e.target.select()}
              className={
                fieldControl +
                " text-[length:var(--text-xs)] font-[family-name:var(--font-mono)]"
              }
            />
            <button
              onClick={async () => {
                if (!taskShareUrl) return;
                try {
                  await navigator.clipboard.writeText(taskShareUrl);
                  setShareCopied(true);
                  setTimeout(() => setShareCopied(false), 2000);
                } catch {
                  /* 剪贴板权限失败：提示用户手动复制 */
                  toast("error", tErr("copyFailed"));
                }
              }}
              className="shrink-0 h-8 px-2.5 rounded-[var(--radius-md)] border border-[var(--border)] text-[length:var(--text-xs)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
            >
              {shareCopied ? t("shareCopied") : t("shareCopy")}
            </button>
            <button
              onClick={() => onPatch({ shareToken: null })}
              className="shrink-0 h-8 px-2.5 rounded-[var(--radius-md)] text-[length:var(--text-xs)] text-[var(--muted)] hover:text-[var(--danger)] transition-colors duration-[var(--motion-fast)]"
            >
              {t("shareRevoke")}
            </button>
          </div>
        ) : (
          <button
            onClick={() => onPatch({ shareToken: "rotate" })}
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-[var(--radius-md)] border border-[var(--border)] text-[length:var(--text-xs)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
          >
            <Share2 size={13} />
            {t("shareGenerate")}
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
  );
}