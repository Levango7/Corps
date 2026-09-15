"use client";

/**
 * AI 个性化面板（方向 F）
 *
 * 功能：
 *  - 展示个性化推荐列表（description / suggestion / reason / score）
 *  - 采纳/拒绝按钮（PATCH /api/v1/ai/personalization/recommendations/[id]）
 *  - 生成新推荐按钮（POST /api/v1/ai/personalization/generate）
 *  - 行为统计图表（BehaviorStats）
 *  - 空数据态、加载态、错误态
 *
 * 数据来源：
 *  - GET /api/v1/ai/personalization/recommendations?wid=...
 *  - GET /api/v1/ai/personalization/behaviors?wid=... （聚合后传给 BehaviorStats）
 *  - POST /api/v1/ai/personalization/generate
 *  - PATCH /api/v1/ai/personalization/recommendations/[id]
 *
 * 样式：design token（var(--*)），lucide-react 图标 size 14/16
 * i18n：useTranslations("ai.aiPersonalization")
 *
 * 来源：方向 F 任务 5（PersonalizationPanel.tsx）
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Sparkles,
  Check,
  X,
  RefreshCw,
  Lightbulb,
  TrendingUp,
} from "lucide-react";
import { api } from "@/lib/api";
import { BehaviorStats, type CapabilityStat } from "./BehaviorStats";

interface PersonalizationPanelProps {
  /** 工作区 ID */
  wid: string;
}

/** 推荐记录（对应 AiPersonalization 模型） */
interface Recommendation {
  id: string;
  type: string;
  content: {
    description?: string;
    suggestion?: string;
    reason?: string;
  };
  score: number;
  applied: boolean;
  createdAt: string;
}

/** 行为记录（对应 AiUserBehavior 模型，用于聚合统计） */
interface Behavior {
  id: string;
  action: string;
  capability: string;
  createdAt: string;
}

/** 推荐类型 → i18n label 映射 */
function typeLabel(type: string, t: (key: string) => string): string {
  switch (type) {
    case "capability_recommendation":
      return t("capability");
    case "prompt_optimization":
      return t("suggestion");
    case "workflow_suggestion":
      return t("workflow_suggestion");
    default:
      return type;
  }
}

/** 聚合行为数据为 CapabilityStat[]（与 behavior-tracker.ts getBehaviorStats 逻辑一致） */
function aggregateStats(behaviors: Behavior[]): {
  capabilities: CapabilityStat[];
  totalBehaviors: number;
} {
  const statsMap = new Map<
    string,
    {
      useCount: number;
      acceptCount: number;
      rejectCount: number;
      editCount: number;
    }
  >();

  for (const b of behaviors) {
    let stat = statsMap.get(b.capability);
    if (!stat) {
      stat = { useCount: 0, acceptCount: 0, rejectCount: 0, editCount: 0 };
      statsMap.set(b.capability, stat);
    }
    switch (b.action) {
      case "use_capability":
        stat.useCount += 1;
        break;
      case "accept_suggestion":
        stat.acceptCount += 1;
        break;
      case "reject_suggestion":
        stat.rejectCount += 1;
        break;
      case "edit_output":
        stat.editCount += 1;
        break;
    }
  }

  const capabilities: CapabilityStat[] = [...statsMap.entries()]
    .map(([capability, stat]) => {
      const total =
        stat.useCount + stat.acceptCount + stat.rejectCount + stat.editCount;
      const denom = stat.acceptCount + stat.rejectCount;
      return {
        capability,
        total,
        useCount: stat.useCount,
        acceptCount: stat.acceptCount,
        rejectCount: stat.rejectCount,
        editCount: stat.editCount,
        acceptRate: denom === 0 ? 0 : stat.acceptCount / denom,
        rejectRate: denom === 0 ? 0 : stat.rejectCount / denom,
      };
    })
    .sort((a, b) => b.total - a.total);

  return { capabilities, totalBehaviors: behaviors.length };
}

export function PersonalizationPanel({ wid }: PersonalizationPanelProps) {
  const t = useTranslations("ai.aiPersonalization");

  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [behaviors, setBehaviors] = useState<Behavior[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AbortController：组件卸载时中止进行中的请求
  const abortRef = useRef<AbortController | null>(null);

  /** 加载推荐列表 + 行为历史 */
  const loadData = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoading(true);
    setError(null);
    try {
      const [recsResult, behsResult] = await Promise.all([
        api<{ recommendations: Recommendation[] }>(
          `/api/v1/ai/personalization/recommendations?wid=${wid}`,
          { signal: ac.signal },
        ),
        api<{ behaviors: Behavior[] }>(
          `/api/v1/ai/personalization/behaviors?wid=${wid}&limit=500`,
          { signal: ac.signal },
        ),
      ]);
      if (ac.signal.aborted) return;
      setRecommendations(recsResult.recommendations ?? []);
      setBehaviors(behsResult.behaviors ?? []);
    } catch (e) {
      if (ac.signal.aborted) return;
      if (e instanceof Error && e.name === "AbortError") return;
      setError(t("loadFailed"));
      if (process.env.NODE_ENV === "development") {
        console.error("[PersonalizationPanel] loadData error:", e);
      }
    } finally {
      if (!ac.signal.aborted) {
        setLoading(false);
      }
    }
  }, [wid, t]);

  useEffect(() => {
    void loadData();
    return () => abortRef.current?.abort();
  }, [loadData]);

  /** 生成新推荐 */
  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const result = await api<{ recommendations: Recommendation[] }>(
        "/api/v1/ai/personalization/generate",
        {
          method: "POST",
          body: JSON.stringify({ wid, type: "capability_recommendation" }),
        },
      );
      // 将新生成的推荐 prepend 到列表顶部
      setRecommendations((prev) => [
        ...(result.recommendations ?? []),
        ...prev,
      ]);
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setError(t("error"));
      if (process.env.NODE_ENV === "development") {
        console.error("[PersonalizationPanel] generate error:", e);
      }
    } finally {
      setGenerating(false);
    }
  }, [wid, t]);

  /** 标记推荐已采纳/拒绝 */
  const handleMark = useCallback(
    async (id: string, applied: boolean) => {
      // 乐观更新：先改本地状态
      setRecommendations((prev) =>
        prev.map((r) => (r.id === id ? { ...r, applied } : r)),
      );
      try {
        await api(
          `/api/v1/ai/personalization/recommendations/${id}`,
          {
            method: "PATCH",
            body: JSON.stringify({ wid, applied }),
          },
        );
        // 标记成功后重新加载行为统计（采纳/拒绝行为已记录）
        // 不阻塞 UI，后台静默刷新
        void loadData();
      } catch (e) {
        // 回滚乐观更新
        setRecommendations((prev) =>
          prev.map((r) => (r.id === id ? { ...r, applied: !applied } : r)),
        );
        setError(t("error"));
        if (process.env.NODE_ENV === "development") {
          console.error("[PersonalizationPanel] mark error:", e);
        }
      }
    },
    [wid, t, loadData],
  );

  // 聚合行为统计
  const { capabilities, totalBehaviors } = aggregateStats(behaviors);

  // 加载态
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--surface)]">
        <div className="text-[length:var(--text-sm)] text-[var(--muted)]">
          {t("generating")}
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex h-full flex-col gap-[var(--space-4)] overflow-y-auto bg-[var(--surface)] px-[var(--space-5)] py-[var(--space-4)]"
      aria-label={t("title")}
    >
      {/* 标题 + 生成按钮 */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-[var(--space-2)]">
          <Sparkles size={16} className="text-[var(--accent)]" />
          <h1 className="text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
            {t("title")}
          </h1>
        </div>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className="inline-flex items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] bg-[var(--accent)] px-[var(--space-3)] py-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--accent-fg)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:opacity-50"
        >
          <RefreshCw size={14} className={generating ? "animate-spin" : ""} />
          <span>{generating ? t("generating") : t("generate")}</span>
        </button>
      </header>

      {/* 错误提示 */}
      {error && (
        <div className="rounded-[var(--radius-sm)] border border-[var(--danger)] bg-[var(--danger-soft)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--danger)]">
          {error}
        </div>
      )}

      {/* 行为统计图表 */}
      <BehaviorStats
        capabilities={capabilities}
        totalBehaviors={totalBehaviors}
      />

      {/* 推荐列表 */}
      <section className="flex flex-col gap-[var(--space-3)]">
        <div className="flex items-center gap-[var(--space-2)]">
          <Lightbulb size={16} className="text-[var(--accent)]" />
          <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
            {t("recommendations")}
          </span>
          <span className="ml-auto text-[length:var(--text-xs)] text-[var(--muted)]">
            {recommendations.length}
          </span>
        </div>

        {recommendations.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] py-[var(--space-8)]"
            role="img"
            aria-label={t("noRecommendations")}
          >
            <Sparkles size={16} className="text-[var(--muted)]" />
            <span className="text-[length:var(--text-sm)] text-[var(--muted)]">
              {t("noRecommendations")}
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-[var(--space-3)]">
            {recommendations.map((rec) => (
              <RecommendationCard
                key={rec.id}
                recommendation={rec}
                onMark={handleMark}
                typeLabel={typeLabel(rec.type, t)}
                t={t}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** 推荐卡片 */
function RecommendationCard({
  recommendation,
  onMark,
  typeLabel,
  t,
}: {
  recommendation: Recommendation;
  onMark: (id: string, applied: boolean) => void;
  typeLabel: string;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const { id, content, score, applied } = recommendation;
  const description = content.description ?? "";
  const suggestion = content.suggestion ?? "";
  const reason = content.reason ?? "";

  return (
    <div
      className={`rounded-[var(--radius-md)] border bg-[var(--surface-2)] px-[var(--space-4)] py-[var(--space-3)] transition-colors duration-[var(--motion-fast)] ${
        applied
          ? "border-[var(--success)] bg-[var(--success-soft)]"
          : "border-[var(--border)]"
      }`}
    >
      {/* 头部：类型 + 分数 + 操作按钮 */}
      <div className="mb-[var(--space-2)] flex items-center justify-between">
        <div className="flex items-center gap-[var(--space-2)]">
          <span className="rounded-[var(--radius-pill)] bg-[var(--surface-3)] px-[var(--space-2)] py-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--fg-2)]">
            {typeLabel}
          </span>
          <span className="inline-flex items-center gap-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--muted)]">
            <TrendingUp size={14} className="text-[var(--accent)]" />
            {t("score")}: {score.toFixed(2)}
          </span>
        </div>

        {/* 采纳/拒绝按钮（已 applied 时仅显示已采纳状态） */}
        {!applied ? (
          <div className="flex items-center gap-[var(--space-1)]">
            <button
              type="button"
              onClick={() => onMark(id, true)}
              aria-label={t("acceptSuggestion")}
              className="inline-flex items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-[var(--space-2)] py-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--fg-2)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            >
              <Check size={14} className="text-[var(--success)]" />
              <span>{t("applied")}</span>
            </button>
            <button
              type="button"
              onClick={() => onMark(id, false)}
              aria-label={t("rejectSuggestion")}
              className="inline-flex items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-[var(--space-2)] py-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--fg-2)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            >
              <X size={14} className="text-[var(--danger)]" />
              <span>{t("rejected")}</span>
            </button>
          </div>
        ) : (
          <span className="inline-flex items-center gap-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--success)]">
            <Check size={14} />
            <span>{t("applied")}</span>
          </span>
        )}
      </div>

      {/* 描述 */}
      {description && (
        <p className="mb-[var(--space-1)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
          {description}
        </p>
      )}

      {/* 建议 */}
      {suggestion && (
        <p className="mb-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--fg-2)]">
          {suggestion}
        </p>
      )}

      {/* 理由 */}
      {reason && (
        <p className="text-[length:var(--text-xs)] text-[var(--muted)]">
          <span className="font-[weight:var(--weight-medium)]">{t("reason")}: </span>
          {reason}
        </p>
      )}
    </div>
  );
}

export default PersonalizationPanel;