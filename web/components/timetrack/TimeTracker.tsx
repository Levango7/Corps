"use client";

/**
 * TimeTracker — 工时计时器组件
 *
 * 功能：
 *  - 显示当前正在进行的计时（如果有），实时显示已计时长度（HH:MM:SS）
 *  - 开始/停止按钮
 *  - 可选关联任务、描述、是否计费、时薪
 *
 * 数据流：
 *  - GET /time-entries?limit=50 → 查找 endTime=null 的记录作为 running entry
 *  - POST /time-entries/start → 开始计时
 *  - POST /time-entries/stop → 停止计时
 *  - GET /tasks → 任务列表供关联选择
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Play, Square, Timer, Loader2 } from "lucide-react";
import { api } from "@/lib/api";

interface TimeEntry {
  id: string;
  userId: string;
  taskId: string | null;
  startTime: string;
  endTime: string | null;
  duration: number | null;
  description: string | null;
  billable: boolean;
  hourlyRate: number | null;
  task?: { id: string; title: string } | null;
}

interface TaskOption {
  id: string;
  title: string;
}

/** 秒数 → HH:MM:SS */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const fieldLabel =
  "flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--meta)] mb-1.5";
const fieldControl =
  "w-full h-9 px-2.5 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]";

export function TimeTracker({ wid, onStopped }: { wid: string; onStopped?: () => void }) {
  const t = useTranslations("timetrack");
  const [running, setRunning] = useState<TimeEntry | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [tasks, setTasks] = useState<TaskOption[]>([]);
  const [taskId, setTaskId] = useState("");
  const [description, setDescription] = useState("");
  const [billable, setBillable] = useState(false);
  const [hourlyRate, setHourlyRate] = useState("");
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState("");

  // 挂载时查询 running entry + 任务列表
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [listData, taskData] = await Promise.all([
          api<{ items: TimeEntry[] }>(`/api/v1/workspaces/${wid}/time-entries?limit=50`).catch(
            () => ({ items: [] }),
          ),
          api<{ items: TaskOption[] }>(`/api/v1/workspaces/${wid}/tasks?limit=100`).catch(() => ({
            items: [],
          })),
        ]);
        if (cancelled) return;
        setTasks(taskData.items || []);
        const runningEntry = (listData.items || []).find((e) => e.endTime === null);
        setRunning(runningEntry ?? null);
        if (runningEntry) {
          setTaskId(runningEntry.taskId ?? "");
          setDescription(runningEntry.description ?? "");
          setBillable(runningEntry.billable);
          setHourlyRate(runningEntry.hourlyRate ? String(runningEntry.hourlyRate) : "");
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t("loadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wid, t]);

  // 实时更新已计时长度
  useEffect(() => {
    if (!running) {
      setElapsed(0);
      return;
    }
    const update = () =>
      setElapsed(Math.floor((Date.now() - new Date(running.startTime).getTime()) / 1000));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [running]);

  async function handleStart() {
    if (acting) return;
    setActing(true);
    setError("");
    try {
      const entry = await api<TimeEntry>(`/api/v1/workspaces/${wid}/time-entries/start`, {
        method: "POST",
        body: JSON.stringify({
          taskId: taskId || undefined,
          description: description.trim() || undefined,
          billable,
          hourlyRate: hourlyRate ? Number(hourlyRate) : undefined,
        }),
      });
      setRunning(entry);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("startFailed"));
    } finally {
      setActing(false);
    }
  }

  async function handleStop() {
    if (!running || acting) return;
    setActing(true);
    setError("");
    try {
      await api<TimeEntry>(`/api/v1/workspaces/${wid}/time-entries/stop`, {
        method: "POST",
        body: JSON.stringify({ teid: running.id }),
      });
      setRunning(null);
      setElapsed(0);
      // 重置表单
      setTaskId("");
      setDescription("");
      setBillable(false);
      setHourlyRate("");
      onStopped?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("stopFailed"));
    } finally {
      setActing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]">
        <Loader2 size={16} className="animate-spin" />
        <span className="text-[length:var(--text-sm)]">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4">
      {/* 计时器显示 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Timer size={16} className={running ? "text-[var(--accent)]" : "text-[var(--muted)]"} />
          <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
            {t("timer")}
          </span>
          {running && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--accent-soft)] text-[length:var(--text-xs)] text-[var(--accent)]">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
              {t("running")}
            </span>
          )}
        </div>
        <div className="text-[length:var(--text-2xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tabular-nums tracking-[var(--tracking-display)]">
          {formatDuration(elapsed)}
        </div>
      </div>

      {/* 表单（仅在未计时时可编辑关联/描述；计时时只显示停止） */}
      {!running && (
        <div className="space-y-3 mb-4">
          {tasks.length > 0 && (
            <div>
              <label className={fieldLabel}>{t("task")}</label>
              <select
                value={taskId}
                onChange={(e) => setTaskId(e.target.value)}
                className={fieldControl}
              >
                <option value="">{t("noTask")}</option>
                {tasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className={fieldLabel}>{t("description")}</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              className={fieldControl}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={fieldLabel}>{t("billable")}</label>
              <button
                type="button"
                onClick={() => setBillable(!billable)}
                className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] border text-[length:var(--text-sm)] transition-colors duration-[var(--motion-fast)] ${
                  billable
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "border-[var(--border)] bg-[var(--surface)] text-[var(--fg-2)]"
                }`}
                aria-pressed={billable}
              >
                <span
                  className={`inline-block w-3.5 h-3.5 rounded-[var(--radius-sm)] border ${
                    billable
                      ? "border-[var(--accent)] bg-[var(--accent)]"
                      : "border-[var(--border)]"
                  }`}
                />
                {billable ? t("billableYes") : t("billableNo")}
              </button>
            </div>
            <div>
              <label className={fieldLabel}>{t("hourlyRate")}</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={hourlyRate}
                onChange={(e) => setHourlyRate(e.target.value)}
                placeholder="0.00"
                className={fieldControl}
              />
            </div>
          </div>
        </div>
      )}

      {/* 运行中显示关联信息 */}
      {running && (
        <div className="mb-4 text-[length:var(--text-sm)] text-[var(--muted)] space-y-1">
          {running.task && (
            <div>
              {t("task")}: <span className="text-[var(--fg-2)]">{running.task.title}</span>
            </div>
          )}
          {running.description && (
            <div>
              {t("description")}: <span className="text-[var(--fg-2)]">{running.description}</span>
            </div>
          )}
          {running.billable && (
            <div>
              {t("billable")}: <span className="text-[var(--success)]">{t("billableYes")}</span>
              {running.hourlyRate ? ` · ${running.hourlyRate}/h` : ""}
            </div>
          )}
        </div>
      )}

      {error && <p className="mb-3 text-[length:var(--text-sm)] text-[var(--danger)]">{error}</p>}

      {/* 开始/停止按钮 */}
      <div className="flex justify-end">
        {running ? (
          <button
            onClick={handleStop}
            disabled={acting}
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-[var(--radius-md)] bg-[var(--danger)] text-[var(--danger-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:opacity-90 disabled:opacity-50 transition-colors duration-[var(--motion-fast)]"
          >
            {acting ? <Loader2 size={14} className="animate-spin" /> : <Square size={14} />}
            {t("stop")}
          </button>
        ) : (
          <button
            onClick={handleStart}
            disabled={acting}
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)]"
          >
            {acting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {t("start")}
          </button>
        )}
      </div>
    </div>
  );
}
