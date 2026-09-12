"use client";

/**
 * Presence 指示器（Phase 2，对应 design/FEATURE-DESIGN-cloud-doc.md §3.3 / §3.4.2）。
 *
 * 职责：
 * - 在线用户头像列表（awareness.getStates() 中 state.user 存在的客户端）。
 * - 连接状态指示（已连接/同步中/离线），含离线编辑提示。
 * - 头像右下角在线指示点（var(--success)）。
 * - "已同步"短暂提示：从离线/连接中恢复到在线后，用 --success 色显示 3 秒后自动消失。
 * - 离线过长提示：离线超过 7 天后重连，显示 warn 色告警，可手动关闭。
 *
 * 设计取舍：
 * - 数据来源：useOnlineUsers()（订阅 awareness.change）+ useCollaboration()（连接状态）。
 * - 头像用 <img>（与 UserMenu/MessageBubble 一致，避免 next/image remotePatterns 配置耦合），
 *   无 avatar 时回退首字母占位。
 * - 所有样式走 design token（var(--*)），无裸 hex。
 * - lucide-react 图标尺寸用 14（项目约定）。
 * - 最多显示 5 个头像，超出显示 +N（与设计文档 §3.3.1 一致）。
 * - i18n：状态文案走 collaboration 命名空间（messages/{en,zh}.json）。
 * - "已同步" 3 秒提示用 setTimeout，prefers-reduced-motion 全局降级块已将 transition-duration
 *   设为 0.01ms，视觉上无淡入淡出动画，但文本仍显示 3 秒（信息性提示，非装饰性动画）。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { WifiOff, Loader2, Check, AlertTriangle, X } from "lucide-react";
import {
  useCollaboration,
  useOnlineUsers,
  type AwarenessUser,
} from "@/components/CollaborationProvider";

// ── 头像 ───────────────────────────────────────────────────────────────────

/** 从用户名提取首字母（最多 2 字符），用于无 avatar 时的占位。 */
function getInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  // 支持中文名（取第一个字符）与英文名（取首字母大写）。
  const first = trimmed[0];
  return first.toUpperCase();
}

interface AvatarProps {
  user: AwarenessUser;
  /** 头像尺寸（px），默认 28。 */
  size?: number;
}

/** 协同用户头像：有 avatar 用 <img>，无 avatar 回退首字母占位。 */
function PresenceAvatar({ user, size = 28 }: AvatarProps) {
  const sizeStyle = { width: size, height: size };
  if (user.avatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={user.avatar}
        alt={user.name}
        style={sizeStyle}
        className="rounded-full border border-[var(--border)] object-cover"
      />
    );
  }
  return (
    <span
      style={sizeStyle}
      className="rounded-full bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] flex items-center justify-center"
    >
      {getInitials(user.name)}
    </span>
  );
}

// ── 在线用户头像列表 ───────────────────────────────────────────────────────

interface OnlineAvatarsProps {
  /** 最多显示多少个头像，超出折叠为 +N，默认 5。 */
  max?: number;
  /** 头像尺寸（px），默认 28。 */
  avatarSize?: number;
}

/**
 * 在线用户头像堆叠列表。
 * 从 awareness 读取在线用户，按 clientID 排序，最多展示 max 个，超出显示 +N。
 * 每个头像右下角有在线指示点（var(--success)）。
 */
export function OnlineAvatars({ max = 5, avatarSize = 28 }: OnlineAvatarsProps) {
  const t = useTranslations("collaboration");
  const onlineUsers = useOnlineUsers();
  const visible = onlineUsers.slice(0, max);
  const overflow = onlineUsers.length - visible.length;

  if (onlineUsers.length === 0) return null;

  return (
    <div
      className="flex items-center gap-[var(--space-1)]"
      aria-label={t("onlineCount", { count: onlineUsers.length })}
    >
      {visible.map(({ clientId, user }) => (
        <div key={clientId} className="relative">
          <PresenceAvatar user={user} size={avatarSize} />
          {/* 在线指示点 */}
          <span
            className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-[var(--success)] ring-2 ring-[var(--surface)]"
            aria-hidden
          />
        </div>
      ))}
      {overflow > 0 && (
        <span className="text-[length:var(--text-xs)] text-[var(--muted)]">
          +{overflow}
        </span>
      )}
    </div>
  );
}

// ── 连接状态指示 ───────────────────────────────────────────────────────────

/** "已同步" 短暂提示显示时长（毫秒）。 */
const SYNCED_FLASH_MS = 3000;

/**
 * 连接状态文案 + 图标。
 *
 * 状态映射（CollaborationProvider.connectionStatus + offlineSynced）：
 * - offline → 离线编辑中（warn，WifiOff，持续显示）
 * - connecting → 连接中...（muted，Loader2 旋转，持续显示）
 * - online + !offlineSynced → 加载离线数据...（muted，Loader2 旋转，持续显示）
 * - online + offlineSynced → 已同步（success，Check，仅显示 3 秒后消失）
 *
 * "已同步" 短暂提示：从非 online 状态恢复到 online+synced 时触发，
 * 3 秒后自动消失（SYNCED_FLASH_MS）。持续在线时不重复显示。
 */
export function ConnectionStatusBadge() {
  const t = useTranslations("collaboration");
  const { connectionStatus, offlineSynced } = useCollaboration();

  // "已同步" 短暂提示：从非 online 变为 online+synced 时显示 3 秒。
  const [syncedFlash, setSyncedFlash] = useState(false);
  const prevOnlineRef = useRef(false);

  useEffect(() => {
    const isOnline = connectionStatus === "online" && offlineSynced;
    if (isOnline && !prevOnlineRef.current) {
      // 从非 online 变为 online + synced：触发"已同步"短暂提示。
      setSyncedFlash(true);
      const timer = setTimeout(() => setSyncedFlash(false), SYNCED_FLASH_MS);
      prevOnlineRef.current = true;
      return () => clearTimeout(timer);
    }
    if (!isOnline) {
      prevOnlineRef.current = false;
      setSyncedFlash(false);
    }
    return undefined;
  }, [connectionStatus, offlineSynced]);

  // 推导展示状态。
  const display = useMemo(() => {
    if (connectionStatus === "offline") {
      return {
        icon: <WifiOff size={14} />,
        text: t("offlineEditing"),
        className: "text-[var(--warn)]",
      };
    }
    if (connectionStatus === "connecting") {
      return {
        icon: <Loader2 size={14} className="animate-spin" />,
        text: t("connecting"),
        className: "text-[var(--muted)]",
      };
    }
    // online
    if (!offlineSynced) {
      return {
        icon: <Loader2 size={14} className="animate-spin" />,
        text: t("loadingOfflineData"),
        className: "text-[var(--muted)]",
      };
    }
    // online + synced：仅在 syncedFlash 期间显示"已同步"，3 秒后消失。
    if (syncedFlash) {
      return {
        icon: <Check size={14} />,
        text: t("synced"),
        className: "text-[var(--success)]",
      };
    }
    // online + synced + flash 已过期：不显示状态徽章。
    return null;
  }, [connectionStatus, offlineSynced, syncedFlash, t]);

  if (!display) return null;

  return (
    <span
      className={`inline-flex items-center gap-[var(--space-1)] text-[length:var(--text-xs)] ${display.className}`}
      role="status"
      aria-live="polite"
    >
      {display.icon}
      {display.text}
    </span>
  );
}

// ── 离线过长提示 ───────────────────────────────────────────────────────────

/**
 * 离线过长告警：离线超过 7 天后重连时显示，提示用户检查合并结果。
 * 用 --warn 色告警，可手动关闭（dismissOfflineTooLong）。
 * 离线期间其他人的删除/修改操作较多，CRDT 虽自动合并但结果可能与预期有差异。
 */
export function OfflineTooLongNotice() {
  const t = useTranslations("collaboration");
  const { offlineTooLong, dismissOfflineTooLong } = useCollaboration();

  if (!offlineTooLong) return null;

  return (
    <div
      className="inline-flex items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] bg-[var(--warn-soft)] px-[var(--space-2)] py-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--warn)]"
      role="alert"
      aria-live="assertive"
    >
      <AlertTriangle size={14} aria-hidden />
      <span>{t("offlineTooLong")}</span>
      <button
        type="button"
        onClick={dismissOfflineTooLong}
        className="inline-flex items-center justify-center rounded-[var(--radius-sm)] p-0.5 text-[var(--warn)] hover:bg-[var(--warn-soft)] focus-visible:outline-2 focus-visible:outline-[var(--warn)] focus-visible:outline-offset-2"
        aria-label={t("dismiss")}
      >
        <X size={12} aria-hidden />
      </button>
    </div>
  );
}

// ── 组合组件 ───────────────────────────────────────────────────────────────

interface PresenceIndicatorProps {
  /** 最多显示多少个头像，默认 5。 */
  maxAvatars?: number;
  /** 头像尺寸（px），默认 28。 */
  avatarSize?: number;
  /** 是否显示连接状态徽章，默认 true。 */
  showStatus?: boolean;
  /** 是否显示在线头像列表，默认 true。 */
  showAvatars?: boolean;
  /** 是否显示离线过长告警，默认 true。 */
  showOfflineNotice?: boolean;
}

/**
 * Presence 指示器：在线头像列表 + 连接状态徽章 + 离线过长告警。
 *
 * 在 <CollaborationProvider> 内使用。通常放在编辑器右上角工具栏。
 *
 * @example
 * <PresenceIndicator />
 * <PresenceIndicator showStatus={false} maxAvatars={8} />
 */
export default function PresenceIndicator({
  maxAvatars = 5,
  avatarSize = 28,
  showStatus = true,
  showAvatars = true,
  showOfflineNotice = true,
}: PresenceIndicatorProps) {
  return (
    <div className="flex flex-wrap items-center gap-[var(--space-2)]">
      {showAvatars && <OnlineAvatars max={maxAvatars} avatarSize={avatarSize} />}
      {showStatus && <ConnectionStatusBadge />}
      {showOfflineNotice && <OfflineTooLongNotice />}
    </div>
  );
}