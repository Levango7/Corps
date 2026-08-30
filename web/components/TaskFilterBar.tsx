"use client";

/**
 * 看板/列表视图筛选器（阶段 2-2：筛选与自定义视图——Pro 卖点兑现）。
 *
 * 设计：
 *  - 筛选维度：状态 / 负责人 / 优先级 / 标签（多选）/ 关键词
 *  - Pro 门控：free 工作区仅状态 + 负责人可用；其余锁定并显示升级提示
 *    （定价页口径：任务筛选与自定义视图为 Pro 能力）
 *  - 自定义视图：筛选组合可保存为命名视图（localStorage 按用户隔离，
 *    视图是个人偏好而非共享数据——不建表，避免迁移负担）
 *  - 变更即上抛 onChange（父层负责拼 query 重拉列表）
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Filter, X, Save, Bookmark, Search, Lock } from "lucide-react";
import type { Priority, Status } from "@/lib/types";
import { track } from "@/lib/analytics";

export interface TaskFilter {
  status: Status | "all";
  assignee: string | "all"; // userId | "me" | "all"
  priority: Priority | "all";
  labels: string[]; // labelId 多选
  q: string;
}

export const EMPTY_FILTER: TaskFilter = {
  status: "all",
  assignee: "all",
  priority: "all",
  labels: [],
  q: "",
};

export interface SavedView {
  name: string;
  filter: TaskFilter;
}

/** localStorage 键：按用户隔离（个人偏好，不共享） */
const viewKey = (userId: string, wid: string) => `corps:views:${userId}:${wid}`;

export function loadViews(userId: string, wid: string): SavedView[] {
  try {
    return JSON.parse(localStorage.getItem(viewKey(userId, wid)) ?? "[]") as SavedView[];
  } catch {
    return [];
  }
}

function saveViews(userId: string, wid: string, views: SavedView[]): void {
  localStorage.setItem(viewKey(userId, wid), JSON.stringify(views));
}

/** 筛选是否为"空"（无任何条件） */
export function isEmptyFilter(f: TaskFilter): boolean {
  return (
    f.status === "all" &&
    f.assignee === "all" &&
    f.priority === "all" &&
    f.labels.length === 0 &&
    !f.q.trim()
  );
}

/** 筛选 → GET /tasks 查询串（milestone 由外层 MilestoneFilter 独立处理） */
export function filterToQuery(f: TaskFilter): string {
  const p = new URLSearchParams();
  if (f.status !== "all") p.set("status", f.status);
  if (f.assignee !== "all") p.set("assignee", f.assignee);
  if (f.priority !== "all") p.set("priority", f.priority);
  if (f.labels.length > 0) p.set("label", f.labels.join(","));
  if (f.q.trim()) p.set("q", f.q.trim());
  const s = p.toString();
  return s ? `?${s}` : "";
}

interface TaskFilterBarProps {
  value: TaskFilter;
  onChange: (f: TaskFilter) => void;
  /** 当前工作区 plan（free 锁定高级筛选） */
  isPro: boolean;
  /** 成员列表（负责人下拉） */
  members: Array<{ id: string; name: string | null; email: string }>;
  /** 标签列表（标签多选 chips） */
  labels: Array<{ id: string; name: string; color: string }>;
  /** 当前用户 ID（视图 localStorage 隔离） */
  userId: string;
  wid: string;
}

export function TaskFilterBar({
  value,
  onChange,
  isPro,
  members,
  labels,
  userId,
  wid,
}: TaskFilterBarProps) {
  const t = useTranslations("task.filter");
  const [views, setViews] = useState<SavedView[]>([]);
  const [viewName, setViewName] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);

  useEffect(() => {
    setViews(loadViews(userId, wid));
  }, [userId, wid]);

  // 筛选埋点：非空筛选组合变更时打 filter_applied（维度数 + 是否 Pro）
  // deps 仅 [value]：activeCount/isPro 由其派生或慢变，入 deps 只会重复触发
  useEffect(() => {
    if (!isEmptyFilter(value)) {
      track("filter_applied", {
        dimensions: activeCount,
        isPro,
      });
    }
    // eslint-disable-next-line -- activeCount/isPro 由 value 派生，勿入 deps
  }, [value]);

  const active = !isEmptyFilter(value);
  const activeCount =
    (value.status !== "all" ? 1 : 0) +
    (value.assignee !== "all" ? 1 : 0) +
    (value.priority !== "all" ? 1 : 0) +
    value.labels.length +
    (value.q.trim() ? 1 : 0);

  // Pro 锁定的筛选维度：优先级 / 标签 / 关键词
  const locked = !isPro;

  function handleSave() {
    const name = viewName.trim();
    if (!name || isEmptyFilter(value)) return;
    const next = [...views.filter((v) => v.name !== name), { name, filter: value }];
    setViews(next);
    saveViews(userId, wid, next);
    setViewName("");
    setSaveOpen(false);
    track("view_saved", { name });
  }

  function handleDeleteView(name: string) {
    const next = views.filter((v) => v.name !== name);
    setViews(next);
    saveViews(userId, wid, next);
  }

  const selectCls =
    "h-8 px-2 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg-2)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2" data-testid="task-filter-bar">
      <span className="flex items-center gap-1.5 text-[length:var(--text-sm)] text-[var(--muted)]">
        <Filter size={15} />
        {t("title")}
        {active && (
          <span className="px-1.5 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] text-[length:var(--text-xs)]">
            {activeCount}
          </span>
        )}
      </span>

      {/* 状态筛选（free 可用） */}
      <select
        aria-label={t("status")}
        value={value.status}
        onChange={(e) => onChange({ ...value, status: e.target.value as Status | "all" })}
        className={selectCls}
      >
        <option value="all">{t("allStatuses")}</option>
        <option value="todo">{t("statusTodo")}</option>
        <option value="in_progress">{t("statusInProgress")}</option>
        <option value="review">{t("statusReview")}</option>
        <option value="done">{t("statusDone")}</option>
      </select>

      {/* 负责人筛选（free 可用） */}
      <select
        aria-label={t("assignee")}
        value={value.assignee}
        onChange={(e) => onChange({ ...value, assignee: e.target.value })}
        className={selectCls}
      >
        <option value="all">{t("allAssignees")}</option>
        <option value="me">{t("assigneeMe")}</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name || m.email}
          </option>
        ))}
      </select>

      {/* 优先级（Pro） */}
      <select
        aria-label={t("priority")}
        value={value.priority}
        disabled={locked}
        onChange={(e) => onChange({ ...value, priority: e.target.value as Priority | "all" })}
        className={selectCls}
      >
        <option value="all">{t("allPriorities")}</option>
        <option value="urgent">{t("priorityUrgent")}</option>
        <option value="high">{t("priorityHigh")}</option>
        <option value="medium">{t("priorityMedium")}</option>
        <option value="low">{t("priorityLow")}</option>
      </select>

      {/* 标签多选 chips（Pro） */}
      {labels.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap" aria-label={t("labels")}>
          {labels.slice(0, 8).map((l) => {
            const selected = value.labels.includes(l.id);
            return (
              <button
                key={l.id}
                disabled={locked}
                onClick={() =>
                  onChange({
                    ...value,
                    labels: selected
                      ? value.labels.filter((x) => x !== l.id)
                      : [...value.labels, l.id],
                  })
                }
                className={`px-2 h-7 rounded-full text-[length:var(--text-xs)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  selected
                    ? "text-white"
                    : "bg-[var(--surface-2)] text-[var(--fg-2)] hover:bg-[var(--surface-3)]"
                }`}
                style={selected ? { background: l.color } : undefined}
                aria-pressed={selected}
              >
                {l.name}
              </button>
            );
          })}
        </div>
      )}

      {/* 关键词（Pro） */}
      <div className="relative">
        <Search
          size={14}
          className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--muted)] pointer-events-none"
        />
        <input
          type="search"
          aria-label={t("keyword")}
          placeholder={t("keywordPlaceholder")}
          disabled={locked}
          value={value.q}
          onChange={(e) => onChange({ ...value, q: e.target.value })}
          className="h-8 pl-7 pr-2 w-40 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg-2)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)] disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>

      {locked && (
        <span
          className="flex items-center gap-1 text-[length:var(--text-xs)] text-[var(--muted)]"
          title={t("proLockHint")}
        >
          <Lock size={12} />
          {t("proLockLabel")}
        </span>
      )}

      {/* 清空 */}
      {active && (
        <button
          onClick={() => onChange({ ...EMPTY_FILTER })}
          className="flex items-center gap-1 h-7 px-2 rounded-[var(--radius-md)] text-[length:var(--text-xs)] text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)] transition-colors"
        >
          <X size={13} />
          {t("clear")}
        </button>
      )}

      {/* 保存视图（Pro）：筛选非空时可命名保存 */}
      <div className="flex items-center gap-1.5 ml-auto">
        {views.map((v) => (
          <span
            key={v.name}
            className="group inline-flex items-center gap-1 h-7 px-2 rounded-full bg-[var(--surface-2)] text-[length:var(--text-xs)] text-[var(--fg-2)]"
          >
            <button
              onClick={() => onChange({ ...v.filter })}
              className="flex items-center gap-1 hover:text-[var(--accent)] transition-colors"
              aria-label={t("applyView", { name: v.name })}
            >
              <Bookmark size={11} />
              {v.name}
            </button>
            <button
              onClick={() => handleDeleteView(v.name)}
              className="opacity-0 group-hover:opacity-100 text-[var(--muted)] hover:text-[var(--danger)]"
              aria-label={t("deleteView", { name: v.name })}
            >
              <X size={11} />
            </button>
          </span>
        ))}
        {saveOpen ? (
          <span className="flex items-center gap-1">
            <input
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
              placeholder={t("viewNamePlaceholder")}
              maxLength={20}
              className="h-7 w-28 px-2 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-xs)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            />
            <button
              onClick={handleSave}
              disabled={!viewName.trim() || isEmptyFilter(value)}
              className="h-7 px-2 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-xs)] font-[var(--weight-medium)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t("saveConfirm")}
            </button>
          </span>
        ) : (
          <button
            onClick={() => setSaveOpen(true)}
            disabled={locked || isEmptyFilter(value)}
            className="flex items-center gap-1 h-7 px-2 rounded-[var(--radius-md)] text-[length:var(--text-xs)] text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={t("saveViewHint")}
          >
            <Save size={12} />
            {t("saveView")}
          </button>
        )}
      </div>
    </div>
  );
}
