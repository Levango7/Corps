"use client";

/**
 * 会议 AI 面板组件（方向 G 实时会议 AI）。
 *
 * 功能：
 *  - 创建会议会话（输入标题）
 *  - 会话列表（可选中切换）
 *  - 实时转录输入（说话人 + 内容）→ 提交片段
 *  - AI 分析按钮 → 提取行动项 + 决策 + 摘要
 *  - 分析结果展示：摘要 + 行动项列表 + 决策列表
 *
 * 交互流程：
 *  1. 左侧会话列表，右侧选中会话详情
 *  2. 选中会话后可输入转录片段并提交
 *  3. 点击「分析」调用 AI，结果展示在下方
 *
 * 样式全走 design token（var(--*)），lucide-react 图标尺寸 14/16。
 * 错误处理：catch 中用 t("error")，不泄露 e.message。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Video,
  Plus,
  Loader2,
  AlertCircle,
  X,
  Mic,
  Sparkles,
  Trash2,
  Clock,
  FileText,
  ListChecks,
  Gavel,
  Send,
} from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/Toast";
import { MeetingActionItems } from "./MeetingActionItems";
import { MeetingDecisions } from "./MeetingDecisions";

/** 会话列表项类型 */
interface SessionSummary {
  id: string;
  title: string;
  status: string;
  participantCount: number;
  startTime: string;
  endTime: string | null;
  createdAt: string;
}

/** 会话详情类型（含 transcript + summary） */
interface SessionDetail extends SessionSummary {
  transcript: unknown;
  summary: string | null;
}

/** 会话列表分页响应 */
interface SessionsListResponse {
  items: SessionSummary[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** 分析结果类型 */
interface AnalysisResult {
  summary: string;
  actionItems: unknown[];
  decisions: unknown[];
}

/** 输入框样式（design token） */
const fieldControl =
  "w-full px-2.5 py-2 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)]";

/** 状态标签颜色 */
function statusColor(status: string): string {
  switch (status) {
    case "active":
      return "text-[var(--success)]";
    case "paused":
      return "text-[var(--warning, var(--accent))]";
    case "ended":
      return "text-[var(--meta)]";
    default:
      return "text-[var(--meta)]";
  }
}

/** MeetingAiPanel Props */
interface MeetingAiPanelProps {
  /** 工作区 ID */
  wid: string;
}

export default function MeetingAiPanel({ wid }: MeetingAiPanelProps) {
  const t = useTranslations("ai.aiMeeting");
  const { toast } = useToast();

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // 创建会话
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);

  // 转录输入
  const [speaker, setSpeaker] = useState("");
  const [transcriptText, setTranscriptText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 分析
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisVersion, setAnalysisVersion] = useState(0);

  // AbortController
  const abortRef = useRef<AbortController | null>(null);

  /** 加载会话列表 */
  const loadSessions = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError("");
    try {
      const data = await api<SessionsListResponse>(
        `/api/v1/ai/meetings/sessions?wid=${encodeURIComponent(wid)}&limit=50`,
        { signal: ac.signal },
      );
      if (ac.signal.aborted) return;
      setSessions(data.items);
      if (data.items.length > 0 && !selectedId) {
        setSelectedId(data.items[0].id);
      }
    } catch (e) {
      if (ac.signal.aborted || (e instanceof Error && e.name === "AbortError")) return;
      if (process.env.NODE_ENV === "development")
        console.error("[MeetingAiPanel] loadSessions error:", e);
      setError(t("loadFailed"));
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [wid, selectedId, t]);

  useEffect(() => {
    loadSessions();
    return () => {
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wid]);

  /** 加载会话详情 */
  const loadDetail = useCallback(async () => {
    if (!selectedId) {
      setSessionDetail(null);
      return;
    }
    try {
      const data = await api<SessionDetail>(
        `/api/v1/ai/meetings/sessions/${selectedId}?wid=${encodeURIComponent(wid)}`,
      );
      setSessionDetail(data);
    } catch (e) {
      if (process.env.NODE_ENV === "development")
        console.error("[MeetingAiPanel] loadDetail error:", e);
      setError(t("loadFailed"));
    }
  }, [selectedId, wid, t]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  /** 创建新会话 */
  async function createSession() {
    if (creating || !newTitle.trim()) return;
    setCreating(true);
    setError("");
    try {
      const created = await api<SessionSummary>("/api/v1/ai/meetings/sessions", {
        method: "POST",
        body: JSON.stringify({ wid, title: newTitle.trim() }),
      });
      setSessions((prev) => [created, ...prev]);
      setSelectedId(created.id);
      setNewTitle("");
      toast("success", t("created"));
    } catch (e) {
      if (process.env.NODE_ENV === "development")
        console.error("[MeetingAiPanel] createSession error:", e);
      setError(t("error"));
    } finally {
      setCreating(false);
    }
  }

  /** 提交转录片段 */
  async function submitTranscript() {
    if (submitting || !selectedId || !speaker.trim() || !transcriptText.trim()) return;
    setSubmitting(true);
    try {
      await api(`/api/v1/ai/meetings/sessions/${selectedId}/transcript`, {
        method: "POST",
        body: JSON.stringify({
          wid,
          speaker: speaker.trim(),
          text: transcriptText.trim(),
        }),
      });
      setTranscriptText("");
      // 刷新详情以显示新片段
      await loadDetail();
      toast("success", t("transcriptAdded"));
    } catch (e) {
      if (process.env.NODE_ENV === "development")
        console.error("[MeetingAiPanel] submitTranscript error:", e);
      setError(t("error"));
    } finally {
      setSubmitting(false);
    }
  }

  /** AI 分析 */
  async function analyze() {
    if (analyzing || !selectedId) return;
    setAnalyzing(true);
    setError("");
    try {
      const result = await api<AnalysisResult>(
        `/api/v1/ai/meetings/sessions/${selectedId}/analyze`,
        {
          method: "POST",
          body: JSON.stringify({ wid }),
        },
      );
      // 刷新详情以显示摘要
      await loadDetail();
      // 递增 version 以强制子组件重新加载
      setAnalysisVersion((v) => v + 1);
      toast("success", t("analyzed"));
      if (result.actionItems.length === 0 && result.decisions.length === 0) {
        toast("warning", t("noResults"));
      }
    } catch (e) {
      if (process.env.NODE_ENV === "development")
        console.error("[MeetingAiPanel] analyze error:", e);
      setError(t("analyzeFailed"));
    } finally {
      setAnalyzing(false);
    }
  }

  /** 结束会话 */
  async function endSession() {
    if (!selectedId) return;
    if (!window.confirm(t("confirmEnd"))) return;
    try {
      await api(`/api/v1/ai/meetings/sessions/${selectedId}?wid=${encodeURIComponent(wid)}`, {
        method: "PATCH",
        body: JSON.stringify({ wid, status: "ended" }),
      });
      setSessions((prev) => prev.map((s) => (s.id === selectedId ? { ...s, status: "ended" } : s)));
      toast("success", t("ended"));
    } catch (e) {
      if (process.env.NODE_ENV === "development")
        console.error("[MeetingAiPanel] endSession error:", e);
      setError(t("error"));
    }
  }

  /** 删除会话 */
  async function deleteSession() {
    if (!selectedId) return;
    if (!window.confirm(t("confirmDelete"))) return;
    try {
      await api(`/api/v1/ai/meetings/sessions/${selectedId}?wid=${encodeURIComponent(wid)}`, {
        method: "DELETE",
      });
      setSessions((prev) => prev.filter((s) => s.id !== selectedId));
      setSelectedId(null);
      setSessionDetail(null);
      toast("success", t("deleted"));
    } catch (e) {
      if (process.env.NODE_ENV === "development")
        console.error("[MeetingAiPanel] deleteSession error:", e);
      setError(t("error"));
    }
  }

  /** 格式化时间 */
  const formatTime = useCallback((iso: string): string => {
    const d = new Date(iso);
    return d.toLocaleString();
  }, []);

  /** 转录片段数量 */
  const transcriptCount = Array.isArray(sessionDetail?.transcript)
    ? (sessionDetail!.transcript as unknown[]).length
    : 0;

  return (
    <div
      className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-sm)]"
      aria-label={t("title")}
    >
      {/* ── 头部 ── */}
      <header className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-soft)]">
        <h2 className="flex items-center gap-2 text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
          <Video size={16} className="text-[var(--accent)]" />
          {t("title")}
        </h2>
      </header>

      {/* ── 正文 ── */}
      <div className="px-5 py-4 space-y-[var(--space-3)]">
        {/* 错误态 */}
        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-sm)]">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={() => setError("")}
              className="shrink-0 opacity-60 hover:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] rounded-[var(--radius-sm)]"
              aria-label="close"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* 创建会话表单 */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") createSession();
            }}
            placeholder={t("titlePlaceholder")}
            maxLength={200}
            className={fieldControl}
            aria-label={t("titlePlaceholder")}
          />
          <button
            type="button"
            onClick={createSession}
            disabled={creating || !newTitle.trim()}
            className="inline-flex items-center gap-1.5 h-9 px-3 shrink-0 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
          >
            {creating ? (
              <Loader2 size={14} className="animate-spin motion-reduce:animate-none" />
            ) : (
              <Plus size={14} />
            )}
            {t("create")}
          </button>
        </div>

        {/* 加载态 */}
        {loading && (
          <div className="flex items-center justify-center py-8 text-[var(--muted)] text-[length:var(--text-sm)]">
            <Loader2 size={16} className="animate-spin mr-2 motion-reduce:animate-none" />
            {t("loading")}
          </div>
        )}

        {/* 空态 */}
        {!loading && sessions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-[var(--muted)] text-[length:var(--text-sm)] gap-2">
            <Video size={32} className="opacity-40" />
            <p>{t("noSessions")}</p>
          </div>
        )}

        {/* 会话列表 + 详情 */}
        {!loading && sessions.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-[var(--space-3)]">
            {/* 左侧会话列表 */}
            <div className="space-y-1">
              <div className="text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--muted)] mb-1.5">
                {t("sessions")}
              </div>
              {sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => setSelectedId(session.id)}
                  className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-[var(--radius-md)] text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] ${
                    selectedId === session.id
                      ? "bg-[var(--accent-soft)] text-[var(--accent-fg)]"
                      : "hover:bg-[var(--surface-2)] text-[var(--fg)]"
                  }`}
                >
                  <Video size={14} className="shrink-0" />
                  <span className="flex-1 truncate text-[length:var(--text-sm)]">
                    {session.title}
                  </span>
                  <span
                    className={`shrink-0 w-1.5 h-1.5 rounded-full ${
                      session.status === "active"
                        ? "bg-[var(--success-fg)]"
                        : session.status === "paused"
                          ? "bg-[var(--warning, var(--accent))]"
                          : "bg-[var(--meta)]"
                    }`}
                    title={t(session.status)}
                  />
                </button>
              ))}
            </div>

            {/* 右侧会话详情 */}
            <div className="min-w-0 space-y-[var(--space-3)]">
              {sessionDetail && (
                <>
                  {/* 会话标题 + 操作 */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
                        {sessionDetail.title}
                      </h3>
                      <div className="flex items-center gap-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--meta)] mt-0.5">
                        <span className={statusColor(sessionDetail.status)}>
                          {t(sessionDetail.status)}
                        </span>
                        <span>·</span>
                        <span className="inline-flex items-center gap-1">
                          <Clock size={14} />
                          {formatTime(sessionDetail.startTime)}
                        </span>
                        <span>·</span>
                        <span>{t("transcriptCount", { n: transcriptCount })}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {sessionDetail.status !== "ended" && (
                        <button
                          type="button"
                          onClick={endSession}
                          title={t("end")}
                          className="inline-flex items-center justify-center h-8 w-8 rounded-[var(--radius-md)] text-[var(--fg-2)] transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                        >
                          <Clock size={14} />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={deleteSession}
                        title={t("delete")}
                        className="inline-flex items-center justify-center h-8 w-8 rounded-[var(--radius-md)] text-[var(--fg-2)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {/* 转录输入（仅 active/paused 状态） */}
                  {sessionDetail.status !== "ended" && (
                    <div className="rounded-[var(--radius-md)] border border-[var(--border)] p-[var(--space-3)] space-y-2">
                      <div className="flex items-center gap-1.5 text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--muted)]">
                        <Mic size={14} />
                        {t("transcriptInput")}
                      </div>
                      <div className="flex items-start gap-2">
                        <input
                          type="text"
                          value={speaker}
                          onChange={(e) => setSpeaker(e.target.value)}
                          placeholder={t("speakerPlaceholder")}
                          maxLength={100}
                          className={`${fieldControl} w-32 shrink-0`}
                          aria-label={t("speakerPlaceholder")}
                        />
                        <input
                          type="text"
                          value={transcriptText}
                          onChange={(e) => setTranscriptText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") submitTranscript();
                          }}
                          placeholder={t("textPlaceholder")}
                          maxLength={5000}
                          className={fieldControl}
                          aria-label={t("textPlaceholder")}
                        />
                        <button
                          type="button"
                          onClick={submitTranscript}
                          disabled={submitting || !speaker.trim() || !transcriptText.trim()}
                          className="inline-flex items-center justify-center h-9 w-9 shrink-0 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                        >
                          {submitting ? (
                            <Loader2
                              size={14}
                              className="animate-spin motion-reduce:animate-none"
                            />
                          ) : (
                            <Send size={14} />
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 分析按钮 */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={analyze}
                      disabled={analyzing || transcriptCount === 0}
                      className="inline-flex items-center gap-1.5 h-9 px-3 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                    >
                      {analyzing ? (
                        <Loader2 size={14} className="animate-spin motion-reduce:animate-none" />
                      ) : (
                        <Sparkles size={14} />
                      )}
                      {t("analyze")}
                    </button>
                    {transcriptCount === 0 && (
                      <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
                        {t("needTranscript")}
                      </span>
                    )}
                  </div>

                  {/* 分析结果：摘要 */}
                  {sessionDetail.summary && (
                    <div className="rounded-[var(--radius-md)] border border-[var(--border)] p-[var(--space-3)]">
                      <div className="flex items-center gap-1.5 text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--muted)] mb-1.5">
                        <FileText size={14} />
                        {t("summary")}
                      </div>
                      <p className="text-[length:var(--text-sm)] text-[var(--fg)] whitespace-pre-wrap">
                        {sessionDetail.summary}
                      </p>
                    </div>
                  )}

                  {/* 分析结果：行动项 */}
                  <div>
                    <div className="flex items-center gap-1.5 text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--muted)] mb-1.5">
                      <ListChecks size={14} />
                      {t("actionItems")}
                    </div>
                    <MeetingActionItems
                      key={`actions-${analysisVersion}`}
                      wid={wid}
                      sessionId={selectedId!}
                    />
                  </div>

                  {/* 分析结果：决策 */}
                  <div>
                    <div className="flex items-center gap-1.5 text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--muted)] mb-1.5">
                      <Gavel size={14} />
                      {t("decisions")}
                    </div>
                    <MeetingDecisions
                      key={`decisions-${analysisVersion}`}
                      wid={wid}
                      sessionId={selectedId!}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
