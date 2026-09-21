"use client";

/**
 * 审批列表组件。
 *
 * 功能：
 * - 标签页切换：待审批 / 我发起的 / 我抄送的 / 全部
 * - 拉取审批实例列表（GET /api/v1/workspaces/{wid}/approvals/instances）
 * - 拉取抄送列表（GET /api/v1/workspaces/{wid}/approvals/cc）
 * - 每条：标题、申请人、状态标签（颜色区分）、提交时间
 * - 点击跳转详情页
 * - 分页（page + limit）
 * - 优先级筛选（前端应用层过滤）
 * - 搜索框（按标题和申请人名称前端过滤）
 *
 * 状态颜色映射（design token，禁止裸 hex）：
 * - pending  → var(--warning) / var(--warning-fg)
 * - approved → var(--success) / var(--success-fg)
 * - rejected → var(--danger)  / var(--danger-fg)
 * - withdrawn→ var(--muted)
 */

import { useEffect, useState, useMemo } from "react";
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
  Search,
  Filter,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";

/** 审批实例列表项（与后端 GET /instances 响应一致） */
export interface ApprovalInstanceListItem {
  id: string;
  title: string;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  applicantId: string;
  /** 申请人嵌套对象（后端 Prisma include 返回） */
  applicant?: {
    id: string;
    name?: string | null;
    email?: string | null;
  } | null;
  /** @deprecated 旧平铺字段，保留兼容 */
  applicantName?: string | null;
  /** @deprecated 旧平铺字段，保留兼容 */
  applicantEmail?: string | null;
  templateId?: string | null;
  templateName?: string | null;
  currentNode?: number;
  totalNodes?: number;
  priority?: "normal" | "urgent" | "critical" | null;
  submittedAt: string;
  completedAt?: string | null;
}

/** 抄送记录（与后端 GET /approvals/cc 响应一致） */
interface ApprovalCcRecord {
  id: string;
  instanceId: string;
  userId: string;
  nodeIndex: number;
  readAt?: string | null;
  createdAt: string;
  instance: {
    id: string;
    title: string;
    status: "pending" | "approved" | "rejected" | "withdrawn";
    applicant: {
      id: string;
      name?: string | null;
      email?: string | null;
    };
  };
}

/** 分页响应信封（后端通用格式） */
interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

type Tab = "pending" | "mine" | "cc" | "all";
type PriorityFilter = "all" | "normal" | "urgent" | "critical";

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

/** 将抄送记录转换为 ApprovalInstanceListItem 兼容格式 */
function ccRecordToItem(record: ApprovalCcRecord): ApprovalInstanceListItem {
  return {
    id: record.instance.id,
    title: record.instance.title,
    status: record.instance.status,
    applicantId: record.instance.applicant.id,
    applicant: {
      id: record.instance.applicant.id,
      name: record.instance.applicant.name,
      email: record.instance.applicant.email,
    },
    submittedAt: record.createdAt,
  };
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
  const [searchQuery, setSearchQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        if (tab === "cc") {
          // 抄送列表使用不同的 API 端点
          const data = await api<
            PaginatedResponse<ApprovalCcRecord> | ApprovalCcRecord[]
          >(
            `/api/v1/workspaces/${workspaceId}/approvals/cc?page=${page}&limit=${PAGE_LIMIT}`,
          );
          if (cancelled) return;
          // 兼容分页信封与裸数组两种响应
          if (Array.isArray(data)) {
            const converted = data.map(ccRecordToItem);
            setItems(converted);
            setTotal(converted.length);
            setTotalPages(1);
          } else {
            const converted = (data.items ?? []).map(ccRecordToItem);
            setItems(converted);
            setTotal(data.total ?? 0);
            setTotalPages(data.totalPages ?? 1);
          }
        } else {
          const params = new URLSearchParams();
          params.set("page", String(page));
          params.set("limit", String(PAGE_LIMIT));
          if (tab === "pending") {
            params.set("status", "pending");
          } else if (tab === "mine") {
            params.set("mine", "1");
          }
          const data = await api<
            PaginatedResponse<ApprovalInstanceListItem> | ApprovalInstanceListItem[]
          >(
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

  // 前端过滤：优先级 + 搜索（后端 API 不支持这些参数）
  const filteredItems = useMemo(() => {
    let result = items;
    if (priorityFilter !== "all") {
      result = result.filter((item) => item.priority === priorityFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((item) => {
        const applicantName =
          item.applicant?.name ||
          item.applicant?.email ||
          item.applicantName ||
          item.applicantEmail ||
          "";
        return (
          item.title.toLowerCase().includes(q) ||
          applicantName.toLowerCase().includes(q)
        );
      });
    }
    return result;
  }, [items, priorityFilter, searchQuery]);

  // 切换标签页时重置到第一页
  function switchTab(next: Tab) {
    if (next === tab) return;
    setTab(next);
    setPage(1);
  }

  const tabs: { key: Tab; labelKey: string }[] = [
    { key: "pending", labelKey: "pending" },
    { key: "mine", labelKey: "mine" },
    { key: "cc", labelKey: "ccTab" },
    { key: "all", labelKey: "all" },
  ];

  const priorityOptions: { value: PriorityFilter; labelKey: string }[] = [
    { value: "all", labelKey: "priority" },
    { value: "normal", labelKey: "priorityNormal" },
    { value: "urgent", labelKey: "priorityUrgent" },
    { value: "critical", labelKey: "priorityCritical" },
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

      {/* 筛选与搜索区域 */}
      <div className="flex items-center gap-3 mb-[var(--space-4)] flex-wrap">
        {/* 优先级筛选 */}
        <div className="relative inline-flex items-center">
          <Filter
            size={14}
            className="absolute left-2 text-[var(--muted)] pointer-events-none"
          />
          <select
            value={priorityFilter}
            onChange={(e) =>
              setPriorityFilter(e.target.value as PriorityFilter)
            }
            className="h-8 pl-7 pr-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] cursor-pointer"
            aria-label={t("priority")}
          >
            {priorityOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </option>
            ))}
          </select>
        </div>

        {/* 搜索框 */}
        <div className="relative inline-flex items-center flex-1 min-w-[200px]">
          <Search
            size={14}
            className="absolute left-2 text-[var(--muted)] pointer-events-none"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="h-8 w-full pl-7 pr-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] placeholder:text-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
          />
        </div>
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
      ) : filteredItems.length === 0 ? (
        <div className="py-[var(--space-12)] text-center text-[var(--muted)]">
          <FileText size={36} className="mx-auto mb-3 opacity-50" />
          <p>{t("noApprovals")}</p>
        </div>
      ) : (
        <>
          <ul className="divide-y divide-[var(--border-soft)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
            {filteredItems.map((item) => {
              const visual = getStatusVisual(item.status);
              const applicant =
                item.applicant?.name ||
                item.applicant?.email ||
                item.applicantName ||
                item.applicantEmail ||
                "—";
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
