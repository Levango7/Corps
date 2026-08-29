"use client";

import { useEffect, useState } from "react";
import { Calendar, Check, AlertTriangle, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";

/** 任务同步状态 */
interface TaskSyncStatus {
  synced: boolean;
  providers: string[];
  lastSyncedAt: string | null;
  hasError: boolean;
}

/**
 * 日历同步标记：在任务详情页截止日期旁显示同步状态。
 *
 * 状态：
 *  - 未同步：不显示（或显示灰色图标）
 *  - 已同步：绿色 ✓ + tooltip "已同步到 Google Calendar"
 *  - 同步失败：红色 ✗ + tooltip 显示错误
 *  - 同步中：spinner
 */
export default function CalendarSyncBadge({ wid, taskId }: { wid: string; taskId: string }) {
  const t = useTranslations("calendar");
  const [status, setStatus] = useState<TaskSyncStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api<TaskSyncStatus>(`/api/v1/workspaces/${wid}/tasks/${taskId}/calendar-sync`)
      .then((s) => {
        if (active) setStatus(s);
      })
      .catch(() => {
        // 静默失败，不阻塞任务详情页
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [wid, taskId]);

  // 加载中：显示小 spinner
  if (loading) {
    return (
      <span className="inline-flex items-center" title={t("syncing")}>
        <Loader2 size={14} className="animate-spin text-[var(--meta)]" />
      </span>
    );
  }

  // 未同步：不显示
  if (!status || !status.synced) return null;

  // 同步失败
  if (status.hasError) {
    return (
      <span
        className="inline-flex items-center cursor-help"
        title={t("syncFailed")}
        aria-label={t("syncFailed")}
      >
        <AlertTriangle size={14} className="text-[var(--danger)]" />
      </span>
    );
  }

  // 已同步
  const providerLabel = status.providers
    .map((p) => (p === "google" ? "Google Calendar" : "Outlook Calendar"))
    .join(", ");
  const tooltip = t("syncedTo", { provider: providerLabel });

  return (
    <span className="inline-flex items-center cursor-help" title={tooltip} aria-label={tooltip}>
      <Calendar size={14} className="text-[var(--meta)]" />
      <Check size={12} className="text-[var(--success)] -ml-1" />
    </span>
  );
}
