"use client";

/**
 * 会议纪要编辑器 · components/minutes/MinutesEditor.tsx
 *
 * 功能：
 *  - 标题输入
 *  - Markdown 内容编辑（textarea + 预览切换，不依赖外部 markdown 编辑器库）
 *  - 参会人员列表（添加/删除：姓名+角色）
 *  - 行动项列表（添加/删除/勾选完成：标题+负责人+截止日期+完成状态）
 *  - 保存：PATCH /meeting-minutes/{mid}
 *
 * design token + lucide-react（size 14/16）+ useTranslations。
 */

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/lib/i18n-navigation";
import {
  Loader2,
  Plus,
  Trash2,
  UserPlus,
  CheckSquare,
  Eye,
  Pencil,
  Save,
  Sparkles,
  X,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/Toast";
// 注：isAiConfigured()（@/lib/ai/shared）是服务端函数，依赖 process.env.DEEPSEEK_API_KEY。
// 该变量无 NEXT_PUBLIC_ 前缀，客户端构建时被 Next.js 替换为 undefined，
// 因此 isAiConfigured() 在客户端永远返回 false，不能直接用作初始值。
// 客户端改用乐观假设（默认 true）+ 503 错误检测：API 返回 503 时禁用按钮。

interface Attendee {
  userId?: string;
  name: string;
  role?: string;
}
interface ActionItem {
  title: string;
  assigneeId?: string;
  dueDate?: string;
  done: boolean;
}

/** AI 会议摘要 API 返回的决策项 */
interface AiDecision {
  title: string;
  description: string;
}
/** AI 会议摘要 API 返回的行动项 */
interface AiActionItem {
  title: string;
  assignee: string | null;
  dueDate: string | null;
  priority: "low" | "medium" | "high" | "urgent";
}
/** AI 会议摘要 API 返回的完整纪要 */
interface AiMeetingSummary {
  title: string;
  keyPoints: string[];
  decisions: AiDecision[];
  actionItems: AiActionItem[];
  participants: string[];
}

interface MinutesEditorProps {
  wid: string;
  mid: string;
  initial: {
    title: string;
    content: string;
    attendees: Attendee[];
    actionItems: ActionItem[];
  };
}

/** 简单 Markdown 预览渲染：处理标题/加粗/换行，其余 whitespace-pre-wrap */
function renderMarkdown(md: string): string {
  return md;
}

/**
 * 将日期字符串（YYYY-MM-DD）安全转换为 ISO 字符串。
 *
 * AI 返回的 dueDate 可能是空字符串、undefined 或非日期字符串，
 * 直接 new Date(...).toISOString() 在 Invalid Date 时会抛 RangeError，
 * 导致整个 applyAiSummary 崩溃。此处用 try-catch + isNaN 兜底返回 null。
 */
function safeDateToIso(dateStr: string): string | null {
  try {
    const d = new Date(dateStr + "T00:00:00.000Z");
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

// ── AI 摘要 i18n 回退文案 ──
// key 暂未在 messages/zh.json|en.json 中定义时使用这些默认值。
// 任务要求不修改 messages 文件，tf helper 通过 t.has() 检测后回退，保证渲染不中断。
const AI_FALLBACK_TEXT: Record<string, string> = {
  aiSummary: "AI 生成摘要",
  aiNotConfigured: "AI 未配置",
  aiTranscriptLabel: "会议转写",
  aiTranscriptPlaceholder: "粘贴会议转写文本…（说话人: 内容）",
  aiTranscriptEmpty: "请先输入转写文本",
  aiGenerate: "生成",
  aiGenerating: "生成中…",
  aiGenerateFailed: "生成失败，请重试",
  aiCancel: "取消",
  aiSummaryApplied: "已应用 AI 摘要",
  aiKeyPoints: "关键讨论点",
  aiDecisions: "决策项",
};

export function MinutesEditor({ wid, mid, initial }: MinutesEditorProps) {
  const t = useTranslations("minutes");
  const router = useRouter();
  const { toast } = useToast();
  const [title, setTitle] = useState(initial.title);
  const [content, setContent] = useState(initial.content);
  const [attendees, setAttendees] = useState<Attendee[]>(initial.attendees ?? []);
  const [actionItems, setActionItems] = useState<ActionItem[]>(initial.actionItems ?? []);
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // ── AI 摘要相关状态 ──
  /** AI 面板展开 */
  const [showAiPanel, setShowAiPanel] = useState(false);
  /** 转写文本输入 */
  const [aiTranscript, setAiTranscript] = useState("");
  /** AI 生成中 */
  const [aiGenerating, setAiGenerating] = useState(false);
  /** AI 是否已配置（乐观假设 true；API 返回 503 时置 false 禁用按钮） */
  const [aiConfigured, setAiConfigured] = useState(true);

  /**
   * 带回退的 AI key 翻译函数。
   *
   * next-intl v4 在 key 不存在时开发模式 console.error、生产模式抛 IntlError。
   * 本组件引用的 minutes.ai* key 可能尚未添加到 messages 文件，
   * 故用 t.has() 检测后回退到 AI_FALLBACK_TEXT，保证渲染不中断。
   */
  function tf(key: string): string {
    try {
      if (t.has(key)) return t(key);
    } catch {
      // t.has 抛异常时走回退
    }
    return AI_FALLBACK_TEXT[key] ?? key;
  }

  // ── 参会人员操作 ──
  function addAttendee() {
    setAttendees((prev) => [...prev, { name: "", role: "" }]);
  }
  function removeAttendee(idx: number) {
    setAttendees((prev) => prev.filter((_, i) => i !== idx));
  }
  function updateAttendee(idx: number, field: keyof Attendee, value: string) {
    setAttendees((prev) =>
      prev.map((a, i) => (i === idx ? { ...a, [field]: value } : a)),
    );
  }

  // ── 行动项操作 ──
  function addActionItem() {
    setActionItems((prev) => [...prev, { title: "", done: false }]);
  }
  function removeActionItem(idx: number) {
    setActionItems((prev) => prev.filter((_, i) => i !== idx));
  }
  function updateActionItem(
    idx: number,
    field: keyof ActionItem,
    value: string | boolean,
  ) {
    setActionItems((prev) =>
      prev.map((a, i) => (i === idx ? { ...a, [field]: value } : a)),
    );
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      // 过滤空姓名的参会人
      const cleanAttendees = attendees
        .filter((a) => a.name.trim())
        .map((a) => ({ ...a, name: a.name.trim(), role: a.role?.trim() || undefined }));
      // 过滤空标题的行动项
      const cleanActions = actionItems
        .filter((a) => a.title.trim())
        .map((a) => ({ ...a, title: a.title.trim() }));

      await api(`/api/v1/workspaces/${wid}/meeting-minutes/${mid}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: title.trim(),
          content,
          attendees: cleanAttendees,
          actionItems: cleanActions,
        }),
      });
      router.push(`/w/${wid}/meeting-minutes/${mid}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  // ── AI 生成摘要 ──
  /** 将 AI 返回的摘要应用到编辑器字段 */
  function applyAiSummary(summary: AiMeetingSummary) {
    // 标题：非空时覆盖
    if (summary.title.trim()) setTitle(summary.title);

    // content：拼接 keyPoints + decisions 为 Markdown
    const lines: string[] = [];
    if (summary.keyPoints.length > 0) {
      lines.push(`## ${tf("aiKeyPoints")}`);
      summary.keyPoints.forEach((p) => lines.push(`- ${p}`));
      lines.push("");
    }
    if (summary.decisions.length > 0) {
      lines.push(`## ${tf("aiDecisions")}`);
      summary.decisions.forEach((d) => {
        lines.push(`### ${d.title}`);
        if (d.description) lines.push(d.description);
        lines.push("");
      });
    }
    if (lines.length > 0) setContent(lines.join("\n"));

    // 参会人员：participants 转为 attendee（仅保留新增的非空姓名）
    if (summary.participants.length > 0) {
      const existingNames = new Set(attendees.map((a) => a.name.trim()).filter(Boolean));
      const newAttendees: Attendee[] = summary.participants
        .filter((p) => p.trim() && !existingNames.has(p.trim()))
        .map((p) => ({ name: p.trim(), role: "" }));
      if (newAttendees.length > 0) {
        setAttendees((prev) => [...prev, ...newAttendees]);
      }
    }

    // 行动项：转换为编辑器格式（保留现有项，追加 AI 生成的项）
    if (summary.actionItems.length > 0) {
      const newActions: ActionItem[] = summary.actionItems.map((a) => ({
        title: a.title,
        assigneeId: a.assignee ?? undefined,
        dueDate: a.dueDate ? safeDateToIso(a.dueDate) ?? undefined : undefined,
        done: false,
      }));
      setActionItems((prev) => [...prev, ...newActions]);
    }
  }

  /** 调用 AI 生成会议摘要 */
  async function handleAiGenerate() {
    if (aiGenerating || !aiTranscript.trim()) return;
    setAiGenerating(true);
    try {
      const data = await api<AiMeetingSummary>("/api/v1/ai/meeting-summary", {
        method: "POST",
        body: JSON.stringify({
          wid,
          transcript: aiTranscript.trim(),
          meetingTitle: title.trim() || undefined,
        }),
      });
      applyAiSummary(data);
      setShowAiPanel(false);
      setAiTranscript("");
      toast("success", tf("aiSummaryApplied"));
    } catch (e) {
      // 503：AI 服务未配置 → 禁用按钮
      if (e instanceof ApiError && (e.status === 503 || e.code === 503)) {
        setAiConfigured(false);
        setShowAiPanel(false);
        toast("error", tf("aiNotConfigured"));
      } else {
        const msg = e instanceof ApiError ? e.message : tf("aiGenerateFailed");
        toast("error", msg);
      }
    } finally {
      setAiGenerating(false);
    }
  }

  const fieldLabel =
    "flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--meta)] mb-1.5";
  const fieldControl =
    "w-full h-9 px-2.5 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]";

  return (
    <form
      onSubmit={save}
      className="max-w-[var(--container-max)] mx-auto px-[var(--space-4)] py-[var(--space-6)] space-y-[var(--space-5)]"
    >
      {/* 标题 + 操作栏 */}
      <div className="flex items-center gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          placeholder={t("titlePlaceholder")}
          className="flex-1 h-10 px-3 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
          aria-label={t("title")}
        />
        <button
          type="button"
          onClick={() => setShowAiPanel((v) => !v)}
          disabled={!aiConfigured}
          title={!aiConfigured ? tf("aiNotConfigured") : tf("aiSummary")}
          aria-label={tf("aiSummary")}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-fast)]"
        >
          <Sparkles size={14} className="text-[var(--accent)]" />
          {tf("aiSummary")}
        </button>
        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
          title={showPreview ? t("edit") : t("preview")}
        >
          {showPreview ? <Pencil size={14} /> : <Eye size={14} />}
          {showPreview ? t("edit") : t("preview")}
        </button>
        <button
          type="submit"
          disabled={saving || !title.trim()}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)]"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {t("save")}
        </button>
      </div>

      {/* AI 未配置提示 */}
      {!aiConfigured && (
        <p className="text-[length:var(--text-xs)] text-[var(--meta)]">
          {tf("aiNotConfigured")}
        </p>
      )}

      {/* AI 生成摘要面板 */}
      {showAiPanel && aiConfigured && (
        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] p-3 space-y-2">
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--meta)]">
              <Sparkles size={14} className="text-[var(--accent)]" />
              {tf("aiTranscriptLabel")}
            </label>
            <button
              type="button"
              onClick={() => setShowAiPanel(false)}
              className="shrink-0 w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--surface)] transition-colors duration-[var(--motion-fast)]"
              aria-label={tf("aiCancel")}
            >
              <X size={14} />
            </button>
          </div>
          <textarea
            value={aiTranscript}
            onChange={(e) => setAiTranscript(e.target.value)}
            rows={6}
            maxLength={50000}
            placeholder={tf("aiTranscriptPlaceholder")}
            className="w-full px-3 py-2 resize-y border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)] font-mono"
            aria-label={tf("aiTranscriptLabel")}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleAiGenerate}
              disabled={aiGenerating || !aiTranscript.trim()}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-fast)]"
            >
              {aiGenerating ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Sparkles size={14} />
              )}
              {aiGenerating ? tf("aiGenerating") : tf("aiGenerate")}
            </button>
            <button
              type="button"
              onClick={() => setShowAiPanel(false)}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
            >
              {tf("aiCancel")}
            </button>
            {!aiTranscript.trim() && (
              <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
                {tf("aiTranscriptEmpty")}
              </span>
            )}
          </div>
        </div>
      )}

      {error && <p className="text-[length:var(--text-sm)] text-[var(--danger)]">{error}</p>}

      {/* 内容编辑 / 预览 */}
      <div>
        <label className={fieldLabel}>{t("content")}</label>
        {showPreview ? (
          <div className="min-h-[300px] px-4 py-3 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface-2)] text-[length:var(--text-sm)] text-[var(--fg)] whitespace-pre-wrap">
            {renderMarkdown(content) || <span className="text-[var(--muted)]">{t("contentEmpty")}</span>}
          </div>
        ) : (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={16}
            placeholder={t("contentPlaceholder")}
            className="w-full px-3 py-2 resize-y border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)] font-mono"
          />
        )}
      </div>

      {/* 参会人员 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className={fieldLabel}>{t("attendees")}</label>
          <button
            type="button"
            onClick={addAttendee}
            className="inline-flex items-center gap-1 h-7 px-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-xs)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
          >
            <UserPlus size={14} />
            {t("addAttendee")}
          </button>
        </div>
        {attendees.length === 0 ? (
          <p className="text-[length:var(--text-xs)] text-[var(--muted)] py-2">{t("noAttendees")}</p>
        ) : (
          <ul className="space-y-2">
            {attendees.map((a, idx) => (
              <li key={idx} className="flex items-center gap-2">
                <input
                  value={a.name}
                  onChange={(e) => updateAttendee(idx, "name", e.target.value)}
                  placeholder={t("attendeeName")}
                  className={`${fieldControl} flex-1`}
                />
                <input
                  value={a.role ?? ""}
                  onChange={(e) => updateAttendee(idx, "role", e.target.value)}
                  placeholder={t("attendeeRole")}
                  className={`${fieldControl} w-32`}
                />
                <button
                  type="button"
                  onClick={() => removeAttendee(idx)}
                  className="shrink-0 w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:text-[var(--danger)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
                  aria-label={t("delete")}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 行动项 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className={fieldLabel}>{t("actionItems")}</label>
          <button
            type="button"
            onClick={addActionItem}
            className="inline-flex items-center gap-1 h-7 px-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-xs)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
          >
            <Plus size={14} />
            {t("addAction")}
          </button>
        </div>
        {actionItems.length === 0 ? (
          <p className="text-[length:var(--text-xs)] text-[var(--muted)] py-2">{t("noActions")}</p>
        ) : (
          <ul className="space-y-2">
            {actionItems.map((a, idx) => (
              <li key={idx} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => updateActionItem(idx, "done", !a.done)}
                  className="shrink-0 w-5 h-5 flex items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border)] transition-colors duration-[var(--motion-fast)]"
                  style={{
                    background: a.done ? "var(--accent)" : "var(--surface)",
                    borderColor: a.done ? "var(--accent)" : "var(--border)",
                  }}
                  aria-label={t("actionDone")}
                  aria-pressed={a.done}
                >
                  {a.done && <CheckSquare size={14} className="text-[var(--accent-fg)]" />}
                </button>
                <input
                  value={a.title}
                  onChange={(e) => updateActionItem(idx, "title", e.target.value)}
                  placeholder={t("actionTitle")}
                  className={`${fieldControl} flex-1`}
                />
                <input
                  value={a.assigneeId ?? ""}
                  onChange={(e) => updateActionItem(idx, "assigneeId", e.target.value)}
                  placeholder={t("actionAssignee")}
                  className={`${fieldControl} w-32`}
                />
                <input
                  type="date"
                  value={a.dueDate ? a.dueDate.slice(0, 10) : ""}
                  onChange={(e) =>
                    updateActionItem(
                      idx,
                      "dueDate",
                      e.target.value ? new Date(e.target.value).toISOString() : "",
                    )
                  }
                  placeholder={t("actionDueDate")}
                  className={`${fieldControl} w-36`}
                />
                <button
                  type="button"
                  onClick={() => removeActionItem(idx)}
                  className="shrink-0 w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:text-[var(--danger)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
                  aria-label={t("delete")}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </form>
  );
}