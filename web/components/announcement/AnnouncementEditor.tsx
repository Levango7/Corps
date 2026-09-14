"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { X, Loader2, Pin, PinOff, Calendar, Megaphone, AlertTriangle, Info, AlertOctagon } from "lucide-react";
import { api } from "@/lib/api";
import { toLocalDateString, localDateToISOString } from "@/lib/date";
import { useTranslations } from "next-intl";

/** 公告类型 */
export type AnnouncementType = "info" | "warning" | "urgent";

/** 目标受众 */
export interface TargetAudience {
  type: "all" | "role" | "department";
  value?: string[];
}

/** 公告条目（与 API 返回结构一致） */
export interface AnnouncementItem {
  id: string;
  title: string;
  content: string;
  type: AnnouncementType;
  targetAudience: TargetAudience;
  pinned: boolean;
  publishedBy: string | null;
  publishedAt: string;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  publisher: { id: string; name: string | null; email: string } | null;
}

/** 类型 → 颜色 token 映射（info 用 accent, warning 用 warn, urgent 用 danger） */
export const TYPE_TOKEN: Record<AnnouncementType, { fg: string; soft: string; softFg: string }> = {
  info: { fg: "var(--accent)", soft: "var(--accent-soft)", softFg: "var(--accent)" },
  warning: { fg: "var(--warn)", soft: "var(--warn-soft)", softFg: "var(--warn)" },
  urgent: { fg: "var(--danger)", soft: "var(--danger-soft)", softFg: "var(--danger)" },
};

const TYPE_OPTS: { value: AnnouncementType; labelKey: string; Icon: typeof Info }[] = [
  { value: "info", labelKey: "info", Icon: Info },
  { value: "warning", labelKey: "warning", Icon: AlertTriangle },
  { value: "urgent", labelKey: "urgent", Icon: AlertOctagon },
];

const AUDIENCE_OPTS: { value: TargetAudience["type"]; labelKey: string }[] = [
  { value: "all", labelKey: "audienceAll" },
  { value: "role", labelKey: "audienceRole" },
  { value: "department", labelKey: "audienceDepartment" },
];

const fieldLabel = "flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--meta)] mb-1.5";
const fieldControl =
  "w-full h-9 px-2.5 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]";

export default function AnnouncementEditor({
  wid,
  open,
  onClose,
  onSaved,
  announcement,
}: {
  wid: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** 传入则为编辑模式，null/undefined 为新建模式 */
  announcement?: AnnouncementItem | null;
}) {
  const t = useTranslations("announcement");
  const tButton = useTranslations("button");
  const isEdit = !!announcement;

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [type, setType] = useState<AnnouncementType>("info");
  const [audienceType, setAudienceType] = useState<TargetAudience["type"]>("all");
  const [audienceValue, setAudienceValue] = useState("");
  const [pinned, setPinned] = useState(false);
  const [expiresAt, setExpiresAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    if (announcement) {
      setTitle(announcement.title);
      setContent(announcement.content);
      setType(announcement.type);
      setAudienceType(announcement.targetAudience.type);
      setAudienceValue((announcement.targetAudience.value ?? []).join(", "));
      setPinned(announcement.pinned);
      setExpiresAt(announcement.expiresAt ? toLocalDateString(new Date(announcement.expiresAt)) : "");
    } else {
      setTitle("");
      setContent("");
      setType("info");
      setAudienceType("all");
      setAudienceValue("");
      setPinned(false);
      setExpiresAt("");
    }
    setError("");
  }, [open, announcement]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // focus trap
  useEffect(() => {
    if (!open) return;
    const el = dialogRef.current;
    if (!el) return;
    const focusable = el.querySelectorAll<HTMLElement>(
      'button, a, input, textarea, select, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length > 0) focusable[0].focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    el.addEventListener("keydown", handleKeyDown);
    return () => el.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  if (!open) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !content.trim() || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const targetAudience: TargetAudience = {
        type: audienceType,
        ...(audienceType !== "all"
          ? { value: audienceValue.split(",").map((s) => s.trim()).filter(Boolean) }
          : {}),
      };
      const payload = {
        title: title.trim(),
        content: content.trim(),
        type,
        targetAudience,
        pinned,
        expiresAt: expiresAt ? localDateToISOString(expiresAt) : null,
      };

      if (isEdit && announcement) {
        await api(`/api/v1/workspaces/${wid}/announcements/${announcement.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await api(`/api/v1/workspaces/${wid}/announcements`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("create"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="announcement-editor-title"
      className="fixed inset-0 z-[var(--z-modal)] flex items-start justify-center p-4 sm:p-8 overflow-y-auto bg-[var(--overlay)]"
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        onClose();
      }}
    >
      <div className="w-full max-w-lg my-auto bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-lg)]">
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-soft)]">
          <h2
            id="announcement-editor-title"
            className="flex items-center gap-2 text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]"
          >
            <Megaphone size={16} />
            {isEdit ? t("edit") : t("create")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
            aria-label={tButton("close")}
          >
            <X size={16} />
          </button>
        </header>

        <form onSubmit={submit} className="px-4 sm:px-5 py-4 space-y-4">
          {/* 标题 */}
          <div>
            <label className={fieldLabel} htmlFor="ann-title">
              {t("title")}
            </label>
            <input
              id="ann-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              className={`${fieldControl} h-10`}
              aria-required="true"
            />
          </div>

          {/* 内容（Markdown textarea） */}
          <div>
            <label className={fieldLabel} htmlFor="ann-content">
              {t("content")}
            </label>
            <textarea
              id="ann-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={6}
              placeholder="Markdown…"
              className="w-full px-2.5 py-2 resize-y border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)]"
            />
          </div>

          {/* 类型 + 置顶 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={fieldLabel}>{t("type")}</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as AnnouncementType)}
                className={fieldControl}
              >
                {TYPE_OPTS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {t(o.labelKey)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={fieldLabel}>{t("targetAudience")}</label>
              <select
                value={audienceType}
                onChange={(e) => setAudienceType(e.target.value as TargetAudience["type"])}
                className={fieldControl}
              >
                {AUDIENCE_OPTS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {t(o.labelKey)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 受众值（仅 role/department 时显示，逗号分隔） */}
          {audienceType !== "all" && (
            <div>
              <label className={fieldLabel} htmlFor="ann-audience-value">
                {t(audienceType === "role" ? "audienceRole" : "audienceDepartment")}
              </label>
              <input
                id="ann-audience-value"
                value={audienceValue}
                onChange={(e) => setAudienceValue(e.target.value)}
                placeholder={audienceType === "role" ? "owner, admin, member" : "dept-a, dept-b"}
                className={fieldControl}
              />
            </div>
          )}

          {/* 置顶 + 过期时间 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={`${fieldLabel} cursor-pointer`}>
                <button
                  type="button"
                  onClick={() => setPinned((v) => !v)}
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
                  aria-pressed={pinned}
                >
                  {pinned ? <Pin size={14} className="text-[var(--accent)]" /> : <PinOff size={14} />}
                  {pinned ? t("pinned") : t("unpin")}
                </button>
              </label>
            </div>
            <div>
              <label className={fieldLabel}>
                <Calendar size={13} />
                {t("expiresAt")}
              </label>
              <input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className={fieldControl}
              />
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger)] text-[length:var(--text-sm)]">
              <span className="flex-1">{error}</span>
              <button
                type="button"
                onClick={() => setError("")}
                className="shrink-0 opacity-60 hover:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] rounded-[var(--radius-sm)]"
                aria-label={tButton("close")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
            >
              {tButton("cancel")}
            </button>
            <button
              type="submit"
              disabled={!title.trim() || !content.trim() || submitting}
              className="inline-flex items-center gap-1.5 h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
            >
              {submitting && <Loader2 size={15} className="animate-spin" />}
              {isEdit ? t("publish") : t("create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}