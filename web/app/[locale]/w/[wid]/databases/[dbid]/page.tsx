"use client";

/**
 * 单个多维表格编辑页 · /w/[wid]/databases/[dbid]
 *
 * 职责：把两次 GET 的结果拼成 `DatabaseEditor` 的 props，并把编辑器的回调
 * 落到既有的 REST 端点上——**不改编辑器本体**。
 *
 * 数据装载：
 *  - `GET /databases/{dbid}` → database + fields + views（服务端 include 了
 *    fields/views，但**没有** records）
 *  - `GET /databases/{dbid}/records?limit=200` → 记录（分页信封，走 apiList）
 *  - 角色：`/users/me` + `/members`，用于决定是否下发写回调
 *
 * 回调映射：
 *  - onRecordUpdate → `PATCH /records/{rid}`（先与本地 data 合并：TableView 只
 *    回传被改的那一列，而 PATCH 是整体覆盖 data 列，不合并会把整行其他单元格洗掉）
 *  - onRecordCreate → `POST /records`
 *  - onViewChange   → 本地状态切视图
 *  - onViewUpdate   → 本地状态 + `PATCH /views/{vid}`（仅 owner/admin；服务端对
 *    视图写入有角色校验，故非管理角色只在会话内生效，不发请求）
 *
 * 与 whiteboards/[wbid] 一致：编辑器 dynamic + ssr:false 拆包，外层 SafeComponent 兜底。
 */

import { use, useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { Link } from "@/lib/i18n-navigation";
import { api, apiList } from "@/lib/api";
import { Skeleton } from "@/components/Skeleton";
import { SafeComponent } from "@/components/SafeComponent";
import type { Role } from "@/lib/types";
import {
  canDeleteDatabaseRecords,
  canManageDatabases,
  fetchMyWorkspaceRole,
  recordDataAsObject,
  toDatabaseModel,
  toFieldModels,
  toRecordModels,
  toViewModels,
  type DatabaseDto,
  type DatabaseFieldDto,
  type DatabaseRecordDto,
  type DatabaseViewDto,
} from "../shared";

// DatabaseEditor 会连带拖入 4 个视图组件 + query-engine，仅此页使用 → 懒加载拆包。
const DatabaseEditor = dynamic(
  () => import("@/components/database/DatabaseEditor").then((m) => m.DatabaseEditor),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[420px] w-full" />,
  },
);

export default function DatabaseDetailPage({
  params,
}: {
  params: Promise<{ wid: string; dbid: string }>;
}) {
  const { wid, dbid } = use(params);
  return <DatabaseDetail wid={wid} dbid={dbid} />;
}

function DatabaseDetail({ wid, dbid }: { wid: string; dbid: string }) {
  const t = useTranslations("database.detail");
  const tc = useTranslations("common");

  const [database, setDatabase] = useState<DatabaseDto | null>(null);
  const [fields, setFields] = useState<DatabaseFieldDto[]>([]);
  const [views, setViews] = useState<DatabaseViewDto[]>([]);
  const [records, setRecords] = useState<DatabaseRecordDto[]>([]);
  const [role, setRole] = useState<Role | null>(null);
  const [currentViewId, setCurrentViewId] = useState<string | undefined>(undefined);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");

  const canManage = canManageDatabases(role);
  // 删记录的门槛比建字段/建视图低：member 即可（viewer 只读）
  const canDeleteRecords = canDeleteDatabaseRecords(role);

  // ─── 装载 ────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setError("");
    (async () => {
      try {
        const [detail, recordList, myRole] = await Promise.all([
          api<DatabaseDto>(`/api/v1/workspaces/${wid}/databases/${dbid}`),
          apiList<DatabaseRecordDto>(
            `/api/v1/workspaces/${wid}/databases/${dbid}/records?limit=200`,
          ),
          fetchMyWorkspaceRole(wid),
        ]);
        if (cancelled) return;
        setDatabase(detail);
        setFields(detail.fields ?? []);
        setViews(detail.views ?? []);
        setCurrentViewId(detail.views?.[0]?.id);
        setRecords(recordList);
        setRole(myRole);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t("loadFailed"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wid, dbid, t]);

  // ─── 编辑器回调 ──────────────────────────────────────────────

  /** 单元格写回：先从当前 records 取整行再合并，避免 PATCH 覆盖掉未修改的列 */
  const handleRecordUpdate = useCallback(
    (rid: string, patch: Record<string, unknown>) => {
      const target = records.find((r) => r.id === rid);
      const merged = { ...recordDataAsObject(target?.data), ...patch };
      // 本地先行更新保证输入即时反馈，PATCH 失败只在下方提示条里体现
      setRecords((prev) => prev.map((r) => (r.id === rid ? { ...r, data: merged } : r)));
      api(`/api/v1/workspaces/${wid}/databases/${dbid}/records/${rid}`, {
        method: "PATCH",
        body: JSON.stringify({ data: merged }),
      }).catch((e: unknown) => {
        setLoadError(e instanceof Error ? e.message : t("saveFailed"));
      });
    },
    [records, wid, dbid, t],
  );

  const handleRecordCreate = useCallback(async () => {
    try {
      const created = await api<DatabaseRecordDto>(
        `/api/v1/workspaces/${wid}/databases/${dbid}/records`,
        { method: "POST", body: JSON.stringify({ data: {} }) },
      );
      setRecords((prev) => [...prev, created]);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t("saveFailed"));
    }
  }, [wid, dbid, t]);

  const handleViewChange = useCallback((viewId: string) => {
    setCurrentViewId(viewId);
  }, []);

  /** 视图配置（筛选/排序/分组）变更：本地一定更新；owner/admin 才落库 */
  const handleViewUpdate = useCallback(
    (viewId: string, config: Record<string, unknown>) => {
      setViews((prev) => prev.map((v) => (v.id === viewId ? { ...v, config } : v)));
      if (!canManage) {
        setLoadError(t("viewNotPersisted"));
        return;
      }
      api(`/api/v1/workspaces/${wid}/databases/${dbid}/views/${viewId}`, {
        method: "PATCH",
        body: JSON.stringify({ config }),
      }).catch((e: unknown) => {
        setLoadError(e instanceof Error ? e.message : t("saveFailed"));
      });
    },
    [wid, dbid, canManage, t],
  );

  /** 建字段：POST /fields，成功后把新字段并进来（列头与筛选/排序立即可用） */
  const handleFieldCreate = useCallback(
    async (input: { name: string; type: string }) => {
      try {
        const created = await api<DatabaseFieldDto>(
          `/api/v1/workspaces/${wid}/databases/${dbid}/fields`,
          { method: "POST", body: JSON.stringify(input) },
        );
        setFields((prev) => [...prev, created]);
        setLoadError("");
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : t("saveFailed"));
      }
    },
    [wid, dbid, t],
  );

  /** 建视图：POST /views，成功即切过去（board/gantt/calendar 由此才可达） */
  const handleViewCreate = useCallback(
    async (input: { name: string; type: string }) => {
      try {
        const created = await api<DatabaseViewDto>(
          `/api/v1/workspaces/${wid}/databases/${dbid}/views`,
          { method: "POST", body: JSON.stringify(input) },
        );
        setViews((prev) => [...prev, created]);
        setCurrentViewId(created.id);
        setLoadError("");
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : t("saveFailed"));
      }
    },
    [wid, dbid, t],
  );

  /** 删记录：破坏性动作，先 confirm；服务端 requirePermission 拒的就是这里没拦住的 viewer */
  const handleRecordDelete = useCallback(
    async (rid: string) => {
      if (!window.confirm(t("confirmDeleteRecord"))) return;
      setRecords((prev) => prev.filter((r) => r.id !== rid));
      try {
        await api(`/api/v1/workspaces/${wid}/databases/${dbid}/records/${rid}`, {
          method: "DELETE",
        });
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : t("saveFailed"));
      }
    },
    [wid, dbid, t],
  );

  // ─── DTO → DatabaseEditor 的 Prisma 模型形状 ──────────────────
  const editorProps = useMemo(
    () =>
      database
        ? {
            database: toDatabaseModel(database),
            fields: toFieldModels(fields),
            records: toRecordModels(records),
            views: toViewModels(views),
            currentViewId,
          }
        : null,
    [database, fields, records, views, currentViewId],
  );

  // ─── 渲染 ────────────────────────────────────────────────────
  const backLink = (
    <Link
      href={`/w/${wid}/databases`}
      className="inline-flex items-center gap-1.5 text-[length:var(--text-sm)] text-[var(--muted)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
    >
      <ArrowLeft size={14} />
      {t("back")}
    </Link>
  );

  if (error) {
    return (
      <div className="max-w-[var(--container-max)] mx-auto">
        <div className="mb-[var(--space-4)]">{backLink}</div>
        <p className="p-[var(--space-8)] text-center text-[var(--danger-fg)]">{error}</p>
      </div>
    );
  }

  if (!editorProps) {
    return (
      <div className="max-w-[var(--container-max)] mx-auto">
        <div className="mb-[var(--space-4)]">{backLink}</div>
        <p className="p-[var(--space-8)] text-center text-[var(--muted)]">{tc("loading")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-[var(--space-3)]">{backLink}</div>
      {loadError && (
        <p className="text-[length:var(--text-sm)] text-[var(--danger-fg)]">{loadError}</p>
      )}
      <div className="h-[calc(100dvh-var(--topbar-h)-var(--space-8))] lg:h-[calc(100dvh-var(--topbar-h)-var(--space-12))] min-h-[420px] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        <SafeComponent name="多维表格编辑器">
          <DatabaseEditor
            {...editorProps}
            onRecordUpdate={handleRecordUpdate}
            onRecordCreate={handleRecordCreate}
            onRecordDelete={canDeleteRecords ? handleRecordDelete : undefined}
            onViewChange={handleViewChange}
            onViewUpdate={handleViewUpdate}
            onFieldCreate={canManage ? handleFieldCreate : undefined}
            onViewCreate={canManage ? handleViewCreate : undefined}
          />
        </SafeComponent>
      </div>
    </div>
  );
}
