"use client";

/**
 * 审批列表组件。
 *
 * 功能：
 * - 标签页切换：待审批 / 我发起的 / 全部
 * - 拉取审批实例列表（GET /api/v1/workspaces/{wid}/approvals/instances）
 * - 每条：标题、申请人、状态标签（颜色区分）、提交时间
 * - 点击跳转详情页
 * - 分页（page + limit）
 *
 * 状态颜色映射（design token，禁止裸 hex）：
 * - pending  → var(--warning) / var(--warning-fg)
 * - approved → var(--success) / var(--success-fg)
 * - rejected → var(--danger)  / var(--danger-fg)
 * - withdrawn→ var(--muted)
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/lib/i18n-navigation";
import {
  CheckCircle2,
  XCircle,
  Clock,
  FileText,
  Loader2,
  ChevronLeft,
  ChevronRight,
  MinusCircle,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";

/** 审批实例列表项（与后端 GET /instances 响应一致） */
export interface ApprovalInstanceListItem {
  id: string;
  title: string;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  applicantId: string;
  applicantName?: string | null;
  applicantEmail?: string | null;
  templateId?: string | null;
  templateName?: string | null;
  currentNode?: number;
  totalNodes?: number;
  submittedAt: string;
  completedAt?: string | null;
}

/** 分页响应信封（后端通用格式） */
interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

type Tab = "pending" | "mine" | "all";

const PAGE_LIMIT = 20;

/** 状态 → 图标 + 颜色 token 映射 */
function getStatusVisual(status: ApprovalInstanceListItem["status"]) {
  switch (status) {
    case "approved":
      return {
        icon: <CheckCircle2 size={14} className="shrink-0" />,
        color: "var(--success)",
        bg: "var(--success-soft, var(--surface-2))",
        labelKey: "approved",
      };
    case "rejected":
      return {
        icon: <XCircle size={14} className="shrink-0" />,
        color: "var(--danger)",
        bg: "var(--danger-soft, var(--surface-2))",
        labelKey: "rejected",
      };
    case "withdrawn":
      return {
        icon: <MinusCircle size={14} className="shrink-0" />,
        color: "var(--muted)",
        bg: "var(--surface-2)",
        labelKey: "withdrawn",
      };
    case "pending":
    default:
      return {
        icon: <Clock size={14} className="shrink-0" />,
        color: "var(--warning, var(--accent))",
        bg: "var(--warning-soft, var(--surface-2))",
        labelKey: "pending",
      };
  }
}

interface ApprovalListProps {
  workspaceId: string;
}

export function ApprovalList({ workspaceId }: ApprovalListProps) {
  const t = useTranslations("approval");
  const [tab, setTab] = useState<Tab>("pending");
  const [items, setItems] = useState<ApprovalInstanceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("limit", String(PAGE_LIMIT));
        if (tab === "pending") {
          params.set("status", "pending");
        } else if (tab === "mine") {
          params.set("mine", "true");
        }
        const data = await api<PaginatedResponse<ApprovalInstanceListItem> | ApprovalInstanceListItem[]>(
          `/api/v1/workspaces/${workspaceId}/approvals/instances?${params.toString()}`,
        );
        if (cancelled) return;
        // 兼容分页信封与裸数组两种响应
        if (Array.isArray(data)) {
          setItems(data);
          setTotal(data.length);
          setTotalPages(1);
        } else {
          setItems(data.items ?? []);
          setTotal(data.total ?? 0);
          setTotalPages(data.totalPages ?? 1);
        }
      } catch (e) {
        if (cancelled) return;
        setError(
          e instanceof ApiError || e instanceof Error
            ? e.message
            : t("loadFailed"),
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, tab, page, t]);

  // 切换标签页时重置到第一页
  function switchTab(next: Tab) {
    if (next === tab) return;
    setTab(next);
    setPage(1);
  }

  const tabs: { key: Tab; labelKey: string }[] = [
    { key: "pending", labelKey: "pending" },
    { key: "mine", labelKey: "mine" },
    { key: "all", labelKey: "all" },
  ];

  return (
    <div className="max-w-[var(--container-max)] mx-auto px-[var(--space-4)] py-[var(--space-6)]">
      <h1 className="text-[length:var(--text-2xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tracking-[var(--tracking-tight)] mb-[var(--space-5)]">
        {t("title")}
      </h1>

      {/* 标签页切换 */}
      <div
        role="tablist"
        aria-label={t("title")}
        className="inline-flex items-center gap-1 p-1 mb-[var(--space-4)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)]"
      >
        {tabs.map((tabItem) => {
          const active = tabItem.key === tab;
          return (
            <button
              key={tabItem.key}
              role="tab"
              aria-selected={active}
              onClick={() => switchTab(tabItem.key)}
              className={`h-8 px-3 rounded-[var(--radius-sm)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] ${
                active
                  ? "bg-[var(--surface)] text-[var(--fg)] shadow-[var(--elev-sm)]"
                  : "text-[var(--fg-2)] hover:text-[var(--fg)]"
              }`}
            >
              {t(tabItem.labelKey)}
            </button>
          );
        })}
      </div>

      {error && (
        <p className="mb-3 text-[length:var(--text-sm)] text-[var(--danger)]">
          {error}
        </p>
      )}

      {loading ? (
        <div className="py-[var(--space-12)] text-center text-[var(--muted)]">
          <Loader2 size={20} className="inline animate-spin mr-2" />
          {t("loading")}
        </div>
      ) : items.length === 0 ? (
        <div className="py-[var(--space-12)] text-center text-[var(--muted)]">
          <FileText size={36} className="mx-auto mb-3 opacity-50" />
          <p>{t("noApprovals")}</p>
        </div>
      ) : (
        <>
          <ul className="divide-y divide-[var(--border-soft)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
            {items.map((item) => {
              const visual = getStatusVisual(item.status);
              const applicant =
                item.applicantName || item.applicantEmail || "—";
              return (
                <li key={item.id}>
                  <Link
                    href={`/w/${workspaceId}/approvals/${item.id}`}
                    className="block px-[var(--space-4)] py-3 hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
                  >
                    <div className="flex items-center gap-2">
                      <FileText
                        size={15}
                        className="shrink-0 text-[var(--muted)]"
                      />
                      <span className="flex-1 min-w-0 text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)] truncate">
                        {item.title}
                      </span>
                      <span
                        className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)]"
                        style={{ color: visual.color, background: visual.bg }}
                      >
                        {visual.icon}
                        {t(visual.labelKey)}
                      </span>
                    </div>
                    <div className="mt-1 ml-6 text-[length:var(--text-xs)] text-[var(--muted)] flex items-center gap-2 flex-wrap">
                      <span>{t("applicant")}: {applicant}</span>
                      <span>·</span>
                      <span>
                        {t("submittedAt")}:{" "}
                        {new Date(item.submittedAt).toLocaleString()}
                      </span>
                      {item.templateName && (
                        <>
                          <span>·</span>
                          <span className="truncate max-w-[200px]">
                            {item.templateName}
                          </span>
                        </>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-[var(--space-4)]">
              <span className="text-[length:var(--text-xs)] text-[var(--muted)]">
                {t("total", { count: total })}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="inline-flex items-center gap-1 h-8 px-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-fast)]"
                  aria-label={t("prevPage")}
                >
                  <ChevronLeft size={14} />
                  {t("prevPage")}
                </button>
                <span className="text-[length:var(--text-sm)] text-[var(--fg-2)] min-w-[80px] text-center">
                  {t("page", { page, total: totalPages })}
                </span>
                <button
                  onClick={() =>
                    setPage((p) => Math.min(totalPages, p + 1))
                  }
                  disabled={page >= totalPages}
                  className="inline-flex items-center gap-1 h-8 px-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-fast)]"
                  aria-label={t("nextPage")}
                >
                  {t("nextPage")}
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default ApprovalList;