"use client";

/**
 * 会议行动项列表组件（方向 G 实时会议 AI）。
 *
 * 功能：
 *  - 展示 AI 从会议转录中提取的行动项
 *  - 每条行动项显示：内容、负责人、截止日期、置信度、状态
 *  - 支持状态切换：pending → completed / skipped
 *
 * 样式全走 design token（var(--*)），lucide-react 图标尺寸 14/16。
 * 错误处理：catch 中用 t("error")，不泄露 e.message。
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  CheckSquare,
  Square,
  SkipForward,
  User,
  Calendar,
  Loader2,
  AlertCircle,
  ListChecks,
} from "lucide-react";
import { api } from "@/lib/api";

/** 行动项类型（与 Prisma AiMeetingActionItem 对齐） */
interface ActionItem {
  id: string;
  content: string;
  assigneeId: string | null;
  dueDate: string | null;
  status: string;
  extractedBy: string;
  confidence: number;
  createdAt: string;
}

/** MeetingActionItems Props */
interface MeetingActionItemsProps {
  /** 工作区 ID */
  wid: string;
  /** 会议会话 ID */
  sessionId: string;
}

export function MeetingActionItems({ wid, sessionId }: MeetingActionItemsProps) {
  const t = useTranslations("ai.aiMeeting");

  const [actions, setActions] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  /** 加载行动项列表 */
  const loadActions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<ActionItem[]>(
        `/api/v1/ai/meetings/sessions/${sessionId}/actions?wid=${encodeURIComponent(wid)}`,
      );
      setActions(data);
    } catch (e) {
      if (process.env.NODE_ENV === "development")
        console.error("[MeetingActionItems] load failed:", e);
      setError(t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [wid, sessionId, t]);

  useEffect(() => {
    loadActions();
  }, [loadActions]);

  /** 更新行动项状态 */
  const handleUpdateStatus = useCallback(
    async (action: ActionItem, status: "completed" | "skipped") => {
      setUpdatingId(action.id);
      try {
        await api(`/api/v1/ai/meetings/sessions/${sessionId}/actions`, {
          method: "PATCH",
          body: JSON.stringify({ wid, actionId: action.id, status }),
        });
        setActions((prev) => prev.map((a) => (a.id === action.id ? { ...a, status } : a)));
      } catch (e) {
        if (process.env.NODE_ENV === "development")
          console.error("[MeetingActionItems] update failed:", e);
        setError(t("error"));
      } finally {
        setUpdatingId(null);
      }
    },
    [wid, sessionId, t],
  );

  /** 格式化截止日期 */
  const formatDueDate = useCallback((dueDate: string | null): string => {
    if (!dueDate) return "";
    const d = new Date(dueDate);
    return d.toLocaleDateString();
  }, []);

  /** 置信度百分比 */
  const confidencePercent = useCallback((c: number): string => {
    return `${Math.round(c * 100)}%`;
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-[var(--space-4)] text-[var(--meta)] text-[length:var(--text-sm)]">
        <Loader2 size={16} className="animate-spin mr-2 motion-reduce:animate-none" />
        {t("loading")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 px-[var(--space-3)] py-[var(--space-2)] rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-sm)]">
        <AlertCircle size={14} className="shrink-0 mt-0.5" />
        <span className="flex-1">{error}</span>
      </div>
    );
  }

  if (actions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-[var(--space-2)] py-[var(--space-6)] text-center">
        <ListChecks size={24} className="text-[var(--meta)]" />
        <p className="text-[length:var(--text-sm)] text-[var(--meta)]">{t("noActions")}</p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-[var(--space-2)]">
      {actions.map((action) => (
        <li
          key={action.id}
          className={`rounded-[var(--radius-md)] border px-[var(--space-3)] py-[var(--space-3)] transition-colors ${
            action.status === "completed"
              ? "border-[var(--border-soft)] bg-[var(--surface)] opacity-60"
              : action.status === "skipped"
                ? "border-[var(--border-soft)] bg-[var(--surface)] opacity-40"
                : "border-[var(--border)] bg-[var(--surface)]"
          }`}
        >
          <div className="flex items-start gap-[var(--space-2)]">
            {/* 状态切换按钮 */}
            <button
              type="button"
              onClick={() => action.status === "pending" && handleUpdateStatus(action, "completed")}
              disabled={updatingId === action.id || action.status !== "pending"}
              title={t("markComplete")}
              className="shrink-0 mt-0.5 text-[var(--fg-2)] transition-colors hover:text-[var(--success)] disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] rounded-[var(--radius-sm)]"
            >
              {updatingId === action.id ? (
                <Loader2 size={16} className="animate-spin motion-reduce:animate-none" />
              ) : action.status === "completed" ? (
                <CheckSquare size={16} className="text-[var(--success)]" />
              ) : (
                <Square size={16} />
              )}
            </button>

            <div className="min-w-0 flex-1">
              {/* 行动项内容 */}
              <p
                className={`text-[length:var(--text-sm)] text-[var(--fg)] ${
                  action.status === "completed" ? "line-through" : ""
                }`}
              >
                {action.content}
              </p>

              {/* 元信息行 */}
              <div className="mt-[var(--space-1)] flex flex-wrap items-center gap-x-[var(--space-3)] gap-y-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--meta)]">
                {/* 负责人 */}
                {action.assigneeId && (
                  <span className="inline-flex items-center gap-1">
                    <User size={14} />
                    {action.assigneeId}
                  </span>
                )}

                {/* 截止日期 */}
                {action.dueDate && (
                  <span className="inline-flex items-center gap-1">
                    <Calendar size={14} />
                    {formatDueDate(action.dueDate)}
                  </span>
                )}

                {/* 置信度 */}
                <span className="inline-flex items-center gap-1">
                  {t("confidence")}: {confidencePercent(action.confidence)}
                </span>

                {/* 跳过按钮（仅 pending 状态显示） */}
                {action.status === "pending" && (
                  <button
                    type="button"
                    onClick={() => handleUpdateStatus(action, "skipped")}
                    disabled={updatingId === action.id}
                    title={t("markSkip")}
                    className="inline-flex items-center gap-1 text-[var(--meta)] transition-colors hover:text-[var(--warning, var(--accent))] disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] rounded-[var(--radius-sm)]"
                  >
                    <SkipForward size={14} />
                    {t("skip")}
                  </button>
                )}
              </div>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
