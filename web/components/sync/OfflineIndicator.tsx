"use client";

/**
 * 离线指示器横幅。
 *
 * 显示逻辑：
 *  - 离线时：显示横幅"您当前离线，更改将在恢复连接后同步"（WifiOff 图标）
 *  - 在线恢复时：显示"已恢复连接，正在同步..."（Wifi 图标），同步完成后自动隐藏
 *  - 常态在线：不渲染（返回 null）
 *
 * 用法：
 *  <OfflineIndicator workspaceId={wid} />
 *
 * Design token 样式 + lucide-react 图标（Wifi/WifiOff）size 14/16。
 * next-intl useTranslations("sync")。
 *
 * 经验来源：2026-09-12-frontend-role-permission-extension-fullstack-pattern
 *  - 'use client' + design token + lucide-react + useTranslations()
 */

import { useEffect, useState, useRef } from "react";
import { useTranslations } from "next-intl";
import { Wifi, WifiOff } from "lucide-react";
import { getSyncManager, type SyncStatus as SyncStatusValue } from "@/lib/sync/sync-manager";

/** OfflineIndicator 组件 Props */
interface OfflineIndicatorProps {
  /** 工作区 ID */
  workspaceId: string;
}

/** 横幅显示模式 */
type BannerMode = "hidden" | "offline" | "restoring";

/** 在线恢复后横幅停留时长（ms），之后自动隐藏 */
const RESTORE_BANNER_DURATION_MS = 3000;

export default function OfflineIndicator({ workspaceId }: OfflineIndicatorProps) {
  const t = useTranslations("sync");

  const [mode, setMode] = useState<BannerMode>("hidden");
  /** 曾经离线标记（用于检测"从离线恢复到在线"的过渡） */
  const wasOfflineRef = useRef(false);
  /** 恢复横幅自动隐藏定时器 */
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const managerRef = useRef(getSyncManager(workspaceId));

  // 订阅同步状态
  useEffect(() => {
    const manager = managerRef.current;

    const offStatus = manager.onStatusChange((newStatus: SyncStatusValue) => {
      if (newStatus === "offline") {
        // 进入离线
        wasOfflineRef.current = true;
        // 清除可能存在的恢复横幅定时器
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
        }
        setMode("offline");
      } else {
        // 从离线恢复到在线（syncing/synced/error）
        if (wasOfflineRef.current) {
          wasOfflineRef.current = false;
          setMode("restoring");
          // 3 秒后自动隐藏恢复横幅
          if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
          hideTimerRef.current = setTimeout(() => {
            setMode("hidden");
            hideTimerRef.current = null;
          }, RESTORE_BANNER_DURATION_MS);
        } else {
          // 常态在线变化（非从离线恢复）：保持隐藏
          if (mode === "restoring") {
            // 恢复横幅显示中，同步完成（synced）时可以提前隐藏
            if (newStatus === "synced" && hideTimerRef.current) {
              // 让定时器自然隐藏，不提前打断（保持一致的 3s 体验）
            }
          } else {
            setMode("hidden");
          }
        }
      }
    });

    return () => {
      offStatus();
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 不显示时返回 null（不占布局空间）
  if (mode === "hidden") return null;

  // 离线横幅
  if (mode === "offline") {
    return (
      <div
        className="flex items-center justify-center gap-2 w-full h-9 px-4 bg-[var(--warn-soft)] border-b border-[var(--border)] text-[length:var(--text-sm)] text-[var(--warn)]"
        role="status"
        aria-live="polite"
      >
        <WifiOff size={16} className="shrink-0" />
        <span>{t("offlineBanner")}</span>
      </div>
    );
  }

  // 恢复连接横幅
  return (
    <div
      className="flex items-center justify-center gap-2 w-full h-9 px-4 bg-[var(--success-soft)] border-b border-[var(--border)] text-[length:var(--text-sm)] text-[var(--success)]"
      role="status"
      aria-live="polite"
    >
      <Wifi size={16} className="shrink-0" />
      <span>{t("onlineRestored")}</span>
    </div>
  );
}
