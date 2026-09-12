"use client";

/**
 * Presence 指示器（Phase 2，对应 design/FEATURE-DESIGN-cloud-doc.md §3.3 / §3.4.2）。
 *
 * 职责：
 * - 在线用户头像列表（awareness.getStates() 中 state.user 存在的客户端）。
 * - 连接状态指示（已连接/同步中/离线），含离线编辑提示。
 * - 头像右下角在线指示点（var(--success)）。
 *
 * 设计取舍：
 * - 数据来源：useOnlineUsers()（订阅 awareness.change）+ useCollaboration()（连接状态）。
 * - 头像用 <img>（与 UserMenu/MessageBubble 一致，避免 next/image remotePatterns 配置耦合），
 *   无 avatar 时回退首字母占位。
 * - 所有样式走 design token（var(--*)），无裸 hex。
 * - lucide-react 图标尺寸用 14（项目约定）。
 * - 最多显示 5 个头像，超出显示 +N（与设计文档 §3.3.1 一致）。
 *
 * i18n 说明：状态文案（离线编辑中 / 同步中 / 已同步）暂硬编码中文。
 * 待后续补充到 messages/{en,zh}.json 的 collaboration 命名空间
 * （受本次"不修改现有文件"约束暂未添加）。
 */

import { useMemo } from "react";
import { WifiOff, Loader2, Check } from "lucide-react";
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
  const onlineUsers = useOnlineUsers();
  const visible = onlineUsers.slice(0, max);
  const overflow = onlineUsers.length - visible.length;

  if (onlineUsers.length === 0) return null;

  return (
    <div
      className="flex items-center gap-[var(--space-1)]"
      aria-label={`在线 ${onlineUsers.length} 人`}
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

/**
 * 连接状态文案 + 图标。
 *
 * 状态映射（CollaborationProvider.connectionStatus + offlineSynced）：
 * - offline → 离线编辑中，上线后自动同步（warn，WifiOff）
 * - connecting → 同步中...（muted，Loader2 旋转）
 * - online + !offlineSynced → 同步中...（muted，Loader2 旋转，WS 已连但 IndexedDB 仍在加载）
 * - online + offlineSynced → 已同步（success，Check）
 */
export function ConnectionStatusBadge() {
  const { connectionStatus, offlineSynced } = useCollaboration();

  // 推导展示状态。
  const display = useMemo(() => {
    if (connectionStatus === "offline") {
      return {
        icon: <WifiOff size={14} />,
        text: "离线编辑中，上线后自动同步",
        className: "text-[var(--warn)]",
        spin: false,
      };
    }
    if (connectionStatus === "connecting") {
      return {
        icon: <Loader2 size={14} className="animate-spin" />,
        text: "同步中...",
        className: "text-[var(--muted)]",
        spin: true,
      };
    }
    // online
    if (!offlineSynced) {
      return {
        icon: <Loader2 size={14} className="animate-spin" />,
        text: "同步中...",
        className: "text-[var(--muted)]",
        spin: true,
      };
    }
    return {
      icon: <Check size={14} />,
      text: "已同步",
      className: "text-[var(--success)]",
      spin: false,
    };
  }, [connectionStatus, offlineSynced]);

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
}

/**
 * Presence 指示器：在线头像列表 + 连接状态徽章。
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
}: PresenceIndicatorProps) {
  return (
    <div className="flex items-center gap-[var(--space-2)]">
      {showAvatars && <OnlineAvatars max={maxAvatars} avatarSize={avatarSize} />}
      {showStatus && <ConnectionStatusBadge />}
    </div>
  );
}