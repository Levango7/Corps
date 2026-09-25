"use client";

/**
 * 权限审计日志页面组件。
 *
 * 功能：
 * - 拉取审计日志列表（GET /api/v1/workspaces/{wid}/permissions/audit-logs）
 * - 筛选：目标类型（document/folder/space）、操作类型（grant/revoke/update）、时间范围
 * - 每条日志：操作类型、目标类型/ID、授权对象类型/ID、原权限、新权限、操作人、原因、时间
 * - 分页（page + pageSize）
 *
 * 操作类型颜色映射（design token，禁止裸 hex）：
 * - grant  → var(--success) / var(--success-soft)
 * - revoke → var(--danger)  / var(--danger-soft)
 * - update → var(--warning) / var(--warning-soft)
 */

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  ShieldCheck,
  ShieldX,
  ShieldAlert,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Filter,
  Calendar,
  FileText,
  FolderClosed,
  Layers,
  ScrollText,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";

/** 审计日志条目（与后端 API 响应一致） */
interface AuditLogEntry {
  id: string;
  action: "grant" | "revoke" | "update";
  targetType: "document" | "folder" | "space";
  targetId: string;
  granteeType: "user" | "role";
  granteeId: string;
  oldPermission: string | null;
  newPermission: string | null;
  operatorId: string;
  operator?: {
    id: string;
    name?: string | null;
    email?: string | null;
  } | null;
  reason: string | null;
  createdAt: string;
}

/** 分页响应信封（后端通用格式） */
interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

type TargetTypeFilter = "all" | "document" | "folder" | "space";
type ActionTypeFilter = "all" | "grant" | "revoke" | "update";

const PAGE_SIZE = 20;

/** 操作类型 → 图标 + 颜色 token 映射 */
function getActionVisual(action: AuditLogEntry["action"]) {
  switch (action) {
    case "grant":
      return {
        icon: <ShieldCheck size={14} className="shrink-0" />,
        color: "var(--success)",
        bg: "var(--success-soft, var(--surface-2))",
        labelKey: "actionGrant",
      };
    case "revoke":
      return {
        icon: <ShieldX size={14} className="shrink-0" />,
        color: "var(--danger)",
        bg: "var(--danger-soft, var(--surface-2))",
        labelKey: "actionRevoke",
      };
    case "update":
    default:
      return {
        icon: <ShieldAlert size={14} className="shrink-0" />,
        color: "var(--warning, var(--accent))",
        bg: "var(--warning-soft, var(--surface-2))",
        labelKey: "actionUpdate",
      };
  }
}

/** 目标类型 → 图标映射 */
function getTargetTypeIcon(targetType: AuditLogEntry["targetType"]) {
  switch (targetType) {
    case "document":
      return <FileText size={14} className="shrink-0 text-[var(--muted)]" />;
    case "folder":
      return <FolderClosed size={14} className="shrink-0 text-[var(--muted)]" />;
    case "space":
      return <Layers size={14} className="shrink-0 text-[var(--muted)]" />;
    default:
      return <ScrollText size={14} className="shrink-0 text-[var(--muted)]" />;
  }
}

/** 权限级别 → 翻译键映射 */
function getPermissionLabelKey(permission: string | null): string | null {
  if (!permission) return null;
  const validLevels = ["view", "comment", "edit", "manage"];
  if (validLevels.includes(permission)) return permission;
  return null;
}

interface PermissionAuditLogPageProps {
  workspaceId: string;
}

export function PermissionAuditLogPage({ workspaceId }: PermissionAuditLogPageProps) {
  const t = useTranslations("permissions");
  const [items, setItems] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // 筛选状态
  const [targetTypeFilter, setTargetTypeFilter] = useState<TargetTypeFilter>("all");
  const [actionTypeFilter, setActionTypeFilter] = useState<ActionTypeFilter>("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  /** 构建筛选查询参数 */
  const buildQueryParams = useCallback(
    (currentPage: number) => {
      const params = new URLSearchParams();
      params.set("page", String(currentPage));
      params.set("pageSize", String(PAGE_SIZE));
      if (targetTypeFilter !== "all") {
        params.set("targetType", targetTypeFilter);
      }
      if (actionTypeFilter !== "all") {
        params.set("action", actionTypeFilter);
      }
      if (startDate) {
        params.set("startDate", startDate);
      }
      if (endDate) {
        params.set("endDate", endDate);
      }
      return params.toString();
    },
    [targetTypeFilter, actionTypeFilter, startDate, endDate],
  );

  /** 拉取审计日志数据 */
  const fetchAuditLogs = useCallback(
    async (currentPage: number) => {
      setLoading(true);
      setError("");
      try {
        const queryString = buildQueryParams(currentPage);
        const data = await api<PaginatedResponse<AuditLogEntry> | AuditLogEntry[]>(
          `/api/v1/workspaces/${workspaceId}/permissions/audit-logs?${queryString}`,
        );
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
        setError(e instanceof ApiError || e instanceof Error ? e.message : t("noAuditLogs"));
      } finally {
        setLoading(false);
      }
    },
    [workspaceId, buildQueryParams, t],
  );

  useEffect(() => {
    fetchAuditLogs(page);
  }, [fetchAuditLogs, page]);

  /** 应用筛选条件时重置到第一页并重新拉取 */
  function applyFilters() {
    setPage(1);
    fetchAuditLogs(1);
  }

  /** 重置所有筛选条件 */
  function resetFilters() {
    setTargetTypeFilter("all");
    setActionTypeFilter("all");
    setStartDate("");
    setEndDate("");
    setPage(1);
  }

  const targetTypeOptions: {
    value: TargetTypeFilter;
    labelKey: string;
  }[] = [
    { value: "all", labelKey: "action" },
    { value: "document", labelKey: "document" },
    { value: "folder", labelKey: "folder" },
    { value: "space", labelKey: "space" },
  ];

  const actionTypeOptions: {
    value: ActionTypeFilter;
    labelKey: string;
  }[] = [
    { value: "all", labelKey: "action" },
    { value: "grant", labelKey: "actionGrant" },
    { value: "revoke", labelKey: "actionRevoke" },
    { value: "update", labelKey: "actionUpdate" },
  ];

  return (
    <div className="max-w-[var(--container-max)] mx-auto px-[var(--space-4)] py-[var(--space-6)]">
      <h1 className="text-[length:var(--text-2xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tracking-[var(--tracking-tight)] mb-[var(--space-5)]">
        {t("auditLogs")}
      </h1>

      {/* 筛选区域 */}
      <div className="flex items-center gap-3 mb-[var(--space-4)] flex-wrap">
        {/* 目标类型筛选 */}
        <div className="relative inline-flex items-center">
          <Filter size={14} className="absolute left-2 text-[var(--muted)] pointer-events-none" />
          <select
            value={targetTypeFilter}
            onChange={(e) => setTargetTypeFilter(e.target.value as TargetTypeFilter)}
            className="h-8 pl-7 pr-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] cursor-pointer"
            aria-label={t("targetType")}
          >
            {targetTypeOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.value === "all" ? t("targetType") : t(opt.labelKey)}
              </option>
            ))}
          </select>
        </div>

        {/* 操作类型筛选 */}
        <div className="relative inline-flex items-center">
          <ShieldAlert
            size={14}
            className="absolute left-2 text-[var(--muted)] pointer-events-none"
          />
          <select
            value={actionTypeFilter}
            onChange={(e) => setActionTypeFilter(e.target.value as ActionTypeFilter)}
            className="h-8 pl-7 pr-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] cursor-pointer"
            aria-label={t("action")}
          >
            {actionTypeOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.value === "all" ? t("action") : t(opt.labelKey)}
              </option>
            ))}
          </select>
        </div>

        {/* 时间范围筛选 */}
        <div className="relative inline-flex items-center">
          <Calendar size={14} className="absolute left-2 text-[var(--muted)] pointer-events-none" />
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="h-8 pl-7 pr-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            aria-label="start date"
          />
        </div>
        <span className="text-[length:var(--text-sm)] text-[var(--muted)]">–</span>
        <div className="relative inline-flex items-center">
          <Calendar size={14} className="absolute left-2 text-[var(--muted)] pointer-events-none" />
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="h-8 pl-7 pr-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            aria-label="end date"
          />
        </div>

        {/* 筛选按钮 */}
        <button
          onClick={applyFilters}
          className="h-8 px-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
        >
          {t("action")}
        </button>

        {/* 重置筛选按钮 */}
        {(targetTypeFilter !== "all" || actionTypeFilter !== "all" || startDate || endDate) && (
          <button
            onClick={resetFilters}
            className="h-8 px-3 rounded-[var(--radius-sm)] text-[length:var(--text-sm)] text-[var(--muted)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
          >
            {t("close")}
          </button>
        )}
      </div>

      {/* 错误提示 */}
      {error && <p className="mb-3 text-[length:var(--text-sm)] text-[var(--danger)]">{error}</p>}

      {/* 内容区域 */}
      {loading ? (
        <div className="py-[var(--space-12)] text-center text-[var(--muted)]">
          <Loader2 size={20} className="inline animate-spin mr-2" />
          {t("auditLogs")}
        </div>
      ) : items.length === 0 ? (
        <div className="py-[var(--space-12)] text-center text-[var(--muted)]">
          <ScrollText size={36} className="mx-auto mb-3 opacity-50" />
          <p>{t("noAuditLogs")}</p>
        </div>
      ) : (
        <>
          {/* 审计日志列表 */}
          <ul className="divide-y divide-[var(--border-soft)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
            {items.map((entry) => {
              const visual = getActionVisual(entry.action);
              const operatorName =
                entry.operator?.name || entry.operator?.email || entry.operatorId || "—";
              const oldPermKey = getPermissionLabelKey(entry.oldPermission);
              const newPermKey = getPermissionLabelKey(entry.newPermission);

              return (
                <li
                  key={entry.id}
                  className="px-[var(--space-4)] py-3 hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
                >
                  {/* 第一行：操作类型 + 目标信息 + 时间 */}
                  <div className="flex items-center gap-2">
                    {getTargetTypeIcon(entry.targetType)}
                    <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
                      {t(`action${entry.action.charAt(0).toUpperCase()}${entry.action.slice(1)}`)}
                    </span>
                    <span
                      className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)]"
                      style={{ color: visual.color, background: visual.bg }}
                    >
                      {visual.icon}
                      {t(visual.labelKey)}
                    </span>
                    <span className="text-[length:var(--text-xs)] text-[var(--muted)] ml-auto">
                      {new Date(entry.createdAt).toLocaleString()}
                    </span>
                  </div>

                  {/* 第二行：详细信息 */}
                  <div className="mt-1 ml-6 text-[length:var(--text-xs)] text-[var(--muted)] flex items-center gap-2 flex-wrap">
                    {/* 目标类型 + ID */}
                    <span>
                      {t("targetType")}: {t(entry.targetType)}
                    </span>
                    <span>·</span>
                    <span className="truncate max-w-[160px]">ID: {entry.targetId}</span>

                    {/* 授权对象 */}
                    <span>·</span>
                    <span>
                      {t("granteeType")}: {t(entry.granteeType)}
                    </span>
                    <span>·</span>
                    <span className="truncate max-w-[120px]">{entry.granteeId}</span>

                    {/* 权限变更 */}
                    {oldPermKey && (
                      <>
                        <span>·</span>
                        <span>
                          {t("oldPermission")}: {t(oldPermKey)}
                        </span>
                      </>
                    )}
                    {newPermKey && (
                      <>
                        <span>·</span>
                        <span>
                          {t("newPermission")}: {t(newPermKey)}
                        </span>
                      </>
                    )}

                    {/* 操作人 */}
                    <span>·</span>
                    <span>
                      {t("operator")}: {operatorName}
                    </span>

                    {/* 原因 */}
                    {entry.reason && (
                      <>
                        <span>·</span>
                        <span className="truncate max-w-[200px]">
                          {t("reason")}: {entry.reason}
                        </span>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-[var(--space-4)]">
              <span className="text-[length:var(--text-xs)] text-[var(--muted)]">
                {total} {t("auditLogs")}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="inline-flex items-center gap-1 h-8 px-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-fast)]"
                  aria-label="previous page"
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="text-[length:var(--text-sm)] text-[var(--fg-2)] min-w-[80px] text-center">
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="inline-flex items-center gap-1 h-8 px-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-fast)]"
                  aria-label="next page"
                >
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

export default PermissionAuditLogPage;
