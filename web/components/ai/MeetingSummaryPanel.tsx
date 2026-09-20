"use client";

/**
 * 会议纪要面板组件（W2-A 会议纪要增强）。
 *
 * 功能：
 *  - 转写文本输入（textarea / 粘贴）
 *  - 生成按钮 → 调用 AI 生成完整结构化纪要
 *  - 纪要展示（可编辑）：会议标题、关键讨论点、决策项卡片、待办事项、参与者标签
 *  - 待办事项可勾选入库为 Task（POST /api/v1/workspaces/[wid]/tasks）
 *  - 导出按钮（Markdown 格式下载）
 *
 * 样式全走 design token（var(--*)），lucide-react 图标尺寸 16。
 * 错误处理：catch 中用 t("error")，不泄露 e.message。
 *
 * i18n：useTranslations("ai.meetingSummary")，引用但不修改 zh.json/en.json。
 * key 暂未在 messages 文件中定义时，tf helper 回退到内置英文默认值，
 * 保证组件在 key 缺失时仍正常渲染（不抛 IntlError）。
 */

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  FileText,
  CheckSquare,
  Users,
  Download,
  Loader2,
  Edit,
  Save,
  Sparkles,
  AlertCircle,
  X,
  Check,
  Plus,
  Calendar,
  User,
  Gavel,
  ListChecks,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/Toast";

// ── 类型定义 ──

/** AI 生成的决策项 */
interface Decision {
  title: string;
  description: string;
}

/** AI 生成的待办事项 */
interface ActionItem {
  title: string;
  assignee: string | null;
  dueDate: string | null;
  priority: "low" | "medium" | "high" | "urgent";
}

/** AI 生成的完整会议纪要 */
interface MeetingSummary {
  title: string;
  keyPoints: string[];
  decisions: Decision[];
  actionItems: ActionItem[];
  participants: string[];
}


// ── 样式常量 ──

/** 输入框样式（design token） */
const fieldControl =
  "w-full px-2.5 py-2 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)]";

/** 主按钮样式 */
const primaryBtn =
  "inline-flex items-center gap-1.5 h-9 px-3 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]";

/** 次按钮样式 */
const ghostBtn =
  "inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]";

/** 优先级标签颜色 */
function priorityColor(priority: string): string {
  switch (priority) {
    case "urgent":
      return "bg-[var(--danger-soft)] text-[var(--danger-fg)]";
    case "high":
      return "bg-[var(--warning-soft, var(--accent-soft))] text-[var(--warning-fg, var(--accent-fg))]";
    case "medium":
      return "bg-[var(--accent-soft)] text-[var(--accent-fg)]";
    case "low":
    default:
      return "bg-[var(--surface-2)] text-[var(--meta)]";
  }
}

// ── 组件 Props ──

interface MeetingSummaryPanelProps {
  /** 工作区 ID */
  wid: string;
  /** 可选：初始转写文本（如从会议会话传入） */
  initialTranscript?: string;
  /** 可选：初始会议标题 */
  initialMeetingTitle?: string;
}

// ── 组件实现 ──

export default function MeetingSummaryPanel({
  wid,
  initialTranscript = "",
  initialMeetingTitle = "",
}: MeetingSummaryPanelProps) {
  const t = useTranslations("ai.meetingSummary");
  const { toast } = useToast();


  // ── 状态 ──

  const [transcript, setTranscript] = useState(initialTranscript);
  const [meetingTitle, setMeetingTitle] = useState(initialMeetingTitle);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  const [summary, setSummary] = useState<MeetingSummary | null>(null);

  // 编辑模式
  const [editing, setEditing] = useState(false);
  const [editBuffer, setEditBuffer] = useState<MeetingSummary | null>(null);

  // 待办入库状态：已入库的 actionItem 索引集合
  const [addedIndices, setAddedIndices] = useState<Set<number>>(new Set());
  const [addingIndex, setAddingIndex] = useState<number | null>(null);

  // ── 生成纪要 ──

  const handleGenerate = useCallback(async () => {
    if (generating || !transcript.trim()) return;
    setGenerating(true);
    setError("");
    try {
      const data = await api<MeetingSummary>("/api/v1/ai/meeting-summary", {
        method: "POST",
        body: JSON.stringify({
          wid,
          transcript: transcript.trim(),
          meetingTitle: meetingTitle.trim() || undefined,
        }),
      });
      setSummary(data);
      setAddedIndices(new Set());
      setEditing(false);
      setEditBuffer(null);
      if (
        data.keyPoints.length === 0 &&
        data.decisions.length === 0 &&
        data.actionItems.length === 0
      ) {
        toast("warning", t("noResults"));
      }
    } catch (e) {
      if (process.env.NODE_ENV === "development")
        console.error("[MeetingSummaryPanel] generate error:", e);
      setError(t("generateFailed"));
    } finally {
      setGenerating(false);
    }
  }, [generating, transcript, meetingTitle, wid, toast]);

  // ── 待办入库 ──

  const handleAddToTask = useCallback(
    async (item: ActionItem, index: number) => {
      if (addingIndex !== null || addedIndices.has(index)) return;
      setAddingIndex(index);
      try {
        // dueDate 从 YYYY-MM-DD 转换为 ISO datetime（Task schema 要求 z.string().datetime()）
        const dueDateIso = item.dueDate
          ? new Date(item.dueDate + "T00:00:00.000Z").toISOString()
          : undefined;

        await api(`/api/v1/workspaces/${wid}/tasks`, {
          method: "POST",
          body: JSON.stringify({
            title: item.title,
            description: item.assignee
              ? t("assigneePrefix", { name: item.assignee })
              : undefined,
            priority: item.priority,
            dueDate: dueDateIso,
          }),
        });
        setAddedIndices((prev) => new Set(prev).add(index));
        toast("success", t("added"));
      } catch (e) {
        if (process.env.NODE_ENV === "development")
          console.error("[MeetingSummaryPanel] addToTask error:", e);
        const msg =
          e instanceof ApiError ? e.message : t("addFailed");
        toast("error", msg);
      } finally {
        setAddingIndex(null);
      }
    },
    [addingIndex, addedIndices, wid, toast],
  );

  // ── 编辑/保存 ──

  const startEdit = useCallback(() => {
    if (!summary) return;
    setEditBuffer(JSON.parse(JSON.stringify(summary)));
    setEditing(true);
  }, [summary]);

  const saveEdit = useCallback(() => {
    if (!editBuffer) return;
    setSummary(editBuffer);
    setEditing(false);
    setEditBuffer(null);
  }, [editBuffer]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setEditBuffer(null);
  }, []);

  // ── 导出 Markdown ──

  const handleExportMarkdown = useCallback(() => {
    const s = editing ? editBuffer : summary;
    if (!s) return;

    const lines: string[] = [];
    lines.push(`# ${s.title || t("title")}`);
    lines.push("");

    if (s.participants.length > 0) {
      lines.push(`**${t("participants")}：** ${s.participants.join("、")}`);
      lines.push("");
    }

    if (s.keyPoints.length > 0) {
      lines.push(`## ${t("keyPoints")}`);
      s.keyPoints.forEach((p) => lines.push(`- ${p}`));
      lines.push("");
    }

    if (s.decisions.length > 0) {
      lines.push(`## ${t("decisions")}`);
      s.decisions.forEach((d) => {
        lines.push(`### ${d.title}`);
        if (d.description) lines.push(d.description);
        lines.push("");
      });
    }

    if (s.actionItems.length > 0) {
      lines.push(`## ${t("actionItems")}`);
      s.actionItems.forEach((a) => {
        const parts: string[] = [`- [ ] ${a.title}`];
        if (a.assignee) parts.push(`（${t("meetingTitle")}: ${a.assignee}）`);
        if (a.dueDate) parts.push(`📅 ${a.dueDate}`);
        parts.push(`[${a.priority}]`);
        lines.push(parts.join(" "));
      });
      lines.push("");
    }

    const markdown = lines.join("\n");
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `meeting-summary-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [summary, editBuffer, editing]);

  // ── 渲染数据（编辑时用 editBuffer，否则用 summary） ──

  const display = editing ? editBuffer : summary;

  // ── 是否有内容可导出 ──
  const canExport = useMemo(() => {
    if (!display) return false;
    return (
      display.title !== "" ||
      display.keyPoints.length > 0 ||
      display.decisions.length > 0 ||
      display.actionItems.length > 0 ||
      display.participants.length > 0
    );
  }, [display]);

  return (
    <div
      className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-sm)]"
      aria-label={t("title")}
    >
      {/* ── 头部 ── */}
      <header className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-soft)]">
        <h2 className="flex items-center gap-2 text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
          <FileText size={16} className="text-[var(--accent)]" />
          {t("title")}
        </h2>
        <div className="flex items-center gap-2">
          {canExport && (
            <button
              type="button"
              onClick={handleExportMarkdown}
              className={ghostBtn}
              title={t("exportMarkdown")}
            >
              <Download size={16} />
              {t("export")}
            </button>
          )}
          {summary && !editing && (
            <button
              type="button"
              onClick={startEdit}
              className={ghostBtn}
              title={t("edit")}
            >
              <Edit size={16} />
              {t("edit")}
            </button>
          )}
          {editing && (
            <>
              <button
                type="button"
                onClick={saveEdit}
                className={primaryBtn}
                title={t("save")}
              >
                <Save size={16} />
                {t("save")}
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                className={ghostBtn}
              >
                <X size={16} />
              </button>
            </>
          )}
        </div>
      </header>

      {/* ── 正文 ── */}
      <div className="px-5 py-4 space-y-[var(--space-3)]">
        {/* 错误态 */}
        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-sm)]">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={() => setError("")}
              className="shrink-0 opacity-60 hover:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] rounded-[var(--radius-sm)]"
              aria-label="close"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* 转写输入区 */}
        <div className="space-y-2">
          {/* 会议标题输入 */}
          <input
            type="text"
            value={meetingTitle}
            onChange={(e) => setMeetingTitle(e.target.value)}
            placeholder={t("meetingTitlePlaceholder")}
            maxLength={200}
            className={fieldControl}
            aria-label={t("meetingTitle")}
          />
          {/* 转写 textarea */}
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder={t("transcriptPlaceholder")}
            maxLength={50000}
            rows={6}
            className={`${fieldControl} resize-y min-h-[120px] leading-relaxed`}
            aria-label={t("transcriptLabel")}
          />
          {/* 生成按钮 */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating || !transcript.trim()}
              className={primaryBtn}
            >
              {generating ? (
                <Loader2
                  size={16}
                  className="animate-spin motion-reduce:animate-none"
                />
              ) : (
                <Sparkles size={16} />
              )}
              {generating ? t("generating") : t("generate")}
            </button>
            {!transcript.trim() && (
              <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
                {t("noTranscript")}
              </span>
            )}
          </div>
        </div>

        {/* 加载态 */}
        {generating && (
          <div className="flex items-center justify-center py-8 text-[var(--muted)] text-[length:var(--text-sm)]">
            <Loader2
              size={16}
              className="animate-spin mr-2 motion-reduce:animate-none"
            />
            {t("generating")}
          </div>
        )}

        {/* 空态 */}
        {!generating && !display && (
          <div className="flex flex-col items-center justify-center py-12 text-[var(--muted)] text-[length:var(--text-sm)] gap-2">
            <FileText size={32} className="opacity-40" />
            <p>{t("emptySummary")}</p>
          </div>
        )}

        {/* 纪要展示 */}
        {!generating && display && (
          <div className="space-y-[var(--space-3)]">
            {/* 会议标题 */}
            <div>
              {editing ? (
                <input
                  type="text"
                  value={editBuffer?.title ?? ""}
                  onChange={(e) =>
                    setEditBuffer((prev) =>
                      prev ? { ...prev, title: e.target.value } : prev,
                    )
                  }
                  className={`${fieldControl} text-[length:var(--text-md)] font-[weight:var(--weight-semibold)]`}
                  aria-label={t("meetingTitle")}
                />
              ) : (
                <h3 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
                  {display.title || t("title")}
                </h3>
              )}
            </div>

            {/* 参与者标签 */}
            {display.participants.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--muted)]">
                  <Users size={16} />
                  {t("participants")}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {display.participants.map((p, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center px-2 py-0.5 rounded-[var(--radius-sm)] bg-[var(--surface-2)] text-[length:var(--text-xs)] text-[var(--fg-2)]"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 关键讨论点 */}
            {display.keyPoints.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--muted)]">
                  <ListChecks size={16} />
                  {t("keyPoints")}
                </div>
                <ul className="space-y-1">
                  {display.keyPoints.map((point, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-[length:var(--text-sm)] text-[var(--fg)]"
                    >
                      {editing ? (
                        <input
                          type="text"
                          value={point}
                          onChange={(e) =>
                            setEditBuffer((prev) => {
                              if (!prev) return prev;
                              const next = [...prev.keyPoints];
                              next[i] = e.target.value;
                              return { ...prev, keyPoints: next };
                            })
                          }
                          className={fieldControl}
                        />
                      ) : (
                        <>
                          <span className="shrink-0 text-[var(--accent)] mt-0.5">
                            •
                          </span>
                          <span className="flex-1">{point}</span>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* 决策项卡片 */}
            {display.decisions.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--muted)]">
                  <Gavel size={16} />
                  {t("decisions")}
                </div>
                <div className="space-y-2">
                  {display.decisions.map((d, i) => (
                    <div
                      key={i}
                      className="rounded-[var(--radius-md)] border border-[var(--border)] p-[var(--space-3)]"
                    >
                      {editing ? (
                        <div className="space-y-2">
                          <input
                            type="text"
                            value={d.title}
                            onChange={(e) =>
                              setEditBuffer((prev) => {
                                if (!prev) return prev;
                                const next = [...prev.decisions];
                                next[i] = { ...next[i], title: e.target.value };
                                return { ...prev, decisions: next };
                              })
                            }
                            className={`${fieldControl} font-[weight:var(--weight-medium)]`}
                          />
                          <textarea
                            value={d.description}
                            onChange={(e) =>
                              setEditBuffer((prev) => {
                                if (!prev) return prev;
                                const next = [...prev.decisions];
                                next[i] = {
                                  ...next[i],
                                  description: e.target.value,
                                };
                                return { ...prev, decisions: next };
                              })
                            }
                            className={`${fieldControl} resize-y min-h-[60px]`}
                            rows={2}
                          />
                        </div>
                      ) : (
                        <>
                          <h4 className="text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)] mb-1">
                            {d.title}
                          </h4>
                          {d.description && (
                            <p className="text-[length:var(--text-sm)] text-[var(--fg-2)] whitespace-pre-wrap">
                              {d.description}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 待办事项列表 */}
            {display.actionItems.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--muted)]">
                  <CheckSquare size={16} />
                  {t("actionItems")}
                </div>
                <ul className="space-y-1.5">
                  {display.actionItems.map((item, i) => {
                    const isAdded = addedIndices.has(i);
                    const isAdding = addingIndex === i;
                    return (
                      <li
                        key={i}
                        className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--border)] px-3 py-2"
                      >
                        {editing ? (
                          <div className="flex-1 space-y-2">
                            <input
                              type="text"
                              value={item.title}
                              onChange={(e) =>
                                setEditBuffer((prev) => {
                                  if (!prev) return prev;
                                  const next = [...prev.actionItems];
                                  next[i] = { ...next[i], title: e.target.value };
                                  return { ...prev, actionItems: next };
                                })
                              }
                              className={fieldControl}
                            />
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={item.assignee ?? ""}
                                onChange={(e) =>
                                  setEditBuffer((prev) => {
                                    if (!prev) return prev;
                                    const next = [...prev.actionItems];
                                    next[i] = {
                                      ...next[i],
                                      assignee: e.target.value || null,
                                    };
                                    return { ...prev, actionItems: next };
                                  })
                                }
                                placeholder={t("assigneePlaceholder")}
                                className={`${fieldControl} flex-1`}
                              />
                              <select
                                value={item.priority}
                                onChange={(e) =>
                                  setEditBuffer((prev) => {
                                    if (!prev) return prev;
                                    const next = [...prev.actionItems];
                                    next[i] = {
                                      ...next[i],
                                      priority: e.target
                                        .value as ActionItem["priority"],
                                    };
                                    return { ...prev, actionItems: next };
                                  })
                                }
                                className={fieldControl}
                              >
                                <option value="low">low</option>
                                <option value="medium">medium</option>
                                <option value="high">high</option>
                                <option value="urgent">urgent</option>
                              </select>
                            </div>
                          </div>
                        ) : (
                          <>
                            {/* 待办内容 */}
                            <div className="flex-1 min-w-0">
                              <p className="text-[length:var(--text-sm)] text-[var(--fg)]">
                                {item.title}
                              </p>
                              <div className="flex items-center gap-2 mt-1 text-[length:var(--text-xs)] text-[var(--meta)]">
                                {item.assignee && (
                                  <span className="inline-flex items-center gap-0.5">
                                    <User size={12} />
                                    {item.assignee}
                                  </span>
                                )}
                                {item.dueDate && (
                                  <span className="inline-flex items-center gap-0.5">
                                    <Calendar size={12} />
                                    {item.dueDate}
                                  </span>
                                )}
                                <span
                                  className={`inline-flex items-center px-1.5 py-0.5 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] ${priorityColor(
                                  item.priority,
                                )}`}
                                >
                                  {item.priority}
                                </span>
                              </div>
                            </div>
                            {/* 入库按钮 */}
                            <button
                              type="button"
                              onClick={() => handleAddToTask(item, i)}
                              disabled={isAdded || isAdding}
                              className={`shrink-0 inline-flex items-center gap-1 h-7 px-2 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] ${
                                isAdded
                                  ? "bg-[var(--success-soft)] text-[var(--success-fg)] cursor-default"
                                  : "bg-[var(--surface-2)] text-[var(--fg-2)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent-fg)]"
                              }`}
                              title={isAdded ? t("added") : t("addToTodos")}
                            >
                              {isAdding ? (
                                <Loader2
                                  size={14}
                                  className="animate-spin motion-reduce:animate-none"
                                />
                              ) : isAdded ? (
                                <Check size={14} />
                              ) : (
                                <Plus size={14} />
                              )}
                              {isAdded ? t("added") : t("addToTodos")}
                            </button>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* 无内容提示 */}
            {!canExport && (
              <div className="text-center py-6 text-[length:var(--text-sm)] text-[var(--meta)]">
                {t("noResults")}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}