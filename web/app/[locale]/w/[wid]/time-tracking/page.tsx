"use client";

/**
 * 工时管理页面 · /w/[wid]/time-tracking
 *
 * 布局：计时器（TimeTracker）+ 标签页切换（记录列表 / 报告）
 * TimeTracker 停止计时后递增 refreshKey，触发列表/报告刷新。
 */

import { use, useState } from "react";
import { useTranslations } from "next-intl";
import { Clock, List, BarChart3 } from "lucide-react";
import { TimeTracker } from "@/components/timetrack/TimeTracker";
import { TimeEntryList } from "@/components/timetrack/TimeEntryList";
import { TimeReport } from "@/components/timetrack/TimeReport";

export default function TimeTrackingPage({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = use(params);
  const t = useTranslations("timetrack");
  const [tab, setTab] = useState<"list" | "report">("list");
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="mx-auto max-w-[var(--container-max)] px-[var(--space-4)] py-[var(--space-6)] space-y-[var(--space-5)]">
      <h1 className="flex items-center gap-2 text-[length:var(--text-2xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tracking-[var(--tracking-tight)]">
        <Clock size={20} className="text-[var(--muted)]" />
        {t("title")}
      </h1>

      <TimeTracker wid={wid} onStopped={() => setRefreshKey((k) => k + 1)} />

      {/* 标签页切换 */}
      <div className="flex items-center gap-1 border-b border-[var(--border)]">
        <button
          onClick={() => setTab("list")}
          className={`inline-flex items-center gap-1.5 h-9 px-3 text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] border-b-2 transition-colors duration-[var(--motion-fast)] ${
            tab === "list"
              ? "border-[var(--accent)] text-[var(--fg)]"
              : "border-transparent text-[var(--muted)] hover:text-[var(--fg-2)]"
          }`}
        >
          <List size={14} />
          {t("entry")}
        </button>
        <button
          onClick={() => setTab("report")}
          className={`inline-flex items-center gap-1.5 h-9 px-3 text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] border-b-2 transition-colors duration-[var(--motion-fast)] ${
            tab === "report"
              ? "border-[var(--accent)] text-[var(--fg)]"
              : "border-transparent text-[var(--muted)] hover:text-[var(--fg-2)]"
          }`}
        >
          <BarChart3 size={14} />
          {t("report")}
        </button>
      </div>

      {tab === "list" ? (
        <TimeEntryList wid={wid} refreshKey={refreshKey} />
      ) : (
        <TimeReport wid={wid} refreshKey={refreshKey} />
      )}
    </div>
  );
}