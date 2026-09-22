"use client";

/**
 * 创建会议弹窗 · components/meeting/MeetingCreate.tsx
 *
 * 表单：标题（必填）、描述（可选）、类型（即时/预约）、预约时间（type=scheduled 时显示）、
 * 最大参与人数、允许录制。
 *
 * Modal 模式（fixed inset-0 + backdrop），design token 样式。
 * 简单校验：标题非空 + 预约会议时 scheduledAt 必填。
 */

import { useEffect, useRef, useState, type FormEvent } from "react";
import { X, Loader2, AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";

/** 会议类型 */
type MeetingType = "instant" | "scheduled" | "recurring";

/** L6 #32：重复频率（iCal RRULE FREQ 值） */
type RecurringFreq = "daily" | "weekly" | "monthly";

/** 创建会议 API 请求体 */
interface CreateMeetingBody {
  title: string;
  description?: string;
  type: MeetingType;
  scheduledAt?: string;
  maxParticipants?: number;
  recordingEnabled?: boolean;
  /** L6 #32：重复规则（iCal RRULE 格式） */
  recurringRule?: string;
  /** L8 #34：会议密码 */
  password?: string;
}

/** 创建会议 API 响应 */
interface CreatedMeeting {
  id: string;
  title: string;
}

/** 编辑模式传入的会议初始值 */
export interface EditableMeeting {
  id: string;
  title: string;
  description?: string | null;
  type?: string;
  scheduledAt?: string | null;
  maxParticipants?: number | null;
  recordingEnabled?: boolean;
  /** L6 #32：重复规则 */
  recurringRule?: string | null;
  /** L8 #34：会议密码 */
  password?: string | null;
}

/** 表单字段标签/控件公共样式 */
const fieldLabel =
  "flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--meta)] mb-1.5";
const fieldControl =
  "w-full h-9 px-2.5 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]";

export interface MeetingCreateProps {
  workspaceId: string;
  onClose: () => void;
  onCreated: (meeting: CreatedMeeting) => void;
  /** 编辑模式：传入会议初始值，提交时走 PATCH 而非 POST */
  meeting?: EditableMeeting;
}

export function MeetingCreate({
  workspaceId,
  onClose,
  onCreated,
  meeting,
}: MeetingCreateProps) {
  const t = useTranslations("meeting");
  const tButton = useTranslations("button");

  const isEdit = Boolean(meeting);

  const [title, setTitle] = useState(meeting?.title ?? "");
  const [description, setDescription] = useState(meeting?.description ?? "");
  const [type, setType] = useState<MeetingType>(
    meeting?.type === "scheduled"
      ? "scheduled"
      : meeting?.type === "recurring"
        ? "recurring"
        : "instant",
  );
  const [scheduledAt, setScheduledAt] = useState(
    meeting?.scheduledAt
      ? new Date(meeting.scheduledAt).toISOString().slice(0, 16)
      : "",
  );
  // L6 #32：重复频率
  const [recurringFreq, setRecurringFreq] = useState<RecurringFreq>("daily");
  // L8 #34：会议密码
  const [password, setPassword] = useState(meeting?.password ?? "");
  const [passwordConfirm, setPasswordConfirm] = useState(meeting?.password ?? "");
  const [maxParticipants, setMaxParticipants] = useState(
    meeting?.maxParticipants ? String(meeting.maxParticipants) : "",
  );
  const [recordingEnabled, setRecordingEnabled] = useState(
    meeting?.recordingEnabled ?? false,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const dialogRef = useRef<HTMLDivElement>(null);

  // Esc 关闭 + focus trap
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // 自动聚焦标题输入
    const firstInput = dialogRef.current?.querySelector<HTMLElement>("input, textarea, select");
    firstInput?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle || submitting) return;

    // 预约/重复会议校验：必须填写预约时间
    if ((type === "scheduled" || type === "recurring") && !scheduledAt) {
      setError(t("scheduledAtRequired"));
      return;
    }

    // 密码确认校验：两次输入必须一致
    if (password.trim() && password !== passwordConfirm) {
      setError(t("passwordMismatch"));
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const body: CreateMeetingBody = {
        title: trimmedTitle,
        type,
        recordingEnabled,
      };
      if (description.trim()) body.description = description.trim();
      if (type === "scheduled" && scheduledAt) {
        body.scheduledAt = new Date(scheduledAt).toISOString();
      }
      // L6 #32：重复会议生成 iCal RRULE
      if (type === "recurring" && scheduledAt) {
        body.scheduledAt = new Date(scheduledAt).toISOString();
        body.recurringRule = `FREQ=${recurringFreq.toUpperCase()};INTERVAL=1`;
      }
      // L8 #34：会议密码（非空时才传递）
      if (password.trim()) body.password = password.trim();
      if (maxParticipants) {
        const n = parseInt(maxParticipants, 10);
        if (!Number.isNaN(n) && n > 0) body.maxParticipants = n;
      }

      if (isEdit && meeting) {
        // 编辑模式：PATCH 已有会议
        const updated = await api<CreatedMeeting>(
          `/api/v1/workspaces/${workspaceId}/meetings/${meeting.id}`,
          { method: "PATCH", body: JSON.stringify(body) },
        );
        onCreated(updated);
      } else {
        // 创建模式：POST 新会议
        const created = await api<CreatedMeeting>(
          `/api/v1/workspaces/${workspaceId}/meetings`,
          { method: "POST", body: JSON.stringify(body) },
        );
        onCreated(created);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("createFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  // 即时会议的最小日期时间（当前时间）
  const minDateTime = new Date().toISOString().slice(0, 16);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="meeting-create-title"
      className="fixed inset-0 z-[var(--z-modal)] flex items-start justify-center p-4 sm:p-8 overflow-y-auto bg-[var(--overlay)]"
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        onClose();
      }}
    >
      <div className="w-full max-w-lg my-auto bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-lg)]">
        {/* 头部 */}
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-soft)]">
          <h2
            id="meeting-create-title"
            className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]"
          >
            {isEdit ? tButton("edit") : t("create")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            aria-label={tButton("close")}
          >
            <X size={16} />
          </button>
        </header>

        {/* 表单 */}
        <form onSubmit={submit} className="px-4 sm:px-5 py-4 space-y-4">
          {/* 标题（必填） */}
          <div>
            <label className={fieldLabel} htmlFor="mc-title">
              {t("meetingTitle")}
              <span className="text-[var(--danger)]">*</span>
            </label>
            <input
              id="mc-title"

              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder={t("meetingTitlePlaceholder")}
              className={`${fieldControl} h-10`}
              aria-required="true"
            />
          </div>

          {/* 描述（可选） */}
          <div>
            <label className={fieldLabel} htmlFor="mc-desc">
              {t("description")}
            </label>
            <textarea
              id="mc-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder={t("descriptionPlaceholder")}
              className="w-full px-2.5 py-2 resize-y border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)]"
            />
          </div>

          {/* 类型 */}
          <div>
            <label className={fieldLabel}>{t("type")}</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setType("instant")}
                className={[
                  "flex-1 h-9 px-3 rounded-[var(--radius-md)] border text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] transition-colors duration-[var(--motion-fast)]",
                  type === "instant"
                    ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]"
                    : "border-[var(--border)] bg-[var(--surface)] text-[var(--fg-2)] hover:bg-[var(--surface-2)]",
                ].join(" ")}
                aria-pressed={type === "instant"}
              >
                {t("instant")}
              </button>
              <button
                type="button"
                onClick={() => setType("scheduled")}
                className={[
                  "flex-1 h-9 px-3 rounded-[var(--radius-md)] border text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] transition-colors duration-[var(--motion-fast)]",
                  type === "scheduled"
                    ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]"
                    : "border-[var(--border)] bg-[var(--surface)] text-[var(--fg-2)] hover:bg-[var(--surface-2)]",
                ].join(" ")}
                aria-pressed={type === "scheduled"}
              >
                {t("scheduled")}
              </button>
              {/* L6 #32：重复会议选项 */}
              <button
                type="button"
                onClick={() => setType("recurring")}
                className={[
                  "flex-1 h-9 px-3 rounded-[var(--radius-md)] border text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] transition-colors duration-[var(--motion-fast)]",
                  type === "recurring"
                    ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]"
                    : "border-[var(--border)] bg-[var(--surface)] text-[var(--fg-2)] hover:bg-[var(--surface-2)]",
                ].join(" ")}
                aria-pressed={type === "recurring"}
              >
                {t("recurring")}
              </button>
            </div>
          </div>

          {/* 预约时间（type=scheduled 或 recurring 时显示） */}
          {(type === "scheduled" || type === "recurring") && (
            <div>
              <label className={fieldLabel} htmlFor="mc-scheduled">
                {t("scheduledAt")}
                <span className="text-[var(--danger)]">*</span>
              </label>
              <input
                id="mc-scheduled"
                type="datetime-local"
                min={minDateTime}
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className={fieldControl}
                aria-required="true"
              />
            </div>
          )}

          {/* L6 #32：重复频率选择（仅 type=recurring 时显示） */}
          {type === "recurring" && (
            <div>
              <label className={fieldLabel} htmlFor="mc-recurring-freq">
                {t("recurringFreq")}
              </label>
              <select
                id="mc-recurring-freq"
                value={recurringFreq}
                onChange={(e) => setRecurringFreq(e.target.value as RecurringFreq)}
                className={fieldControl}
              >
                <option value="daily">{t("recurringDaily")}</option>
                <option value="weekly">{t("recurringWeekly")}</option>
                <option value="monthly">{t("recurringMonthly")}</option>
              </select>
            </div>
          )}

          {/* 最大参与人数 + 允许录制 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={fieldLabel} htmlFor="mc-max">
                {t("maxParticipants")}
              </label>
              <input
                id="mc-max"
                type="number"
                min={1}
                max={500}
                value={maxParticipants}
                onChange={(e) => setMaxParticipants(e.target.value)}
                placeholder={t("maxParticipantsPlaceholder")}
                className={fieldControl}
              />
            </div>
            <div>
              <label className={fieldLabel}>{t("recordingEnabled")}</label>
              <label className="inline-flex items-center gap-2 h-9 cursor-pointer">
                <input
                  type="checkbox"
                  checked={recordingEnabled}
                  onChange={(e) => setRecordingEnabled(e.target.checked)}
                  className="w-4 h-4 rounded-[var(--radius-sm)] border border-[var(--border)] accent-[var(--accent)]"
                />
                <span className="text-[length:var(--text-sm)] text-[var(--fg-2)]">
                  {recordingEnabled ? t("recordingOn") : t("recordingOff")}
                </span>
              </label>
            </div>
          </div>

          {/* L8 #34：会议密码（可选，设置后加入需验证） */}
          <div>
            <label className={fieldLabel} htmlFor="mc-password">
              {t("password")}
            </label>
            <input
              id="mc-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={100}
              placeholder={t("passwordPlaceholder")}
              className={fieldControl}
              autoComplete="new-password"
            />
          </div>

          {/* 密码确认 */}
          <div>
            <label className={fieldLabel} htmlFor="mc-password-confirm">
              {t("passwordConfirm")}
            </label>
            <input
              id="mc-password-confirm"
              type="password"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              maxLength={100}
              placeholder={t("passwordConfirmPlaceholder")}
              className={fieldControl}
              autoComplete="new-password"
            />
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-sm)]">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span className="flex-1">{error}</span>
              <button
                type="button"
                onClick={() => setError("")}
                className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
                aria-label={tButton("close")}
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            >
              {tButton("cancel")}
            </button>
            <button
              type="submit"
              disabled={!title.trim() || submitting}
              className="inline-flex items-center gap-1.5 h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            >
              {submitting && <Loader2 size={15} className="animate-spin" />}
              {submitting
                ? t("creating")
                : isEdit
                  ? tButton("save")
                  : t("create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}