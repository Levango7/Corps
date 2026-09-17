"use client";

/**
 * AI 主动推送设置组件（方向 A）
 *
 * 功能：
 *  - 展示推送计划列表，支持创建/编辑/删除/启停
 *  - 每个计划显示 capability 名称、cron 表达式、启用状态、最后运行时间
 *  - 创建表单：选择 capability（下拉）、cron 表达式（输入）、启用（开关）
 *  - 支持手动触发推送（调用 trigger API）
 *
 * 样式全走 design token（var(--*)），lucide-react 图标尺寸 14/16。
 * 错误处理：catch 中用 t("error") / t("loadFailed")，不泄露 e.message。
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Bell,
  Plus,
  Trash2,
  Power,
  Loader2,
  Zap,
  Clock,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/format";

/** 推送计划类型（与 Prisma AiPushSchedule 对齐） */
interface PushSchedule {
  id: string;
  workspaceId: string;
  userId: string;
  capability: string;
  cron: string;
  enabled: boolean;
  config: unknown;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 推送能力选项 */
const CAPABILITY_OPTIONS = [
  { value: "daily_briefing", labelKey: "dailyBriefing" },
  { value: "risk_alert", labelKey: "riskAlert" },
  { value: "progress_anomaly", labelKey: "progressAnomaly" },
] as const;

interface AiPushSettingsProps {
  /** 工作区 ID */
  wid: string;
}

export function AiPushSettings({ wid }: AiPushSettingsProps) {
  const t = useTranslations("aiPush");
  const tTime = useTranslations("time");

  const [schedules, setSchedules] = useState<PushSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // 创建表单状态
  const [formCapability, setFormCapability] = useState("daily_briefing");
  const [formCron, setFormCron] = useState("0 9 * * 1-5");
  const [formEnabled, setFormEnabled] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  /** 加载推送计划列表 */
  const loadSchedules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<PushSchedule[]>(
        `/api/v1/ai/push/schedules?wid=${encodeURIComponent(wid)}`,
      );
      setSchedules(data);
    } catch (e) {
      console.error("[AiPushSettings] load failed:", e);
      setError(t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [wid, t]);

  useEffect(() => {
    loadSchedules();
  }, [loadSchedules]);

  /** 创建推送计划 */
  const handleCreate = useCallback(async () => {
    setFormError(null);
    setActionLoading("create");
    try {
      await api("/api/v1/ai/push/schedules", {
        method: "POST",
        body: JSON.stringify({
          wid,
          capability: formCapability,
          cron: formCron,
          enabled: formEnabled,
        }),
      });
      setShowCreate(false);
      await loadSchedules();
    } catch (e) {
      console.error("[AiPushSettings] create failed:", e);
      setFormError(t("error"));
    } finally {
      setActionLoading(null);
    }
  }, [wid, formCapability, formCron, formEnabled, loadSchedules, t]);

  /** 切换计划启用状态 */
  const handleToggle = useCallback(
    async (schedule: PushSchedule) => {
      setActionLoading(`toggle-${schedule.id}`);
      try {
        await api(`/api/v1/ai/push/schedules/${schedule.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            wid,
            enabled: !schedule.enabled,
          }),
        });
        await loadSchedules();
      } catch (e) {
        console.error("[AiPushSettings] toggle failed:", e);
        setError(t("error"));
      } finally {
        setActionLoading(null);
      }
    },
    [wid, loadSchedules, t],
  );

  /** 删除推送计划 */
  const handleDelete = useCallback(
    async (schedule: PushSchedule) => {
      setActionLoading(`delete-${schedule.id}`);
      try {
        await api(
          `/api/v1/ai/push/schedules/${schedule.id}?wid=${encodeURIComponent(wid)}`,
          { method: "DELETE" },
        );
        await loadSchedules();
      } catch (e) {
        console.error("[AiPushSettings] delete failed:", e);
        setError(t("error"));
      } finally {
        setActionLoading(null);
      }
    },
    [wid, loadSchedules, t],
  );

  /** 手动触发推送 */
  const handleTrigger = useCallback(
    async (schedule: PushSchedule) => {
      setActionLoading(`trigger-${schedule.id}`);
      try {
        await api("/api/v1/ai/push/trigger", {
          method: "POST",
          body: JSON.stringify({
            wid,
            capability: schedule.capability,
            scheduleId: schedule.id,
          }),
        });
      } catch (e) {
        console.error("[AiPushSettings] trigger failed:", e);
        setError(t("error"));
      } finally {
        setActionLoading(null);
      }
    },
    [wid, t],
  );

  /** 获取 capability 显示名称 */
  const capabilityLabel = useCallback(
    (cap: string): string => {
      const opt = CAPABILITY_OPTIONS.find((o) => o.value === cap);
      return opt ? t(opt.labelKey) : cap;
    },
    [t],
  );

  /** 格式化最后运行时间（走共享 relativeTime，i18n 经 time 命名空间） */
  const formatLastRun = useCallback(
    (lastRunAt: string | null): string => {
      if (!lastRunAt) return "—";
      return relativeTime(lastRunAt, tTime) ?? "—";
    },
    [tTime],
  );

  return (
    <div className="flex h-full flex-col">
      {/* 顶部标题栏 */}
      <header className="flex items-center gap-[var(--space-3)] border-b border-[var(--border)] px-[var(--space-6)] py-[var(--space-4)]">
        <Bell size={16} className="text-[var(--accent)]" />
        <h1 className="text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
          {t("settings")}
        </h1>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="ml-auto inline-flex items-center gap-[var(--space-2)] rounded-[var(--radius-md)] bg-[var(--accent)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--on-accent)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
        >
          <Plus size={14} />
          {t("create")}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-[var(--space-6)] py-[var(--space-4)]">
        {error && (
          <div className="mb-[var(--space-4)] rounded-[var(--radius-md)] border border-[var(--danger)] bg-[var(--danger-soft)] px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--danger)]">
            {error}
          </div>
        )}

        {/* 创建表单 */}
        {showCreate && (
          <div className="mb-[var(--space-4)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-5)] py-[var(--space-4)]">
            <div className="mb-[var(--space-3)] flex items-center justify-between">
              <h2 className="text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
                {t("create")}
              </h2>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="rounded-[var(--radius-sm)] p-[var(--space-1)] text-[var(--fg-2)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-2)]"
              >
                <X size={14} />
              </button>
            </div>

            <div className="flex flex-col gap-[var(--space-3)]">
              {/* capability 选择 */}
              <label className="flex flex-col gap-[var(--space-1)]">
                <span className="text-[length:var(--text-xs)] text-[var(--fg-2)]">
                  {t("capability")}
                </span>
                <select
                  value={formCapability}
                  onChange={(e) => setFormCapability(e.target.value)}
                  className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--fg)] transition-colors duration-[var(--motion-fast)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
                >
                  {CAPABILITY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {t(opt.labelKey)}
                    </option>
                  ))}
                </select>
              </label>

              {/* cron 表达式 */}
              <label className="flex flex-col gap-[var(--space-1)]">
                <span className="text-[length:var(--text-xs)] text-[var(--fg-2)]">
                  {t("cron")}
                </span>
                <input
                  type="text"
                  value={formCron}
                  onChange={(e) => setFormCron(e.target.value)}
                  placeholder="0 9 * * 1-5"
                  className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-2)] font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] text-[var(--fg)] transition-colors duration-[var(--motion-fast)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
                />
              </label>

              {/* 启用开关 */}
              <label className="flex items-center gap-[var(--space-2)]">
                <input
                  type="checkbox"
                  checked={formEnabled}
                  onChange={(e) => setFormEnabled(e.target.checked)}
                  className="h-4 w-4 rounded-[var(--radius-sm)] border-[var(--border)] accent-[var(--accent)]"
                />
                <span className="text-[length:var(--text-sm)] text-[var(--fg)]">
                  {t("enabled")}
                </span>
              </label>

              {formError && (
                <p className="text-[length:var(--text-xs)] text-[var(--danger)]">
                  {formError}
                </p>
              )}

              <button
                type="button"
                onClick={handleCreate}
                disabled={actionLoading === "create" || !formCron.trim()}
                className="inline-flex items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] bg-[var(--accent)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--on-accent)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {actionLoading === "create" ? (
                  <Loader2 size={14} className="animate-spin motion-reduce:animate-none" />
                ) : (
                  <Plus size={14} />
                )}
                {t("create")}
              </button>
            </div>
          </div>
        )}

        {/* 计划列表 */}
        {loading ? (
          <div className="flex items-center justify-center py-[var(--space-8)]">
            <Loader2 size={20} className="animate-spin text-[var(--meta)] motion-reduce:animate-none" />
          </div>
        ) : schedules.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-[var(--space-2)] py-[var(--space-8)] text-center">
            <Bell size={24} className="text-[var(--meta)]" />
            <p className="text-[length:var(--text-sm)] text-[var(--meta)]">
              {t("noRecords")}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-[var(--space-3)]">
            {schedules.map((schedule) => (
              <li
                key={schedule.id}
                className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-5)] py-[var(--space-4)]"
              >
                <div className="flex items-center gap-[var(--space-3)]">
                  {/* 启用状态指示 */}
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${
                      schedule.enabled
                        ? "bg-[var(--success)]"
                        : "bg-[var(--meta)]"
                    }`}
                    aria-label={schedule.enabled ? t("enabled") : t("disabled")}
                  />

                  <div className="flex flex-col">
                    <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
                      {capabilityLabel(schedule.capability)}
                    </span>
                    <span className="flex items-center gap-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--fg-2)]">
                      <Clock size={14} className="text-[var(--meta)]" />
                      <code className="font-[family-name:var(--font-mono)]">
                        {schedule.cron}
                      </code>
                      <span className="text-[var(--meta)]">·</span>
                      <span>{formatLastRun(schedule.lastRunAt)}</span>
                    </span>
                  </div>

                  {/* 操作按钮组 */}
                  <div className="ml-auto flex items-center gap-[var(--space-1)]">
                    {/* 触发 */}
                    <button
                      type="button"
                      onClick={() => handleTrigger(schedule)}
                      disabled={actionLoading === `trigger-${schedule.id}`}
                      title={t("trigger")}
                      className="rounded-[var(--radius-sm)] p-[var(--space-2)] text-[var(--fg-2)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-2)] hover:text-[var(--accent)] disabled:opacity-40"
                    >
                      {actionLoading === `trigger-${schedule.id}` ? (
                        <Loader2 size={14} className="animate-spin motion-reduce:animate-none" />
                      ) : (
                        <Zap size={14} />
                      )}
                    </button>

                    {/* 启停 */}
                    <button
                      type="button"
                      onClick={() => handleToggle(schedule)}
                      disabled={actionLoading === `toggle-${schedule.id}`}
                      title={schedule.enabled ? t("disabled") : t("enabled")}
                      className="rounded-[var(--radius-sm)] p-[var(--space-2)] text-[var(--fg-2)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-2)] hover:text-[var(--accent)] disabled:opacity-40"
                    >
                      {actionLoading === `toggle-${schedule.id}` ? (
                        <Loader2 size={14} className="animate-spin motion-reduce:animate-none" />
                      ) : (
                        <Power size={14} />
                      )}
                    </button>

                    {/* 删除 */}
                    <button
                      type="button"
                      onClick={() => handleDelete(schedule)}
                      disabled={actionLoading === `delete-${schedule.id}`}
                      title={t("error")}
                      className="rounded-[var(--radius-sm)] p-[var(--space-2)] text-[var(--fg-2)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-2)] hover:text-[var(--danger)] disabled:opacity-40"
                    >
                      {actionLoading === `delete-${schedule.id}` ? (
                        <Loader2 size={14} className="animate-spin motion-reduce:animate-none" />
                      ) : (
                        <Trash2 size={14} />
                      )}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}