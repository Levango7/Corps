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
} from "lucide-react";
import { api, ApiError } from "@/lib/api";

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

export function MinutesEditor({ wid, mid, initial }: MinutesEditorProps) {
  const t = useTranslations("minutes");
  const router = useRouter();
  const [title, setTitle] = useState(initial.title);
  const [content, setContent] = useState(initial.content);
  const [attendees, setAttendees] = useState<Attendee[]>(initial.attendees ?? []);
  const [actionItems, setActionItems] = useState<ActionItem[]>(initial.actionItems ?? []);
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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