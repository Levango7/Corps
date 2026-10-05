"use client";

/**
 * 多维表格 · 主编辑器（Phase 3 DatabaseEditor 整合）
 *
 * 负责视图切换、筛选/排序/分组面板管理、数据加载与状态管理，
 * 将处理后的数据传递给当前视图组件。
 *
 * 数据流：
 *  1. 从 currentView.config 读取筛选/排序/分组配置
 *  2. 用 query-engine 的 queryRecords 对 records 应用筛选/排序/分组
 *  3. 将结果扁平化后传递给当前视图组件（视图组件自行呈现分组）
 *
 * 所有样式走 design token（var(--*)），无裸 hex。
 * 图标：lucide-react，尺寸 14。
 * 动效：transition 用 var(--motion-base)，motion-reduce 时禁用。
 */

import { useState, useMemo, useCallback, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import {
  Table2,
  Columns3,
  GanttChart,
  Calendar,
  Filter,
  ArrowUpDown,
  Group,
  Plus,
  type LucideIcon,
} from "lucide-react";
import type { Database, DatabaseField, DatabaseRecord, DatabaseView } from "@prisma/client";
import {
  queryRecords,
  type FilterCondition,
  type SortCondition,
} from "@/lib/database/query-engine";
import { TableView } from "./TableView";
import { BoardView } from "./BoardView";
import { GanttView } from "./GanttView";
import { CalendarView } from "./CalendarView";
import { FilterPanel } from "./FilterPanel";
import { SortPanel } from "./SortPanel";
import { GroupControl } from "./GroupControl";

// ─── 类型定义 ──────────────────────────────────────────────────

/** 视图配置（存储在 DatabaseView.config 中） */
interface ViewConfig {
  filters?: FilterCondition[];
  filterLogic?: "AND" | "OR";
  sorts?: SortCondition[];
  groupFieldId?: string;
  [key: string]: unknown;
}

/** 视图类型 → 图标映射 */
const VIEW_ICONS: Record<string, LucideIcon> = {
  table: Table2,
  board: Columns3,
  gantt: GanttChart,
  calendar: Calendar,
};

/** 视图类型 → i18n key 后缀映射（在组件内通过 t() 解析为显示名称） */
const VIEW_LABEL_KEYS: Record<string, string> = {
  table: "viewTable",
  board: "viewBoard",
  gantt: "viewGantt",
  calendar: "viewCalendar",
};

// ─── Props ──────────────────────────────────────────────────────

export interface DatabaseEditorProps {
  database: Database;
  fields: DatabaseField[];
  records: DatabaseRecord[];
  views: DatabaseView[];
  /** 当前视图 ID，默认第一个视图 */
  currentViewId?: string;
  onRecordUpdate?: (id: string, data: Record<string, unknown>) => void;
  onRecordCreate?: () => void;
  onViewChange?: (viewId: string) => void;
  onViewUpdate?: (viewId: string, config: Record<string, unknown>) => void;
  /**
   * 建字段。端点 `POST …/fields` 早已存在，缺的只是入口——10-05 实测全仓
   * 客户端只在「建库」时硬编码 type:"text"，事后无法加列。
   */
  onFieldCreate?: (input: { name: string; type: string }) => void;
  /** 建视图。给了才会解锁 board/gantt/calendar（此前无任何路径产生非 table 视图行） */
  onViewCreate?: (input: { name: string; type: string }) => void;
  /** 行删除，转交给 TableView */
  onRecordDelete?: (id: string) => void;
}

/**
 * 可新建的字段类型 = query-engine 真正会算的那 9 种
 * （lib/database/query-engine.ts:20-21）。
 * 刻意不提供 formula/relation/rollup：三种引擎（formula-engine /
 * relation-resolver / 关系解析）目前非测试引用数为 0，建出来只会得到
 * 「FieldControls 里显示成字符串/计数」的死字段。引擎接线后再补进本表。
 */
const CREATABLE_FIELD_TYPES = [
  "text",
  "number",
  "select",
  "multiselect",
  "date",
  "checkbox",
  "user",
  "url",
  "email",
] as const;

/** 可新建的视图类型（四种在 :364-400 都有渲染分支） */
const CREATABLE_VIEW_TYPES = ["table", "board", "gantt", "calendar"] as const;

/**
 * 字段类型 → i18n 键。逐个写死而不是 `fieldType${x}` 拼串：仓库有
 * 「引用键存在性」门禁，动态拼接的键无法静态校验，真漏了键要等到运行时才炸。
 */
const FIELD_TYPE_LABEL_KEYS: Record<(typeof CREATABLE_FIELD_TYPES)[number], string> = {
  text: "fieldTypeText",
  number: "fieldTypeNumber",
  select: "fieldTypeSelect",
  multiselect: "fieldTypeMultiselect",
  date: "fieldTypeDate",
  checkbox: "fieldTypeCheckbox",
  user: "fieldTypeUser",
  url: "fieldTypeUrl",
  email: "fieldTypeEmail",
};

// ─── 辅助函数 ──────────────────────────────────────────────────

/** 安全读取视图 config 为对象 */
function readViewConfig(view: DatabaseView): ViewConfig {
  const c = view.config as unknown;
  if (c !== null && typeof c === "object" && !Array.isArray(c)) {
    return c as ViewConfig;
  }
  return {};
}

/** 将 Prisma Json 类型的 record.data 安全转为对象 */
function normalizeRecordData(data: unknown): Record<string, unknown> {
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return {};
}

// ─── 样式常量 ──────────────────────────────────────────────────

/** 工具栏按钮基础样式 */
const TOOL_BTN_BASE =
  "inline-flex items-center gap-1.5 h-8 px-2.5 rounded-[var(--radius-sm)] " +
  "text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] " +
  "border border-[var(--border)] bg-[var(--surface)] text-[var(--fg-2)] " +
  "transition-colors duration-[var(--motion-base)] motion-reduce:transition-none " +
  "hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-[var(--focus-ring)] " +
  "cursor-pointer";

/** 工具栏按钮激活态样式（有筛选/排序/分组条件时） */
const TOOL_BTN_ACTIVE =
  "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-soft-fg)]";

/** 视图 tab 基础样式 */
const VIEW_TAB_BASE =
  "inline-flex items-center gap-1.5 h-8 px-2.5 rounded-[var(--radius-sm)] " +
  "text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] " +
  "transition-colors duration-[var(--motion-base)] motion-reduce:transition-none " +
  "focus-visible:outline-none focus-visible:ring-[var(--focus-ring)] cursor-pointer";

/** 计数徽章样式 */
const COUNT_BADGE =
  "ml-0.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 " +
  "rounded-[var(--radius-pill)] bg-[var(--accent)] text-[var(--accent-fg)] " +
  "text-[10px] font-[weight:var(--weight-semibold)] leading-none";

// ─── 主组件 ──────────────────────────────────────────────────────

export function DatabaseEditor({
  database,
  fields,
  records,
  views,
  currentViewId,
  onRecordUpdate,
  onRecordCreate,
  onViewChange,
  onViewUpdate,
  onFieldCreate,
  onViewCreate,
  onRecordDelete,
}: DatabaseEditorProps) {
  const t = useTranslations("database.editor");

  // 面板展开状态
  const [showFilter, setShowFilter] = useState(false);
  const [showSort, setShowSort] = useState(false);
  const [showGroup, setShowGroup] = useState(false);
  const [showFields, setShowFields] = useState(false);
  const [showAddView, setShowAddView] = useState(false);
  const [newViewName, setNewViewName] = useState("");
  const [newViewType, setNewViewType] = useState<(typeof CREATABLE_VIEW_TYPES)[number]>("board");
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<(typeof CREATABLE_FIELD_TYPES)[number]>("text");

  // ─── 当前视图解析 ────────────────────────────────────────────

  const currentView = useMemo(() => {
    if (currentViewId) {
      return views.find((v) => v.id === currentViewId);
    }
    return views[0];
  }, [views, currentViewId]);

  const viewConfig = useMemo<ViewConfig>(
    () => (currentView ? readViewConfig(currentView) : {}),
    [currentView],
  );

  // ─── 数据处理：Prisma records → query-engine 兼容格式 ────────

  /** 适配后的 records（data 转为 Record<string, unknown>，保留所有 Prisma 属性） */
  const queryableRecords = useMemo(
    () =>
      records.map((r) => ({
        ...r,
        data: normalizeRecordData(r.data),
      })),
    [records],
  );

  // ─── 应用筛选/排序/分组 ──────────────────────────────────────

  const { processedRecords, total } = useMemo(() => {
    if (!currentView) return { processedRecords: [] as DatabaseRecord[], total: 0 };
    const result = queryRecords(queryableRecords, fields, {
      filters: viewConfig.filters,
      filterLogic: viewConfig.filterLogic,
      sorts: viewConfig.sorts,
      groupFieldId: viewConfig.groupFieldId,
    });
    // 扁平化分组结果传给视图组件（视图组件自行呈现分组）
    return {
      processedRecords: result.groups.flatMap((g) => g.records) as unknown as DatabaseRecord[],
      total: result.total,
    };
  }, [queryableRecords, fields, currentView, viewConfig]);

  // ─── 配置变更回调 ────────────────────────────────────────────

  const handleFilterChange = useCallback(
    (filters: FilterCondition[], logic: "AND" | "OR") => {
      if (!currentView || !onViewUpdate) return;
      const newConfig: ViewConfig = { ...viewConfig, filters, filterLogic: logic };
      onViewUpdate(currentView.id, newConfig);
    },
    [currentView, viewConfig, onViewUpdate],
  );

  const handleSortChange = useCallback(
    (sorts: SortCondition[]) => {
      if (!currentView || !onViewUpdate) return;
      const newConfig: ViewConfig = { ...viewConfig, sorts };
      onViewUpdate(currentView.id, newConfig);
    },
    [currentView, viewConfig, onViewUpdate],
  );

  const handleGroupChange = useCallback(
    (fieldId: string | null) => {
      if (!currentView || !onViewUpdate) return;
      const newConfig: ViewConfig = {
        ...viewConfig,
        groupFieldId: fieldId ?? undefined,
      };
      onViewUpdate(currentView.id, newConfig);
    },
    [currentView, viewConfig, onViewUpdate],
  );

  const handleViewSwitch = useCallback(
    (viewId: string) => {
      onViewChange?.(viewId);
    },
    [onViewChange],
  );

  /** 提交新建视图：交给宿主落库；成功后清空名字并收起面板 */
  const handleViewCreateSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const name = newViewName.trim();
      if (!name || !onViewCreate) return;
      onViewCreate({ name, type: newViewType });
      setNewViewName("");
      setShowAddView(false);
    },
    [newViewName, newViewType, onViewCreate],
  );

  const handleFieldCreateSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const name = newFieldName.trim();
      if (!name || !onFieldCreate) return;
      onFieldCreate({ name, type: newFieldType });
      setNewFieldName("");
    },
    [newFieldName, newFieldType, onFieldCreate],
  );

  // ─── 激活态指示 ──────────────────────────────────────────────

  const hasFilters = (viewConfig.filters?.length ?? 0) > 0;
  const hasSorts = (viewConfig.sorts?.length ?? 0) > 0;
  const hasGroup = !!viewConfig.groupFieldId;

  // ─── 渲染：无视图空状态 ──────────────────────────────────────

  if (!currentView) {
    return (
      <div
        className="flex items-center justify-center h-full min-h-[400px] text-[var(--muted)]"
        data-testid="database-editor-empty"
      >
        <p className="text-[length:var(--text-sm)]">{t("noView")}</p>
      </div>
    );
  }

  // ─── 渲染：主界面 ────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-[var(--bg)]" data-testid="database-editor">
      {/* ─── 顶部栏：数据库名称 + 视图切换 + 工具栏 ─── */}
      <header className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-[var(--border)] bg-[var(--surface)]">
        {/* 数据库名称 */}
        <div className="flex items-center gap-2 mr-auto min-w-0">
          {database.emoji && (
            <span className="text-[length:var(--text-lg)] shrink-0">{database.emoji}</span>
          )}
          <h1 className="text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tracking-[var(--tracking-tight)] truncate">
            {database.title}
          </h1>
          <span className="text-[length:var(--text-sm)] text-[var(--muted)] shrink-0">
            {t("recordCount", { count: total })}
          </span>
        </div>

        {/* 视图切换 tabs */}
        <nav className="flex items-center gap-1" role="tablist" aria-label={t("viewSwitchAria")}>
          {views.map((view) => {
            const Icon = VIEW_ICONS[view.type] ?? Table2;
            const labelKey = VIEW_LABEL_KEYS[view.type];
            const label = labelKey ? t(labelKey) : view.name;
            const isActive = view.id === currentView.id;
            return (
              <button
                key={view.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => handleViewSwitch(view.id)}
                className={
                  VIEW_TAB_BASE +
                  (isActive
                    ? " bg-[var(--accent-soft)] text-[var(--accent-soft-fg)]"
                    : " text-[var(--fg-2)] hover:bg-[var(--surface-2)]")
                }
              >
                <Icon size={14} />
                <span>{label}</span>
              </button>
            );
          })}
          {onViewCreate && (
            <button
              type="button"
              onClick={() => setShowAddView((v) => !v)}
              aria-pressed={showAddView}
              aria-label={t("addViewAria")}
              className={VIEW_TAB_BASE + " text-[var(--fg-2)] hover:bg-[var(--surface-2)]"}
            >
              <Plus size={14} />
              <span>{t("addView")}</span>
            </button>
          )}
        </nav>

        {/* 工具栏：筛选/排序/分组 */}
        <div className="flex items-center gap-1 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setShowFilter((v) => !v)}
            aria-pressed={showFilter}
            aria-label={t("filterAria")}
            className={`${TOOL_BTN_BASE} ${hasFilters ? TOOL_BTN_ACTIVE : ""}`}
          >
            <Filter size={14} />
            <span>{t("filter")}</span>
            {hasFilters && <span className={COUNT_BADGE}>{viewConfig.filters!.length}</span>}
          </button>
          <button
            type="button"
            onClick={() => setShowSort((v) => !v)}
            aria-pressed={showSort}
            aria-label={t("sortAria")}
            className={`${TOOL_BTN_BASE} ${hasSorts ? TOOL_BTN_ACTIVE : ""}`}
          >
            <ArrowUpDown size={14} />
            <span>{t("sort")}</span>
            {hasSorts && <span className={COUNT_BADGE}>{viewConfig.sorts!.length}</span>}
          </button>
          <button
            type="button"
            onClick={() => setShowGroup((v) => !v)}
            aria-pressed={showGroup}
            aria-label={t("groupAria")}
            className={`${TOOL_BTN_BASE} ${hasGroup ? TOOL_BTN_ACTIVE : ""}`}
          >
            <Group size={14} />
            <span>{t("group")}</span>
          </button>
          {onFieldCreate && (
            <button
              type="button"
              onClick={() => setShowFields((v) => !v)}
              aria-pressed={showFields}
              aria-label={t("fieldsAria")}
              className={`${TOOL_BTN_BASE} ${showFields ? TOOL_BTN_ACTIVE : ""}`}
            >
              <Columns3 size={14} />
              <span>{t("fields")}</span>
              <span className={COUNT_BADGE}>{fields.length}</span>
            </button>
          )}
        </div>
      </header>

      {/* ─── 可折叠面板区 ─── */}
      {(showFilter || showSort || showGroup || showAddView || showFields) && (
        <div className="flex flex-col gap-2 px-4 py-2 border-b border-[var(--border)] bg-[var(--surface-2)]">
          {showFilter && (
            <FilterPanel
              fields={fields}
              filters={viewConfig.filters ?? []}
              filterLogic={viewConfig.filterLogic ?? "AND"}
              onChange={handleFilterChange}
            />
          )}
          {showSort && (
            <SortPanel fields={fields} sorts={viewConfig.sorts ?? []} onChange={handleSortChange} />
          )}
          {showGroup && (
            <GroupControl
              fields={fields}
              groupFieldId={viewConfig.groupFieldId ?? null}
              onChange={handleGroupChange}
            />
          )}
          {showAddView && onViewCreate && (
            <form
              onSubmit={handleViewCreateSubmit}
              className="flex flex-wrap items-center gap-2"
              data-testid="create-view-form"
            >
              <input
                value={newViewName}
                onChange={(e) => setNewViewName(e.target.value)}
                placeholder={t("newViewNamePlaceholder")}
                aria-label={t("newViewNameAria")}
                maxLength={100}
                className="min-w-[160px] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[length:var(--text-sm)] text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
              />
              <select
                value={newViewType}
                onChange={(e) => setNewViewType(e.target.value as typeof newViewType)}
                aria-label={t("newViewTypeAria")}
                className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[length:var(--text-sm)] text-[var(--fg)]"
              >
                {CREATABLE_VIEW_TYPES.map((vt) => (
                  <option key={vt} value={vt}>
                    {t(VIEW_LABEL_KEYS[vt] ?? "viewTable")}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={!newViewName.trim()}
                className="rounded-[var(--radius-sm)] bg-[var(--accent)] px-3 py-1 text-[length:var(--text-sm)] text-[var(--accent-fg)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("create")}
              </button>
            </form>
          )}
          {showFields && onFieldCreate && (
            <div className="flex flex-col gap-2" data-testid="fields-panel">
              <ul className="flex flex-wrap gap-1.5">
                {fields.map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center gap-1.5 rounded-[var(--radius-pill)] border border-[var(--border)] px-2 py-0.5 text-[length:var(--text-xs)] text-[var(--fg-2)]"
                  >
                    <span className="truncate">{f.name}</span>
                    <span className="uppercase tracking-wider text-[var(--meta)]">{f.type}</span>
                  </li>
                ))}
              </ul>
              <form
                onSubmit={handleFieldCreateSubmit}
                className="flex flex-wrap items-center gap-2"
              >
                <input
                  value={newFieldName}
                  onChange={(e) => setNewFieldName(e.target.value)}
                  placeholder={t("newFieldNamePlaceholder")}
                  aria-label={t("newFieldNameAria")}
                  maxLength={100}
                  className="min-w-[160px] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[length:var(--text-sm)] text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                />
                <select
                  value={newFieldType}
                  onChange={(e) => setNewFieldType(e.target.value as typeof newFieldType)}
                  aria-label={t("newFieldTypeAria")}
                  className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[length:var(--text-sm)] text-[var(--fg)]"
                >
                  {CREATABLE_FIELD_TYPES.map((ft) => (
                    <option key={ft} value={ft}>
                      {t(FIELD_TYPE_LABEL_KEYS[ft])}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={!newFieldName.trim()}
                  className="rounded-[var(--radius-sm)] bg-[var(--accent)] px-3 py-1 text-[length:var(--text-sm)] text-[var(--accent-fg)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t("create")}
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      {/* ─── 视图内容区 ─── */}
      <main className="flex-1 min-h-0 overflow-hidden">
        {currentView.type === "table" && (
          <TableView
            database={database}
            fields={fields}
            records={processedRecords}
            view={currentView}
            onRecordUpdate={onRecordUpdate}
            onRecordCreate={onRecordCreate}
            onRecordDelete={onRecordDelete}
          />
        )}
        {currentView.type === "board" && (
          <BoardView
            database={database}
            fields={fields}
            records={processedRecords}
            view={currentView}
            onRecordUpdate={onRecordUpdate}
          />
        )}
        {currentView.type === "gantt" && (
          <GanttView
            database={database}
            fields={fields}
            records={processedRecords}
            view={currentView}
            onRecordUpdate={onRecordUpdate}
          />
        )}
        {currentView.type === "calendar" && (
          <CalendarView
            database={database}
            fields={fields}
            records={processedRecords}
            view={currentView}
            onRecordUpdate={onRecordUpdate}
          />
        )}
      </main>
    </div>
  );
}
