"use client";

/**
 * F3 Widget — TeamLoadWidget：团队负载热力图。
 *
 * 数据：GET /dashboard/widgets/team-load →
 *   { items: [{ userId, name, email, role, load: { todo, in_progress, review, done, total } }] }
 *
 * 展示：每个成员一行，按 total 任务数着色（多色阶热力图）。
 * 所有色值走 var(--token)，SVG 用 design token 颜色。
 */

import { useTranslations } from "next-intl";
import { useWidgetData } from "./useWidgetData";
import { WidgetError, WidgetEmpty, WidgetSkeleton } from "./WidgetStates";
import type { Role } from "@/lib/types";

interface MemberLoad {
  todo: number;
  in_progress: number;
  review: number;
  done: number;
  total: number;
}

interface TeamLoadItem {
  userId: string;
  name: string | null;
  email: string;
  role: Role;
  load: MemberLoad;
}

interface TeamLoadData {
  items: TeamLoadItem[];
}

/** 负载色阶图例：低 → 高（绿 → 蓝 → 橙 → 红） */
const LOAD_LEGEND: { range: string; color: string }[] = [
  { range: "0-2", color: "var(--success)" },
  { range: "3-5", color: "var(--accent)" },
  { range: "6-8", color: "var(--warn)" },
  { range: "9+", color: "var(--danger)" },
];

/** 负载色阶：按 total 任务数映射到 4 档色阶（token） */
function loadColor(total: number): string {
  if (total <= 2) return "var(--success)";
  if (total <= 5) return "var(--accent)";
  if (total <= 8) return "var(--warn)";
  return "var(--danger)";
}

/** 负载条：按状态分段着色 */
function LoadBar({ load }: { load: MemberLoad }) {
  const total = Math.max(1, load.total);
  const segments: { key: string; count: number; color: string }[] = [
    { key: "todo", count: load.todo, color: "var(--status-todo)" },
    { key: "in_progress", count: load.in_progress, color: "var(--status-doing)" },
    { key: "review", count: load.review, color: "var(--status-warn-fg)" },
    { key: "done", count: load.done, color: "var(--status-done)" },
  ];
  return (
    <div className="flex h-2 rounded-[var(--radius-sm)] overflow-hidden bg-[var(--surface-2)]">
      {segments.map((seg) =>
        seg.count > 0 ? (
          <div
            key={seg.key}
            className="h-full"
            style={{ width: `${(seg.count / total) * 100}%`, backgroundColor: seg.color }}
          />
        ) : null,
      )}
    </div>
  );
}

export default function TeamLoadWidget({ wid }: { wid: string }) {
  const t = useTranslations("dashboard");
  const { data, loading, error, retry } = useWidgetData<TeamLoadData>(wid, "team-load");

  if (loading) return <WidgetSkeleton lines={5} />;
  if (error || !data) return <WidgetError message={error} onRetry={retry} />;
  if (data.items.length === 0) return <WidgetEmpty text={t("teamLoadEmpty")} />;

  // 按 total 降序排列，负载最重的在前
  const sorted = [...data.items].sort((a, b) => b.load.total - a.load.total);

  return (
    <div className="p-3 space-y-2">
      {sorted.slice(0, 8).map((member) => {
        const displayName = member.name || member.email;
        const initial = displayName[0]?.toUpperCase() ?? "?";
        return (
          <div key={member.userId} className="flex items-center gap-2">
            <span
              className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]"
              style={{ backgroundColor: loadColor(member.load.total) }}
              title={displayName}
            >
              {initial}
            </span>
            <span className="w-20 shrink-0 text-[length:var(--text-xs)] text-[var(--fg-2)] truncate">
              {displayName}
            </span>
            <div className="flex-1 min-w-0">
              <LoadBar load={member.load} />
            </div>
            <span className="shrink-0 w-6 text-right text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--fg)] tabular-nums">
              {member.load.total}
            </span>
          </div>
        );
      })}
      {/* 色阶图例 */}
      <div className="flex items-center justify-between gap-1 pt-1 border-t border-[var(--border-soft)]">
        {LOAD_LEGEND.map((leg) => (
          <span
            key={leg.range}
            className="flex items-center gap-1 text-[length:var(--text-xs)] text-[var(--meta)]"
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: leg.color }}
            />
            {leg.range}
          </span>
        ))}
      </div>
    </div>
  );
}