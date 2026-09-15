"use client";

// 设置 - 数据导出区：CSV 导出任务 + 决策。
// 拆分自 settings/page.tsx 第 816-849 行 + 相关状态/函数。子组件自管状态。

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import {
  exportTasksCsv,
  exportDecisionsCsv,
  type CsvTask,
  type CsvDecision,
} from "@/lib/csv-export";

const sectionClass =
  "bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] p-4 sm:p-5";

interface SettingsDataExportProps {
  wid: string;
  wsSlug: string;
  onError: (msg: string) => void;
}

export function SettingsDataExport({ wid, wsSlug, onError }: SettingsDataExportProps) {
  const tExport = useTranslations("export");

  const [exportingTasks, setExportingTasks] = useState(false);
  const [exportingDecisions, setExportingDecisions] = useState(false);

  // CSV 导出：拉取任务列表并导出
  async function handleExportTasks() {
    if (exportingTasks) return;
    setExportingTasks(true);
    onError("");
    try {
      const resp = await api<{ items: CsvTask[]; total: number; hasMore: boolean }>(`/api/v1/workspaces/${wid}/tasks`);
      exportTasksCsv(resp.items, wsSlug);
    } catch (e) {
      onError(e instanceof Error ? e.message : tExport("tasksFailed"));
    } finally {
      setExportingTasks(false);
    }
  }

  // CSV 导出：拉取决策列表并导出
  async function handleExportDecisions() {
    if (exportingDecisions) return;
    setExportingDecisions(true);
    onError("");
    try {
      const resp = await api<{ items: CsvDecision[]; total: number; hasMore: boolean }>(`/api/v1/workspaces/${wid}/decisions`);
      exportDecisionsCsv(resp.items, wsSlug);
    } catch (e) {
      onError(e instanceof Error ? e.message : tExport("decisionsFailed"));
    } finally {
      setExportingDecisions(false);
    }
  }

  return (
    <section className={`${sectionClass} mt-5`}>
      <h2 className="flex items-center gap-2 text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)] mb-1">
        <Download size={16} className="text-[var(--muted)]" />
        {tExport("title")}
      </h2>
      <p className="text-[length:var(--text-xs)] text-[var(--meta)] mb-4">{tExport("hint")}</p>
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={handleExportTasks}
          disabled={exportingTasks}
          className="w-full sm:w-auto h-9 px-4 border border-[var(--border)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
        >
          {exportingTasks ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Download size={15} />
          )}
          {tExport("tasks")}
        </button>
        <button
          onClick={handleExportDecisions}
          disabled={exportingDecisions}
          className="w-full sm:w-auto h-9 px-4 border border-[var(--border)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
        >
          {exportingDecisions ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Download size={15} />
          )}
          {tExport("decisions")}
        </button>
      </div>
    </section>
  );
}