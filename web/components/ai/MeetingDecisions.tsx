"use client";

/**
 * 会议决策列表组件（方向 G 实时会议 AI）。
 *
 * 功能：
 *  - 展示 AI 从会议转录中提取的决策
 *  - 每条决策显示：内容、参与者、上下文、状态
 *  - 支持状态切换：proposed → confirmed / rejected
 *
 * 样式全走 design token（var(--*)），lucide-react 图标尺寸 14/16。
 * 错误处理：catch 中用 t("error")，不泄露 e.message。
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, XCircle, Circle, Users, Loader2, AlertCircle, Gavel } from "lucide-react";
import { api } from "@/lib/api";

/** 决策类型（与 Prisma AiMeetingDecision 对齐） */
interface Decision {
  id: string;
  content: string;
  context: string | null;
  participants: unknown;
  status: string;
  createdAt: string;
}

/** MeetingDecisions Props */
interface MeetingDecisionsProps {
  /** 工作区 ID */
  wid: string;
  /** 会议会话 ID */
  sessionId: string;
}

export function MeetingDecisions({ wid, sessionId }: MeetingDecisionsProps) {
  const t = useTranslations("ai.aiMeeting");

  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  /** 加载决策列表 */
  const loadDecisions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<Decision[]>(
        `/api/v1/ai/meetings/sessions/${sessionId}/decisions?wid=${encodeURIComponent(wid)}`,
      );
      setDecisions(data);
    } catch (e) {
      if (process.env.NODE_ENV === "development")
        console.error("[MeetingDecisions] load failed:", e);
      setError(t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [wid, sessionId, t]);

  useEffect(() => {
    loadDecisions();
  }, [loadDecisions]);

  /** 更新决策状态 */
  const handleUpdateStatus = useCallback(
    async (decision: Decision, status: "confirmed" | "rejected") => {
      setUpdatingId(decision.id);
      try {
        await api(`/api/v1/ai/meetings/sessions/${sessionId}/decisions`, {
          method: "PATCH",
          body: JSON.stringify({ wid, decisionId: decision.id, status }),
        });
        setDecisions((prev) => prev.map((d) => (d.id === decision.id ? { ...d, status } : d)));
      } catch (e) {
        if (process.env.NODE_ENV === "development")
          console.error("[MeetingDecisions] update failed:", e);
        setError(t("error"));
      } finally {
        setUpdatingId(null);
      }
    },
    [wid, sessionId, t],
  );

  /** 格式化参与者列表 */
  const formatParticipants = useCallback((participants: unknown): string => {
    if (!Array.isArray(participants)) return "";
    return participants.filter((p) => typeof p === "string").join(", ");
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-[var(--space-4)] text-[var(--meta)] text-[length:var(--text-sm)]">
        <Loader2 size={16} className="animate-spin mr-2 motion-reduce:animate-none" />
        {t("loading")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 px-[var(--space-3)] py-[var(--space-2)] rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-sm)]">
        <AlertCircle size={14} className="shrink-0 mt-0.5" />
        <span className="flex-1">{error}</span>
      </div>
    );
  }

  if (decisions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-[var(--space-2)] py-[var(--space-6)] text-center">
        <Gavel size={24} className="text-[var(--meta)]" />
        <p className="text-[length:var(--text-sm)] text-[var(--meta)]">{t("noDecisions")}</p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-[var(--space-2)]">
      {decisions.map((decision) => (
        <li
          key={decision.id}
          className={`rounded-[var(--radius-md)] border px-[var(--space-3)] py-[var(--space-3)] transition-colors ${
            decision.status === "rejected"
              ? "border-[var(--border-soft)] bg-[var(--surface)] opacity-40"
              : decision.status === "confirmed"
                ? "border-[var(--success)] bg-[var(--surface)]"
                : "border-[var(--border)] bg-[var(--surface)]"
          }`}
        >
          <div className="flex items-start gap-[var(--space-2)]">
            {/* 状态图标 */}
            <div className="shrink-0 mt-0.5">
              {decision.status === "confirmed" ? (
                <CheckCircle2 size={16} className="text-[var(--success)]" />
              ) : decision.status === "rejected" ? (
                <XCircle size={16} className="text-[var(--danger)]" />
              ) : (
                <Circle size={16} className="text-[var(--meta)]" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              {/* 决策内容 */}
              <p className="text-[length:var(--text-sm)] text-[var(--fg)]">{decision.content}</p>

              {/* 上下文 */}
              {decision.context && (
                <p className="mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--fg-2)]">
                  {decision.context}
                </p>
              )}

              {/* 参与者 */}
              {formatParticipants(decision.participants) && (
                <div className="mt-[var(--space-1)] inline-flex items-center gap-1 text-[length:var(--text-xs)] text-[var(--meta)]">
                  <Users size={14} />
                  {formatParticipants(decision.participants)}
                </div>
              )}

              {/* 状态切换按钮（仅 proposed 状态显示） */}
              {decision.status === "proposed" && (
                <div className="mt-[var(--space-2)] flex items-center gap-[var(--space-2)]">
                  <button
                    type="button"
                    onClick={() => handleUpdateStatus(decision, "confirmed")}
                    disabled={updatingId === decision.id}
                    className="inline-flex items-center gap-1 h-7 px-2 rounded-[var(--radius-sm)] bg-[var(--success)] text-[var(--accent-fg)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] transition-colors hover:opacity-90 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                  >
                    {updatingId === decision.id ? (
                      <Loader2 size={14} className="animate-spin motion-reduce:animate-none" />
                    ) : (
                      <CheckCircle2 size={14} />
                    )}
                    {t("confirm")}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleUpdateStatus(decision, "rejected")}
                    disabled={updatingId === decision.id}
                    className="inline-flex items-center gap-1 h-7 px-2 rounded-[var(--radius-sm)] border border-[var(--border)] text-[var(--fg-2)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] transition-colors hover:bg-[var(--surface-2)] disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                  >
                    <XCircle size={14} />
                    {t("reject")}
                  </button>
                </div>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
