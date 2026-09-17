"use client";

/**
 * TaskSummaryWidget — 任务摘要卡片 Widget。
 *
 * 职责：
 * - 调用 /api/v1/workspaces/{wid}/analytics/overview 拉取工作区分析概览
 * - 显示任务总数 / 已完成 / 进行中 / 逾期 四项统计
 * - 圆环进度图（纯 SVG，不依赖 chart.js，避免 jsdom canvas 兼容问题）
 * - 数字统计网格
 * - 所有样式走 design token（var(--*)），无裸 hex
 * - lucide-react 图标 size 14/16
 *
 * 数据容错：analytics/overview 返回结构以事件分析为主，本组件宽容提取
 * 任务统计字段（todo / in_progress / review / done / total / overdue），
 * 缺失字段回退为 0，保证组件永不崩溃。
 *
 * 用法：
 *   <TaskSummaryWidget wid={wid} />
 */

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Clock, AlertCircle, ListTodo } from "lucide-react";
import { api } from "@/lib/api";

/** analytics/overview 响应中可能携带的任务统计字段（宽容类型） */
interface TaskStatsPayload {
  todo?: number;
  in_progress?: number;
  inProgress?: number;
  review?: number;
  done?: number;
  total?: number;
  overdue?: number;
  /** 兼容嵌套结构 */
  taskStats?: TaskStatsPayload;
}

/** 统一归一化后的任务统计 */
interface TaskStats {
  total: number;
  done: number;
  inProgress: number;
  overdue: number;
}

interface TaskSummaryWidgetProps {
  /** 工作区 ID */
  wid: string;
}

/** 从宽容 payload 提取并归一化任务统计（缺失字段回退 0） */
function normalizeStats(payload: TaskStatsPayload | null | undefined): TaskStats {
  const p = payload?.taskStats ?? payload ?? {};
  const inProgress = p.in_progress ?? p.inProgress ?? 0;
  const done = p.done ?? 0;
  const total = p.total ?? (p.todo ?? 0) + inProgress + (p.review ?? 0) + done;
  const overdue = p.overdue ?? 0;
  return { total, done, inProgress, overdue };
}

/** 圆环进度图（纯 SVG）—— 完成率 = done / total */
function ProgressRing({
  percent,
  size = 72,
}: {
  percent: number;
  size?: number;
}) {
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  // 限制 0~100，避免负值或溢出
  const clamped = Math.max(0, Math.min(100, percent));
  const offset = circumference * (1 - clamped / 100);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`完成率 ${Math.round(clamped)}%`}
    >
      {/* 背景轨道 */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--surface-3)"
        strokeWidth={stroke}
      />
      {/* 进度弧 */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{
          transition: `stroke-dashoffset var(--motion-slow) var(--ease-out)`,
        }}
      />
      {/* 中心百分比文字 */}
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        fontSize="14"
        fontWeight="var(--weight-semibold)"
        fill="var(--fg)"
      >
        {Math.round(clamped)}%
      </text>
    </svg>
  );
}

/** 统计项：图标 + 标签 + 数值 */
function StatItem({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof CheckCircle2;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="flex items-center gap-[var(--space-2)]">
      <Icon size={14} className="shrink-0" style={{ color }} aria-hidden />
      <div className="flex flex-col">
        <span
          className="text-[length:var(--text-xs)] text-[var(--muted)]"
        >
          {label}
        </span>
        <span
          className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]"
        >
          {value}
        </span>
      </div>
    </div>
  );
}

export default function TaskSummaryWidget({ wid }: TaskSummaryWidgetProps) {
  const [stats, setStats] = useState<TaskStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const payload = await api<TaskStatsPayload>(
        `/api/v1/workspaces/${wid}/analytics/overview`,
      );
      setStats(normalizeStats(payload));
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [wid]);

  useEffect(() => {
    load();
  }, [load]);

  // 骨架屏
  if (loading) {
    return (
      <div
        className="flex items-center gap-[var(--space-3)] p-[var(--space-3)]"
        aria-busy="true"
        aria-label="加载任务摘要"
      >
        <span className="h-[72px] w-[72px] rounded-full bg-[var(--surface-3)] animate-pulse" />
        <div className="flex-1 grid grid-cols-2 gap-[var(--space-2)]">
          {Array.from({ length: 4 }).map((_, i) => (
            <span
              key={i}
              className="h-8 rounded-[var(--radius-sm)] bg-[var(--surface-3)] animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  // 错误态：显示 0 占位，不崩溃
  const { total, done, inProgress, overdue } = stats ?? {
    total: 0,
    done: 0,
    inProgress: 0,
    overdue: 0,
  };
  const percent = total > 0 ? (done / total) * 100 : 0;

  return (
    <div
      className="flex flex-col gap-[var(--space-3)] p-[var(--space-3)]"
      role="status"
      aria-live="polite"
    >
      {/* 圆环 + 总数 */}
      <div className="flex items-center gap-[var(--space-4)]">
        <ProgressRing percent={percent} />
        <div className="flex flex-col">
          <span className="text-[length:var(--text-xs)] text-[var(--muted)]">
            任务总数
          </span>
          <span className="text-[length:var(--text-2xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
            {total}
          </span>
          {error && (
            <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
              数据加载失败
            </span>
          )}
        </div>
      </div>

      {/* 统计网格 */}
      <div className="grid grid-cols-2 gap-[var(--space-3)]">
        <StatItem
          icon={CheckCircle2}
          label="已完成"
          value={done}
          color="var(--success)"
        />
        <StatItem
          icon={Clock}
          label="进行中"
          value={inProgress}
          color="var(--accent)"
        />
        <StatItem
          icon={ListTodo}
          label="待处理"
          value={Math.max(0, total - done - inProgress)}
          color="var(--muted)"
        />
        <StatItem
          icon={AlertCircle}
          label="逾期"
          value={overdue}
          color="var(--danger)"
        />
      </div>
    </div>
  );
}