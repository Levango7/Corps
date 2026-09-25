"use client";

/**
 * 邮件列表（MailList）
 *
 * 交互流程：
 *  1. 挂载时调用 GET /api/v1/mail/inbox 获取邮件列表
 *  2. 显示发件人 + 主题 + 时间 + 已读/星标状态
 *  3. 点击查看详情（GET /api/v1/mail/{id}）
 *  4. 支持删除（DELETE）、星标切换（PATCH isStarred）、标记已读（PATCH isRead）
 *
 * Design token 样式 + lucide-react 图标 size 14/16。
 * Props: { workspaceId, status? }
 *
 * 经验来源：2026-09-16-ai-assist-dialog-editable-results-batch-create-pattern
 *  - 样式全用 var(--fg)/var(--muted)/var(--surface)/var(--border) 等 token
 *  - lucide-react 图标 size 14 或 16：Star（星标）、Trash2（删除）、Loader2（loading）
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Star, Trash2, Loader2, AlertCircle, Mail, MailOpen, X } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/Toast";

/** 邮件列表项 */
interface MailItem {
  id: string;
  accountId: string;
  fromAddr: string;
  toAddr: string;
  ccAddr: string | null;
  subject: string;
  status: string;
  isRead: boolean;
  isStarred: boolean;
  sentAt: string | null;
  createdAt: string;
}

/** 邮件详情 */
interface MailDetail extends MailItem {
  bccAddr: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  attachments: unknown;
}

/** 列表响应 */
interface MailListResponse {
  items: MailItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** 格式化时间（简短相对时间） */
function formatMailTime(iso: string, t: ReturnType<typeof useTranslations>): string {
  const date = new Date(iso);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffMin < 1) return t("justNow");
  if (diffMin < 60) return t("minutesAgo", { count: diffMin });
  if (diffHour < 24) return t("hoursAgo", { count: diffHour });
  if (diffDay < 30) return t("daysAgo", { count: diffDay });
  return date.toLocaleDateString();
}

/** MailList Props */
interface MailListProps {
  /** 工作区 ID */
  workspaceId: string;
  /** 邮件状态过滤（draft/sent/received） */
  status?: string;
}

export default function MailList({ workspaceId, status }: MailListProps) {
  const t = useTranslations("mail");
  const { toast } = useToast();

  const [mails, setMails] = useState<MailItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedMail, setSelectedMail] = useState<MailDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [operatingId, setOperatingId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  /** 加载邮件列表 */
  async function loadMails() {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        wid: workspaceId,
        pageSize: "50",
      });
      if (status) params.set("status", status);
      const data = await api<MailListResponse>(`/api/v1/mail/inbox?${params.toString()}`, {
        signal: ac.signal,
      });
      if (ac.signal.aborted) return;
      setMails(data.items);
    } catch (e) {
      if (ac.signal.aborted || (e instanceof Error && e.name === "AbortError")) return;
      if (process.env.NODE_ENV === "development") console.error("[MailList] loadMails error:", e);
      setError(t("error"));
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    loadMails();
    return () => {
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, status]);

  /** 查看邮件详情 */
  async function openDetail(id: string) {
    setDetailLoading(true);
    setSelectedMail(null);
    try {
      const detail = await api<MailDetail>(
        `/api/v1/mail/${id}?wid=${encodeURIComponent(workspaceId)}`,
      );
      setSelectedMail(detail);
      // 若未读，标记已读
      const mail = mails.find((m) => m.id === id);
      if (mail && !mail.isRead) {
        await api(`/api/v1/mail/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ wid: workspaceId, isRead: true }),
        });
        setMails((prev) => prev.map((m) => (m.id === id ? { ...m, isRead: true } : m)));
      }
    } catch (e) {
      if (process.env.NODE_ENV === "development") console.error("[MailList] openDetail error:", e);
      toast("error", t("error"));
    } finally {
      setDetailLoading(false);
    }
  }

  /** 切换星标 */
  async function toggleStar(id: string, current: boolean) {
    if (operatingId) return;
    setOperatingId(id);
    try {
      await api(`/api/v1/mail/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ wid: workspaceId, isStarred: !current }),
      });
      setMails((prev) => prev.map((m) => (m.id === id ? { ...m, isStarred: !current } : m)));
    } catch (e) {
      if (process.env.NODE_ENV === "development") console.error("[MailList] toggleStar error:", e);
      toast("error", t("error"));
    } finally {
      setOperatingId(null);
    }
  }

  /** 删除邮件 */
  async function deleteMail(id: string) {
    if (operatingId) return;
    if (!window.confirm(t("deleteConfirm"))) return;
    setOperatingId(id);
    try {
      await api(`/api/v1/mail/${id}?wid=${encodeURIComponent(workspaceId)}`, { method: "DELETE" });
      setMails((prev) => prev.filter((m) => m.id !== id));
      if (selectedMail?.id === id) setSelectedMail(null);
      toast("success", t("deleted"));
    } catch (e) {
      if (process.env.NODE_ENV === "development") console.error("[MailList] deleteMail error:", e);
      toast("error", t("error"));
    } finally {
      setOperatingId(null);
    }
  }

  return (
    <div
      className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-sm)]"
      aria-label={t("inbox")}
    >
      {/* ── 头部 ── */}
      <header className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-soft)]">
        <h2 className="flex items-center gap-2 text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
          <Mail size={16} className="text-[var(--accent)]" />
          {t("inbox")}
        </h2>
        <span className="text-[length:var(--text-xs)] text-[var(--muted)]">{mails.length}</span>
      </header>

      {/* ── 正文 ── */}
      <div className="px-5 py-4 space-y-[var(--space-2)]">
        {/* 错误态 */}
        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-sm)]">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={() => setError("")}
              className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
              aria-label={t("close")}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* 加载态 */}
        {loading && (
          <div className="flex items-center justify-center py-8 text-[var(--muted)] text-[length:var(--text-sm)]">
            <Loader2 size={16} className="animate-spin mr-2" />
            {t("loading")}
          </div>
        )}

        {/* 空态 */}
        {!loading && mails.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-12 text-[var(--muted)] text-[length:var(--text-sm)] gap-2">
            <Mail size={32} className="opacity-40" />
            <p>{t("noMails")}</p>
          </div>
        )}

        {/* 邮件列表 */}
        {!loading && mails.length > 0 && (
          <div className="space-y-1">
            {mails.map((mail) => (
              <div
                key={mail.id}
                className="group flex items-center gap-2.5 px-2.5 py-2 rounded-[var(--radius-md)] hover:bg-[var(--surface-2)] transition-colors"
              >
                {/* 已读/未读图标 */}
                <button
                  type="button"
                  onClick={() => openDetail(mail.id)}
                  className="shrink-0 text-[var(--muted)] hover:text-[var(--accent)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] rounded-[var(--radius-sm)]"
                  aria-label={mail.isRead ? t("markUnread") : t("markRead")}
                >
                  {mail.isRead ? (
                    <MailOpen size={14} />
                  ) : (
                    <Mail size={14} className="text-[var(--accent)]" />
                  )}
                </button>

                {/* 主要内容 */}
                <button
                  type="button"
                  onClick={() => openDetail(mail.id)}
                  className="flex-1 min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] rounded-[var(--radius-sm)]"
                >
                  <div className="flex items-baseline gap-2">
                    <span
                      className={`text-[length:var(--text-sm)] truncate ${
                        mail.isRead
                          ? "text-[var(--muted)] font-[weight:var(--weight-regular)]"
                          : "text-[var(--fg)] font-[weight:var(--weight-semibold)]"
                      }`}
                    >
                      {mail.fromAddr}
                    </span>
                    <span className="shrink-0 text-[length:var(--text-xs)] text-[var(--meta)] tabular-nums ml-auto">
                      {formatMailTime(mail.sentAt ?? mail.createdAt, t)}
                    </span>
                  </div>
                  <p
                    className={`text-[length:var(--text-xs)] truncate mt-0.5 ${
                      mail.isRead ? "text-[var(--muted)]" : "text-[var(--fg)]"
                    }`}
                  >
                    {mail.subject}
                  </p>
                </button>

                {/* 星标按钮 */}
                <button
                  type="button"
                  onClick={() => toggleStar(mail.id, mail.isStarred)}
                  disabled={operatingId === mail.id}
                  className="shrink-0 p-1 rounded-[var(--radius-sm)] text-[var(--muted)] hover:text-[var(--accent)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:opacity-50"
                  aria-label={mail.isStarred ? t("unstar") : t("star")}
                  title={mail.isStarred ? t("unstar") : t("star")}
                >
                  <Star
                    size={14}
                    className={mail.isStarred ? "text-[var(--accent)]" : ""}
                    fill={mail.isStarred ? "currentColor" : "none"}
                  />
                </button>

                {/* 删除按钮 */}
                <button
                  type="button"
                  onClick={() => deleteMail(mail.id)}
                  disabled={operatingId === mail.id}
                  className="shrink-0 p-1 rounded-[var(--radius-sm)] text-[var(--muted)] hover:text-[var(--danger-fg)] hover:bg-[var(--danger-soft)] transition-colors opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:opacity-50"
                  aria-label={t("delete")}
                  title={t("delete")}
                >
                  {operatingId === mail.id ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Trash2 size={14} />
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 邮件详情弹层 ── */}
      {selectedMail && (
        <div
          className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-[var(--overlay)] p-4"
          onClick={() => setSelectedMail(null)}
        >
          <div
            className="w-full max-w-2xl max-h-[80vh] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-lg)] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 详情头部 */}
            <header className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-soft)]">
              <h3 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)] truncate">
                {selectedMail.subject}
              </h3>
              <button
                type="button"
                onClick={() => setSelectedMail(null)}
                className="shrink-0 p-1 rounded-[var(--radius-sm)] text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                aria-label={t("cancel")}
              >
                <X size={16} />
              </button>
            </header>

            {/* 详情正文 */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              <div className="flex items-center gap-2 text-[length:var(--text-sm)]">
                <span className="font-[weight:var(--weight-medium)] text-[var(--muted)]">
                  {t("from")}:
                </span>
                <span className="text-[var(--fg)]">{selectedMail.fromAddr}</span>
              </div>
              <div className="flex items-center gap-2 text-[length:var(--text-sm)]">
                <span className="font-[weight:var(--weight-medium)] text-[var(--muted)]">
                  {t("to")}:
                </span>
                <span className="text-[var(--fg)]">{selectedMail.toAddr}</span>
              </div>
              <div className="flex items-center gap-2 text-[length:var(--text-sm)]">
                <span className="font-[weight:var(--weight-medium)] text-[var(--muted)]">
                  {t("date")}:
                </span>
                <span className="text-[var(--fg)]">
                  {new Date(selectedMail.sentAt ?? selectedMail.createdAt).toLocaleString()}
                </span>
              </div>
              <hr className="border-[var(--border-soft)]" />
              <pre className="whitespace-pre-wrap break-words text-[length:var(--text-sm)] text-[var(--fg)] font-[family-name:var(--font-body)]">
                {selectedMail.bodyText ?? ""}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* 详情加载态 */}
      {detailLoading && (
        <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-[var(--overlay)] p-4">
          <div className="flex items-center text-[var(--fg)] text-[length:var(--text-sm)] gap-2">
            <Loader2 size={16} className="animate-spin" />
            {t("loading")}
          </div>
        </div>
      )}
    </div>
  );
}
