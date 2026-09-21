"use client";

/**
 * 顶栏 IM 未读徽标
 *
 * 职责：
 *  - 轮询 GET /conversations/unread-count（30s 间隔）
 *  - 显示红色圆点（有未读）或数字（未读 > 0）
 *  - 点击跳转 /w/${workspaceId}/im
 *  - 未读数 > 99 时显示 "99+"
 *
 * 所有样式走 design token（var(--*)），无裸 hex。
 * lucide-react 图标尺寸用 18（顶栏图标约定）。
 */

import { useState, useEffect } from "react";
import { MessageSquare } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/lib/i18n-navigation";
import { api } from "@/lib/api";

interface IMBadgeProps {
  workspaceId: string;
}

interface UnreadCountResponse {
  totalUnread: number;
  byConversation: { conversationId: string; unreadCount: number }[];
}

export function IMBadge({ workspaceId }: IMBadgeProps) {
  const t = useTranslations("chat");
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const fetchUnread = () => {
      api<UnreadCountResponse>(
        `/api/v1/workspaces/${workspaceId}/conversations/unread-count`,
      )
        .then((data) => setUnreadCount(data.totalUnread))
        .catch(() => {});
    };

    fetchUnread();
    const interval = setInterval(fetchUnread, 30000); // 30s 轮询
    return () => clearInterval(interval);
  }, [workspaceId]);

  const handleClick = () => {
    router.push(`/w/${workspaceId}/im`);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={t("title")}
      className="relative w-9 h-9 flex items-center justify-center rounded-[var(--radius-md)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
    >
      <MessageSquare size={18} />
      {unreadCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center px-1 rounded-full bg-[var(--danger)] text-[length:var(--text-xs)] font-[weight:var(--weight-semibold)] text-[var(--on-accent)]">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </button>
  );
}