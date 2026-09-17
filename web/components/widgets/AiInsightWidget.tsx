"use client";

/**
 * AiInsightWidget — AI 洞察卡片 Widget（用于 WidgetGrid）。
 *
 * 职责：
 * - 调用 /api/v1/workspaces/{wid}/ai/insights 拉取 AI 助理生成的洞察
 * - API 不存在（404）或未启用时显示优雅占位（不报错）
 * - 每条洞察：AI 图标 + 标题 + 摘要 + 置信度
 * - 卡片样式 + Sparkles AI 图标
 * - 所有样式走 design token（var(--*)），无裸 hex
 * - lucide-react 图标 size 14/16
 *
 * 容错策略：
 * - 404 / 网络错误 → 显示"AI 洞察暂未启用"占位
 * - 空数据 → 显示"暂无洞察"空状态
 * - 永不抛出未捕获异常
 *
 * 用法：
 *   <AiInsightWidget wid={wid} />
 */

import { useCallback, useEffect, useState } from "react";
import { Sparkles, Lightbulb, TrendingUp, AlertTriangle } from "lucide-react";
import { api, ApiError } from "@/lib/api";

/** 单条 AI 洞察 */
interface AiInsight {
  id: string;
  title: string;
  summary: string;
  /** 洞察类型：opportunity（机会）/ risk（风险）/ trend（趋势）/ suggestion（建议） */
  type: "opportunity" | "risk" | "trend" | "suggestion";
  /** 置信度 0~1 */
  confidence?: number;
  createdAt: string;
}

/** ai/insights GET 响应 data */
interface AiInsightData {
  items: AiInsight[];
}

interface AiInsightWidgetProps {
  /** 工作区 ID */
  wid: string;
  /** 最多显示多少条洞察，默认 3 */
  limit?: number;
}

/** 洞察类型 → 图标 + 颜色映射 */
const INSIGHT_META: Record<
  AiInsight["type"],
  { icon: typeof Lightbulb; color: string; label: string }
> = {
  opportunity: { icon: TrendingUp, color: "var(--success)", label: "机会" },
  risk: { icon: AlertTriangle, color: "var(--danger)", label: "风险" },
  trend: { icon: TrendingUp, color: "var(--accent)", label: "趋势" },
  suggestion: { icon: Lightbulb, color: "var(--warn)", label: "建议" },
};

/** 置信度 → 文字标签 */
function confidenceLabel(confidence?: number): string {
  if (confidence === undefined) return "";
  if (confidence >= 0.8) return "高置信";
  if (confidence >= 0.5) return "中置信";
  return "低置信";
}

export default function AiInsightWidget({
  wid,
  limit = 3,
}: AiInsightWidgetProps) {
  const [data, setData] = useState<AiInsightData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notAvailable, setNotAvailable] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api<AiInsightData>(
        `/api/v1/workspaces/${wid}/ai/insights`,
      );
      setData(result);
      setNotAvailable(false);
      setError(false);
    } catch (err) {
      // 404 或 ApiError 404/501 → AI 洞察未启用，显示占位而非错误
      if (err instanceof ApiError && (err.status === 404 || err.status === 501)) {
        setNotAvailable(true);
      } else {
        setError(true);
      }
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
        className="flex flex-col gap-[var(--space-2)] p-[var(--space-3)]"
        aria-busy="true"
        aria-label="加载 AI 洞察"
      >
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col gap-[var(--space-1)]"
          >
            <span className="h-3 w-2/3 rounded bg-[var(--surface-3)] animate-pulse" />
            <span className="h-2 w-full rounded bg-[var(--surface-3)] animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  // AI 洞察未启用占位
  if (notAvailable) {
    return (
      <div
        className="flex flex-col items-center gap-[var(--space-2)] p-[var(--space-4)] text-center"
        role="status"
      >
        <Sparkles
          size={16}
          className="text-[var(--muted)]"
          aria-hidden
        />
        <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
          AI 洞察暂未启用
        </span>
        <span className="text-[length:var(--text-xs)] text-[var(--muted)]">
          启用 AI 助理后将自动生成工作区洞察
        </span>
      </div>
    );
  }

  // 错误态
  if (error && !data) {
    return (
      <div
        className="flex items-center gap-[var(--space-2)] p-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--muted)]"
        role="status"
        aria-live="polite"
      >
        <Sparkles size={14} aria-hidden />
        <span>洞察加载失败</span>
      </div>
    );
  }

  const items = (data?.items ?? []).slice(0, limit);

  // 空状态
  if (items.length === 0) {
    return (
      <div
        className="flex flex-col items-center gap-[var(--space-2)] p-[var(--space-4)] text-center"
      >
        <Sparkles
          size={16}
          className="text-[var(--muted)]"
          aria-hidden
        />
        <span className="text-[length:var(--text-sm)] text-[var(--muted)]">
          暂无 AI 洞察
        </span>
        <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
          AI 助理将在积累更多数据后生成洞察
        </span>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-[var(--space-2)] p-[var(--space-3)]"
      role="region"
      aria-label="AI 洞察"
    >
      {/* 头部：AI 图标 + 标题 */}
      <div className="flex items-center gap-[var(--space-2)]">
        <Sparkles
          size={14}
          className="text-[var(--accent)]"
          aria-hidden
        />
        <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
          AI 洞察
        </span>
      </div>

      {/* 洞察列表 */}
      <ul className="flex flex-col gap-[var(--space-2)]">
        {items.map((insight) => {
          const meta = INSIGHT_META[insight.type] ?? INSIGHT_META.suggestion;
          const Icon = meta.icon;
          const confLabel = confidenceLabel(insight.confidence);
          return (
            <li
              key={insight.id}
              className="flex flex-col gap-[var(--space-1)] rounded-[var(--radius-sm)] border border-[var(--border-soft)] bg-[var(--surface)] p-[var(--space-2)]"
            >
              <div className="flex items-center gap-[var(--space-2)]">
                <Icon
                  size={14}
                  className="shrink-0"
                  style={{ color: meta.color }}
                  aria-hidden
                />
                <span className="flex-1 truncate text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
                  {insight.title}
                </span>
                {/* 类型标签 */}
                <span
                  className="shrink-0 rounded-[var(--radius-pill)] px-[var(--space-1)] py-[0.5px] text-[length:var(--text-xs)]"
                  style={{
                    color: meta.color,
                    background: `color-mix(in srgb, ${meta.color} 12%, transparent)`,
                  }}
                >
                  {meta.label}
                </span>
              </div>
              {/* 摘要 */}
              <p className="text-[length:var(--text-xs)] leading-[var(--leading-normal)] text-[var(--muted)] line-clamp-2">
                {insight.summary}
              </p>
              {/* 置信度（如有） */}
              {confLabel && (
                <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
                  {confLabel}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}