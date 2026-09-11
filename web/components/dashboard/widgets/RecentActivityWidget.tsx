"use client";

/**
 * F3 Widget — RecentActivityWidget：最近活动列表（通知）。
 *
 * 数据：GET /dashboard/widgets/recent-activity →
 *   { items: [{ id, type, entityId, entityTitle, read, createdAt }] }
 *
 * 展示：最近 10 条通知，按时间倒序，可点击跳转。
 */

import { Link } from "@/lib/i18n-navigation";
import {
  AtSign,
  UserPlus,
  RefreshCw,
  MessageSquare,
  FileText,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useWidgetData } from "./useWidgetData";
import { WidgetError, WidgetEmpty, WidgetSkeleton } from "./WidgetStates";
import { relativeTime as sharedRelativeTime } from "@/lib/format";
import type { NotificationType } from "@/lib/types";

interface ActivityItem {
  id: string;
  type: NotificationType;
  entityId: string;
  entityTitle: string;
  read: boolean;
  createdAt: string;
}

interface RecentActivityData {
  items: ActivityItem[];
}

const TYPE_META: Record<NotificationType, { icon: typeof AtSign; color: string }> = {
  mention: { icon: AtSign, color: "var(--accent)" },
  task_assigned: { icon: UserPlus, color: "var(--success)" },
  task_updated: { icon: RefreshCw, color: "var(--accent)" },
  comment_added: { icon: MessageSquare, color: "var(--warn)" },
  decision_updated: { icon: FileText, color: "var(--fg-2)" },
};

export default function RecentActivityWidget({ wid }: { wid: string }) {
  const t = useTranslations("dashboard");
  const tTime = useTranslations("time");
  const { data, loading, error, retry } = useWidgetData<RecentActivityData>(
    wid,
    "recent-activity",
  );

  if (loading) return <WidgetSkeleton lines={5} />;
  if (error || !data) return <WidgetError message={error} onRetry={retry} />;
  if (data.items.length === 0) return <WidgetEmpty text={t("recentActivityEmpty")} />;

  return (
    <ul className="divide-y divide-[var(--border-soft)]">
      {data.items.slice(0, 8).map((item) => {
        const meta = TYPE_META[item.type];
        const Icon = meta.icon;
        const rel = sharedRelativeTime(item.createdAt, tTime);
        return (
          <li key={item.id}>
            <Link
              href={`/w/${wid}/task/${item.entityId}`}
              className="flex items-center gap-2 px-3 py-2 hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
            >
              <Icon
                size={13}
                className="shrink-0"
                style={{ color: meta.color }}
              />
              <span
                className={`flex-1 min-w-0 text-[length:var(--text-xs)] truncate ${
                  item.read ? "text-[var(--muted)]" : "text-[var(--fg)]"
                }`}
              >
                {item.entityTitle}
              </span>
              {!item.read && (
                <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
              )}
              {rel && (
                <span className="shrink-0 text-[length:var(--text-xs)] text-[var(--meta)] tabular-nums">
                  {rel}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}