"use client";

/**
 * 同步状态指示器。
 *
 * 显示内容：
 *  - 同步状态图标 + 文案：synced / syncing / offline / error
 *  - 最后同步时间（相对时间，如"3 分钟前"）
 *  - 手动同步按钮（RefreshCw，syncing 时旋转）
 *  - 待同步操作数（badge）
 *
 * 用法：
 *  <SyncStatus workspaceId={wid} />
 *
 * Design token 样式 + lucide-react 图标（Cloud/CloudOff/RefreshCw/Check/AlertCircle）size 14/16。
 * next-intl useTranslations("sync")。
 *
 * 经验来源：2026-09-12-frontend-role-permission-extension-fullstack-pattern
 *  - 'use client' + api() 客户端 + design token + lucide-react + useTranslations()
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { Cloud, CloudOff, RefreshCw, Check, AlertCircle } from "lucide-react";
import { getSyncManager, type SyncStatus as SyncStatusValue } from "@/lib/sync/sync-manager";

/** SyncStatus 组件 Props */
interface SyncStatusProps {
  /** 工作区 ID */
  workspaceId: string;
  /** 尺寸 */
  size?: "sm" | "md";
}

/** 格式化相对时间（如"3 分钟前"），i18n 由调用方传入 t */
function formatRelativeTime(
  timestamp: number | null,
  t: (key: string, values?: Record<string, string | number | Date>) => string,
): string {
  if (timestamp === null) return t("never");
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return t("justNow");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("minutesAgo", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("hoursAgo", { count: hours });
  const days = Math.floor(hours / 24);
  return t("daysAgo", { count: days });
}

export default function SyncStatus({ workspaceId, size = "md" }: SyncStatusProps) {
  const t = useTranslations("sync");

  const [status, setStatus] = useState<SyncStatusValue>("synced");
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  /** 触发相对时间刷新（每分钟） */
  const [, setTick] = useState(0);

  const managerRef = useRef(getSyncManager(workspaceId));

  // 订阅同步管理器状态
  useEffect(() => {
    const manager = managerRef.current;

    const offStatus = manager.onStatusChange((newStatus, newLastSync) => {
      setStatus(newStatus);
      setLastSync(newLastSync);
      setSyncing(newStatus === "syncing");
    });

    const offPending = manager.onPendingChange((count) => {
      setPending(count);
    });

    // 初始拉取 pending 计数
    void manager.getPendingCount().then(setPending);

    return () => {
      offStatus();
      offPending();
    };
  }, []);

  // 每分钟刷新相对时间显示
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  /** 手动同步 */
  const handleSyncNow = useCallback(() => {
    if (syncing) return;
    void managerRef.current.syncNow();
  }, [syncing]);

  // 尺寸样式
  const iconSize = size === "sm" ? 14 : 16;
  const textSize = size === "sm" ? "text-[length:var(--text-xs)]" : "text-[length:var(--text-sm)]";
  const btnHeight = size === "sm" ? "h-7" : "h-8";

  // 状态对应的图标 + 颜色
  let StatusIcon: typeof Cloud;
  let statusColor: string;
  let statusLabel: string;
  switch (status) {
    case "synced":
      StatusIcon = Check;
      statusColor = "var(--success)";
      statusLabel = t("synced");
      break;
    case "syncing":
      StatusIcon = Cloud;
      statusColor = "var(--accent)";
      statusLabel = t("syncing");
      break;
    case "offline":
      StatusIcon = CloudOff;
      statusColor = "var(--meta)";
      statusLabel = t("offline");
      break;
    case "error":
      StatusIcon = AlertCircle;
      statusColor = "var(--danger)";
      statusLabel = t("error");
      break;
  }

  return (
    <div
      className={`inline-flex items-center gap-1.5 ${btnHeight} px-2 rounded-[var(--radius-md)] ${textSize}`}
      role="status"
      aria-live="polite"
      aria-label={statusLabel}
    >
      {/* 状态图标 */}
      <StatusIcon
        size={iconSize}
        className={status === "syncing" ? "animate-spin" : ""}
        style={{ color: statusColor }}
      />

      {/* 状态文案 */}
      <span style={{ color: statusColor }}>{statusLabel}</span>

      {/* 最后同步时间（synced/error 状态显示） */}
      {status === "synced" && lastSync !== null && (
        <span className="text-[var(--meta)]">· {formatRelativeTime(lastSync, t)}</span>
      )}

      {/* 待同步操作数 badge */}
      {pending > 0 && (
        <span
          className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-[var(--radius-pill)] bg-[var(--warn-soft)] text-[var(--warn)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)]"
          aria-label={t("pending", { count: pending })}
        >
          {pending > 99 ? "99+" : pending}
        </span>
      )}

      {/* 手动同步按钮 */}
      <button
        type="button"
        onClick={handleSyncNow}
        disabled={syncing}
        className={`inline-flex items-center justify-center w-6 h-6 rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:opacity-50 disabled:cursor-not-allowed`}
        aria-label={t("syncNow")}
        title={t("syncNow")}
      >
        <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
      </button>
    </div>
  );
}
