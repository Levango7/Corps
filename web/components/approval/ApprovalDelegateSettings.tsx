"use client";

/**
 * 审批委托设置组件。
 *
 * 功能：
 * - 委托列表（代理人姓名、起止时间、原因、状态）
 * - 撤销委托（DELETE）
 * - 创建委托表单（选择代理人、起止时间、原因）
 *
 * API：
 * - GET    /approvals/delegates?page=1&limit=20&active=1
 * - POST   /approvals/delegates
 * - DELETE /approvals/delegates/{did}
 *
 * 工作区成员列表（GET /members）用于代理人选择。
 */

import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import {
  Loader2,
  Trash2,
  UserCog,
  CheckCircle2,
  XCircle,
  Plus,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";

/** 审批委托 */
interface ApprovalDelegate {
  id: string;
  workspaceId: string;
  delegatorId: string;
  delegateToId: string;
  startAt: string;
  endAt: string;
  reason?: string | null;
  active: boolean;
  createdAt: string;
  delegateTo: {
    id: string;
    name: string;
    email: string;
  };
}

/** 委托列表响应 */
interface DelegateListResponse {
  items: ApprovalDelegate[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** 工作区成员 */
interface Member {
  id: string;
  name: string | null;
  email: string;
}

interface ApprovalDelegateSettingsProps {
  workspaceId: string;
}

const fieldLabel =
  "flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--meta)] mb-1.5";
const fieldControl =
  "w-full h-9 px-2.5 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]";

/** 判断委托是否已过期（endAt 早于当前时间） */
function isExpired(endAt: string): boolean {
  return new Date(endAt).getTime() < Date.now();
}

/** 将 datetime-local 值转为 ISO 8601 格式 */
function toISO(datetimeLocalValue: string): string {
  // datetime-local 格式: "2026-09-21T14:30"，直接 new Date() 即可解析
  return new Date(datetimeLocalValue).toISOString();
}

/** 格式化日期时间用于显示 */
function formatDateTime(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ApprovalDelegateSettings({
  workspaceId,
}: ApprovalDelegateSettingsProps) {
  const t = useTranslations("approval");

  const [delegates, setDelegates] = useState<ApprovalDelegate[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 创建委托表单状态
  const [showForm, setShowForm] = useState(false);
  const [delegateToId, setDelegateToId] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  async function loadDelegates() {
    setLoading(true);
    setError("");
    try {
      const data = await api<DelegateListResponse>(
        `/api/v1/workspaces/${workspaceId}/approvals/delegates?page=1&limit=20&active=1`,
      );
      setDelegates(data.items ?? []);
    } catch (e) {
      setError(
        e instanceof ApiError || e instanceof Error
          ? e.message
          : t("loadFailed"),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDelegates();
    // 拉取成员列表用于代理人选择
    api<Member[] | { items: Member[] }>(
      `/api/v1/workspaces/${workspaceId}/members`,
    )
      .then((data) => {
        const list = Array.isArray(data) ? data : (data.items ?? []);
        setMembers(list);
      })
      .catch(() => {
        // 成员列表加载失败不阻塞委托管理
      });
  }, [workspaceId, t]);

  async function revokeDelegate(delegate: ApprovalDelegate) {
    if (!window.confirm(t("confirmDelegate"))) return;
    try {
      await api(
        `/api/v1/workspaces/${workspaceId}/approvals/delegates/${delegate.id}`,
        { method: "DELETE" },
      );
      setDelegates((prev) => prev.filter((d) => d.id !== delegate.id));
    } catch (e) {
      setError(
        e instanceof ApiError || e instanceof Error
          ? e.message
          : t("operationFailed"),
      );
    }
  }

  async function submitDelegate(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!delegateToId) {
      setFormError(t("selectUser"));
      return;
    }
    if (!startAt || !endAt) {
      setFormError(t("delegateStartAt") + " / " + t("delegateEndAt"));
      return;
    }
    if (new Date(startAt) >= new Date(endAt)) {
      setFormError(t("delegateEndAt"));
      return;
    }
    setSubmitting(true);
    setFormError("");
    try {
      await api(
        `/api/v1/workspaces/${workspaceId}/approvals/delegates`,
        {
          method: "POST",
          body: JSON.stringify({
            delegateToId,
            startAt: toISO(startAt),
            endAt: toISO(endAt),
            reason: reason.trim() || undefined,
          }),
        },
      );
      // 成功后刷新委托列表并关闭表单
      setShowForm(false);
      setDelegateToId("");
      setStartAt("");
      setEndAt("");
      setReason("");
      loadDelegates();
    } catch (e) {
      setFormError(
        e instanceof ApiError || e instanceof Error
          ? e.message
          : t("operationFailed"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-[var(--container-max)] mx-auto px-[var(--space-4)] py-[var(--space-6)]">
      <div className="flex items-center justify-between mb-[var(--space-5)]">
        <h1 className="text-[length:var(--text-2xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tracking-[var(--tracking-tight)]">
          {t("delegateSettings")}
        </h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-fast)]"
        >
          <Plus size={14} />
          {t("delegate")}
        </button>
      </div>

      {error && (
        <p className="mb-3 text-[length:var(--text-sm)] text-[var(--danger)]">
          {error}
        </p>
      )}

      {/* 创建委托表单 */}
      {showForm && (
        <form
          onSubmit={submitDelegate}
          className="mb-[var(--space-5)] p-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] space-y-4"
        >
          {/* 选择代理人 */}
          <div>
            <label className={fieldLabel} htmlFor="delegate-to">
              {t("delegateTo")}
            </label>
            <select
              id="delegate-to"
              value={delegateToId}
              onChange={(e) => setDelegateToId(e.target.value)}
              className={fieldControl}
              aria-required="true"
            >
              <option value="">{t("selectUser")}</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name || m.email}
                </option>
              ))}
            </select>
          </div>

          {/* 开始时间 */}
          <div>
            <label className={fieldLabel} htmlFor="delegate-start">
              {t("delegateStartAt")}
            </label>
            <input
              id="delegate-start"
              type="datetime-local"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
              className={fieldControl}
              aria-required="true"
            />
          </div>

          {/* 结束时间 */}
          <div>
            <label className={fieldLabel} htmlFor="delegate-end">
              {t("delegateEndAt")}
            </label>
            <input
              id="delegate-end"
              type="datetime-local"
              value={endAt}
              onChange={(e) => setEndAt(e.target.value)}
              className={fieldControl}
              aria-required="true"
            />
          </div>

          {/* 原因（可选） */}
          <div>
            <label className={fieldLabel} htmlFor="delegate-reason">
              {t("delegateReason")}
            </label>
            <textarea
              id="delegate-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={500}
              className="w-full px-2.5 py-2 resize-y border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)]"
            />
          </div>

          {formError && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-[var(--radius-md)] bg-[var(--danger-soft, var(--surface-2))] text-[var(--danger-fg, var(--danger))] text-[length:var(--text-sm)]">
              <span className="flex-1">{formError}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setFormError("");
              }}
              className="h-9 px-4 rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            >
              {t("cancel")}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-1.5 h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {t("save")}
            </button>
          </div>
        </form>
      )}

      {/* 委托列表 */}
      {loading ? (
        <div className="py-[var(--space-12)] text-center text-[var(--muted)]">
          <Loader2 size={20} className="inline animate-spin mr-2" />
          {t("loading")}
        </div>
      ) : delegates.length === 0 ? (
        <div className="py-[var(--space-12)] text-center text-[var(--muted)]">
          <UserCog size={36} className="mx-auto mb-3 opacity-50" />
          <p>{t("noDelegates")}</p>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--border-soft)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
          {delegates.map((delegate) => {
            const expired = isExpired(delegate.endAt);
            return (
              <li
                key={delegate.id}
                className="px-[var(--space-4)] py-3 hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
              >
                <div className="flex items-center gap-2">
                  <UserCog
                    size={15}
                    className="shrink-0 text-[var(--muted)]"
                  />
                  <span className="flex-1 min-w-0 text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)] truncate">
                    {delegate.delegateTo?.name || delegate.delegateTo?.email || t("delegateTo")}
                  </span>
                  <span
                    className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] ${
                      expired
                        ? "text-[var(--muted)] bg-[var(--surface-2)]"
                        : "text-[var(--success)] bg-[var(--success-soft, var(--surface-2))]"
                    }`}
                  >
                    {expired ? (
                      <XCircle size={12} />
                    ) : (
                      <CheckCircle2 size={12} />
                    )}
                    {expired ? t("delegateExpired") : t("delegateActive")}
                  </span>
                </div>
                {/* 起止时间 */}
                <div className="mt-1.5 ml-6 flex items-center gap-3 text-[length:var(--text-xs)] text-[var(--meta)]">
                  <span>
                    {t("delegateStartAt")}: {formatDateTime(delegate.startAt)}
                  </span>
                  <span>
                    {t("delegateEndAt")}: {formatDateTime(delegate.endAt)}
                  </span>
                </div>
                {/* 原因 */}
                {delegate.reason && (
                  <p className="mt-1 ml-6 text-[length:var(--text-xs)] text-[var(--muted)] break-words">
                    {t("delegateReason")}: {delegate.reason}
                  </p>
                )}
                {/* 撤销按钮 */}
                <div className="mt-2 ml-6 flex items-center gap-2">
                  <button
                    onClick={() => revokeDelegate(delegate)}
                    className="inline-flex items-center gap-1 h-7 px-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-xs)] text-[var(--danger)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
                  >
                    <Trash2 size={12} />
                    {t("cancel")}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default ApprovalDelegateSettings;